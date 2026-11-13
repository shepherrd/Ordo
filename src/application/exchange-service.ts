import { isArchivedId } from "../domain/archived-format";
import { z } from "zod";
import type { Repository, Runtime } from "./ports";
import type {
  GraphicRenderPort,
  GraphicRenderRequest,
} from "./render-contracts";
import { diagramFromSaved } from "./orbat-projection";
import { symbolId, type MilitarySymbolDefinition } from "../domain/symbology";
import {
  exchangeRootSchema,
  type ExchangeRoot,
  type ExchangeImportReceipt,
  type ConversionField,
  type ExchangeMapping,
  type NativeExchange,
} from "../domain/library-exchange";
import { canonical } from "../export/projection";
import { parseExchangeJson } from "./exchange-json";
import { assertNativeExchange } from "./native-exchange";
import { assertExchangeReceipt } from "./exchange-receipt";
export const exchangePolicySchema = z.enum(["REUSE_EXACT", "DETACHED_COPIES"]);
export type ExchangePolicy = z.infer<typeof exchangePolicySchema>;
export interface ExchangePreview {
  token: string;
  sourceName: string;
  sourceHash: string;
  importer: ExchangeImportReceipt["importer"];
  policy: ExchangePolicy;
  canCommit: boolean;
  requiresAcknowledgement: boolean;
  targets: { kind: "SYMBOL" | "ORBAT"; versionId: string; name: string }[];
  fields: ConversionField[];
  mappings: ExchangeMapping[];
  /** Bounded presentation-only previews of the validated editable result. */
  visuals?: { name: string; request: GraphicRenderRequest }[];
}
type Prepared = {
  expires: number;
  sourceText: string;
  receipt: ExchangeImportReceipt | null;
  native: NativeExchange;
  preview: ExchangePreview;
  committed: boolean;
};
const display = (value: unknown) => {
  const s = JSON.stringify(value) ?? "absent";
  return s.length <= 1800 ? s : s.slice(0, 1780) + "… [see retained source]";
};
const losses = new Set(["DETACHED", "OMITTED", "UNSUPPORTED"]);
export class ExchangeService {
  private pending = new Map<string, Prepared>();
  constructor(
    private repo: Repository,
    private rt: Runtime,
    private renderer: GraphicRenderPort,
    private clock = Date.now,
  ) {}
  private trim() {
    for (const [id, p] of this.pending)
      if (p.expires < this.clock()) this.pending.delete(id);
  }
  private dependencies(e: NativeExchange): ConversionField[] {
    return e.dependencies.map((d) => {
      const local = this.repo.lookupExchangeDependency(d.kind, d.ref.versionId);
      const exact =
        local &&
        local.document.status === "PUBLISHED" &&
        canonical(local) === canonical(d);
      return {
        path: `dependencies/${d.kind}/${d.ref.versionId}`,
        action: exact ? "REUSED" : local ? "CONFLICT" : "MISSING",
        source: display(d.ref),
        target: local ? display(local.ref) : "absent",
        detail: exact
          ? "Exact local published dependency verified"
          : local
            ? "Local identity, content, or lifecycle differs; no overwrite"
            : "Dependency is absent locally",
      };
    });
  }
  async prepare(
    text: string,
    sourceName: string,
    policy: ExchangePolicy,
    signal?: AbortSignal,
  ): Promise<ExchangePreview> {
    exchangePolicySchema.parse(policy);
    z.string().min(1).max(240).parse(sourceName);
    this.trim();
    if (this.pending.size >= 4)
      throw Error("Close an import preview before opening another (limit 4)");
    const input = parseExchangeJson(text),
      sourceHash = this.repo.hash(text),
      id = this.rt.id();
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !("format" in input) ||
      input.format !== "ORDO_LIBRARY_EXCHANGE"
    )
      throw Error(
        "Choose an Ordo JSON file exported from the symbol or ORBAT editor.",
      );
    const importer = "ordo-exchange-v1";
    const native = assertNativeExchange(input, (t) => this.repo.hash(t));
    const fields = this.dependencies(native);
    const mappings: ExchangeMapping[] = [];
    const targets = [this.remap(native.root, sourceHash, policy, mappings)];
    const walk = (a: unknown, b: unknown, path: string) => {
      if (a && typeof a === "object") {
        for (const [k, v] of Object.entries(a))
          walk(
            v,
            b && typeof b === "object"
              ? (b as Record<string, unknown>)[k]
              : undefined,
            path + "/" + k,
          );
        return;
      }
      if (fields.length >= 100000)
        throw Error("Conversion report exceeds field budget");
      fields.push({
        path,
        action:
          canonical(a) === canonical(b)
            ? "COPIED"
            : policy === "DETACHED_COPIES" && path.includes("/unit/")
              ? "DETACHED"
              : "REMAPPED",
        source: display(a),
        target: display(b),
        detail: "Original value retained in immutable source evidence",
      });
    };
    walk(native.root, targets[0], "$/root");
    if (policy === "DETACHED_COPIES")
      fields.push({
        path: "$/dependencies",
        action: "DETACHED",
        source: display(native.dependencies.map((d) => d.ref)),
        target: "Independent snapshots",
        detail:
          "No dependency is installed or published. Profile and symbol pins are replaced by independent resolved content; original documents remain in the receipt.",
      });
    fields.push({
      path: "$/dependencyScope",
      action: "INFO",
      source: native.dependencyScope,
      target: native.dependencyScope,
      detail:
        "Closure covers composition pins and symbol origins. Profile standing trees, assets and doctrine references are retained metadata; they are not imported or expanded.",
    });
    for (const t of targets)
      t.value.exchangeOrigin = {
        importId: id,
        targetVersionId: t.value.versionId,
      };
    const seen = new Set<string>(),
      started = this.clock();
    const definitions: {
      definition: MilitarySymbolDefinition;
      path: string;
    }[] = [];
    for (const t of targets) {
      if (t.kind === "SYMBOL")
        definitions.push({
          definition: t.value.definition,
          path: `targets/${t.value.versionId}/definition`,
        });
      else
        for (const n of t.value.nodes) {
          for (const [key, s] of [
            [
              "base",
              n.unit.kind === "UNIT_PROFILE"
                ? n.unit.defaultSymbol
                : n.unit.symbol,
            ],
            ["override", n.symbolOverride],
          ] as const)
            if (s)
              definitions.push({
                definition: s.definition,
                path: `targets/${t.value.versionId}/nodes/${n.nodeId}/${key}`,
              });
        }
    }
    for (const { definition, path } of definitions) {
      if (signal?.aborted) throw Error("Import preview cancelled");
      if (this.clock() - started > 120000)
        throw Error("Import validation exceeded two-minute budget");
      const key = canonical({
        ...definition,
        definitionId: null,
        origin: null,
      });
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const rendered = await this.renderer.render(
          {
            kind: "SYMBOL",
            input: {
              definition,
              size: 30,
              context: "SYMBOL",
              labelSide: "RIGHT",
            },
          },
          signal,
        );
        if (rendered.kind !== "SYMBOL")
          throw Error("Unexpected validation result");
        for (const detail of rendered.result.diagnostics)
          fields.push({
            path,
            action: "INFO",
            source: definition.code.sidc,
            target: definition.code.sidc,
            detail: detail.slice(0, 1900),
          });
      } catch (e) {
        if (signal?.aborted) throw Error("Import preview cancelled");
        fields.push({
          path,
          action: "INVALID",
          source: definition.code.sidc,
          target: "absent",
          detail: String((e as Error).message).slice(0, 1900),
        });
      }
    }
    if (signal?.aborted) throw Error("Import preview cancelled");
    const canCommit =
      targets.length > 0 &&
      !fields.some(
        (f) =>
          f.action === "INVALID" ||
          (policy === "REUSE_EXACT" &&
            (f.action === "MISSING" || f.action === "CONFLICT")),
      );
    const receipt = canCommit
      ? assertExchangeReceipt(
          {
            schemaVersion: 1,
            id,
            at: this.rt.now(),
            actor: this.rt.actor,
            importer,
            policy,
            sourceName,
            sourceText: text,
            sourceHash,
            targets,
            mappings,
            fields,
          },
          (t) => this.repo.hash(t),
        )
      : null;
    const preview: ExchangePreview = {
      token: id,
      sourceName,
      sourceHash,
      importer,
      policy,
      canCommit,
      requiresAcknowledgement: fields.some((f) => losses.has(f.action)),
      targets: targets.map((t) => ({
        kind: t.kind,
        versionId: t.value.versionId,
        name: t.value.name,
      })),
      fields,
      mappings,
    };
    if (canCommit)
      preview.visuals = targets.slice(0, 12).map((target) => ({
        name: target.value.name,
        request:
          target.kind === "SYMBOL"
            ? {
                kind: "SYMBOL",
                input: {
                  definition: target.value.definition,
                  size: 80,
                  context: "SYMBOL",
                  labelSide: "RIGHT",
                },
              }
            : { kind: "ORBAT", input: diagramFromSaved(target.value) },
      }));
    // A second capacity check covers simultaneous asynchronous previews.
    this.trim();
    if (this.pending.size >= 4) throw Error("Import preview capacity reached");
    if (
      new TextEncoder().encode(
        JSON.stringify([
          ...this.pending.values(),
          { text, receipt, native, preview },
        ]),
      ).length >
      64 * 1024 * 1024
    )
      throw Error(
        "Import previews exceed the 64 MiB memory budget; close another preview",
      );
    this.pending.set(id, {
      expires: this.clock() + 10 * 60 * 1000,
      sourceText: text,
      receipt,
      native,
      preview,
      committed: false,
    });
    return structuredClone(preview);
  }
  revise(token: string, policy: ExchangePolicy, signal?: AbortSignal) {
    symbolId.parse(token);
    this.trim();
    const p = this.pending.get(token);
    if (!p || p.committed)
      throw Error("Preview is expired or already imported");
    this.pending.delete(token);
    return this.prepare(p.sourceText, p.preview.sourceName, policy, signal);
  }
  cancel(token: string) {
    symbolId.parse(token);
    this.pending.delete(token);
  }
  commit(
    token: string,
    acknowledgeLosses: boolean,
  ): { receiptId: string; targets: ExchangePreview["targets"] } {
    symbolId.parse(token);
    z.boolean().parse(acknowledgeLosses);
    this.trim();
    const p = this.pending.get(token);
    if (!p || !p.receipt)
      throw Error(
        "Import preview is invalid, cancelled, or expired; preview again",
      );
    if (p.preview.requiresAcknowledgement && !acknowledgeLosses)
      throw Error("Acknowledge conversion losses before importing");
    if (!p.committed)
      this.repo.transaction(() => {
        if (
          p.preview.policy === "REUSE_EXACT" &&
          this.dependencies(p.native).some((f) => f.action !== "REUSED")
        )
          throw Error("Dependencies changed since preview; preview again");
        this.repo.insertExchangeImport(p.receipt!);
        for (const t of p.receipt!.targets)
          this.repo.saveLibrary(t.kind, t.value, null);
      });
    p.committed = true;
    return { receiptId: token, targets: structuredClone(p.preview.targets) };
  }
  private remap(
    root: ExchangeRoot,
    sourceHash: string,
    policy: ExchangePolicy,
    mappings: ExchangeMapping[],
  ): ExchangeRoot {
    const t = structuredClone(root),
      v = t.value;
    const map = (kind: ExchangeMapping["kind"], source: string) => {
      const target = this.rt.id();
      mappings.push({ kind, source, target });
      return target;
    };
    v.familyId = map("FAMILY", v.familyId);
    v.versionId = map("VERSION", v.versionId);
    v.contentVersion = 1;
    v.status = "DRAFT";
    v.createdAt = this.rt.now();
    v.updatedAt = v.createdAt;
    v.publishedAt = null;
    v.retiredAt = null;
    v.parentVersionId = null;
    v.duplicatedFrom = null;
    delete v.exchangeOrigin;
    const definition = (d: MilitarySymbolDefinition, pinned = false) => {
      if (pinned && policy === "REUSE_EXACT") return;
      d.definitionId = map("DEFINITION", d.definitionId);
      if (isArchivedId("numeric", d.code.sourceConvention))
        d.code.sourceConvention = "NUMERIC_13";
      if (isArchivedId("letter", d.code.sourceConvention))
        d.code.sourceConvention = "LETTER_CODE";
      if (policy === "DETACHED_COPIES")
        d.origin = {
          kind: "IMPORT",
          fileHash: sourceHash,
          importerVersion: "ordo-exchange-v1",
          originalCode: d.code.sidc,
        };
    };
    const snapshot = (s: {
      definition: MilitarySymbolDefinition;
      source: unknown;
    }) => {
      definition(s.definition, !!s.source);
      if (policy === "DETACHED_COPIES") s.source = null;
    };
    if (t.kind === "SYMBOL") definition(t.value.definition);
    else {
      const o = t.value,
        nodeIds = new Map(
          o.nodes.map((n) => [n.nodeId, map("NODE", n.nodeId)]),
        );
      o.rootNodeId = nodeIds.get(o.rootNodeId)!;
      o.layout.layoutId = map("LAYOUT", o.layout.layoutId);
      o.layout.algorithm = "ordo-layout-v1";
      o.layout.labelProfile = "ordo-labels-v1";
      o.layout.hints.forEach((h) => (h.nodeId = nodeIds.get(h.nodeId)!));
      o.layout.siblingOrder = o.layout.siblingOrder.map((id) =>
        nodeIds.get(id)!,
      );
      for (const n of o.nodes) {
        n.nodeId = nodeIds.get(n.nodeId)!;
        n.parentNodeId = n.parentNodeId ? nodeIds.get(n.parentNodeId)! : null;
        if (n.unit.kind === "UNIT_PROFILE" && policy === "DETACHED_COPIES")
          n.unit = {
            kind: "INLINE_UNIT",
            identity: n.unit.identity,
            symbol: n.unit.defaultSymbol
              ? {
                  definition: structuredClone(n.unit.defaultSymbol.definition),
                  source: null,
                }
              : null,
          };
        if (n.unit.kind === "INLINE_UNIT" && n.unit.symbol)
          snapshot(n.unit.symbol);
        if (n.symbolOverride) snapshot(n.symbolOverride);
      }
    }
    return exchangeRootSchema.parse(t);
  }
}
