import { z } from "zod";
import type { Repository, Runtime } from "./ports";
import type {
  SymbolLibraryVersion,
  SymbolLibraryKind,
  SymbolLibrarySummary,
} from "./symbology-ports";
import {
  savedSymbolVersionSchema,
  militarySymbolDefinitionSchema,
  newSavedSymbol,
  inheritedSymbol,
  symbolId as id,
  type SavedSymbolVersion,
} from "../domain/symbology";
import {
  savedOrbatVersionSchema,
  newOrbatLayout,
  type SavedOrbatVersion,
  type OrbatImportReceipt,
  type OrbatNode,
} from "../domain/orbat";
import { newUnitProfile, profileSymbol } from "../domain/unit-profiles";
import { metadata, type Operation } from "../domain/model";
import { assertOperation } from "../domain/invariants";
import { canonical } from "../export/projection";
const kind = z.enum(["SYMBOL", "ORBAT"]),
  counter = z.number().int().positive();
export const libraryCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("new-symbol-from-definition"),
      name: z.string().trim().min(1).max(160),
      definition: militarySymbolDefinitionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("browse"),
      kind,
      query: z
        .object({
          search: z.string().max(200),
          status: z.enum(["", "DRAFT", "PUBLISHED", "RETIRED"]),
          offset: z.number().int().min(0).max(100000),
          limit: z.number().int().min(1).max(100),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("get"), kind, id }).strict(),
  z
    .object({
      type: z.literal("new"),
      kind,
      name: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal("save-symbol"),
      value: savedSymbolVersionSchema,
      expected: counter,
    })
    .strict(),
  z
    .object({
      type: z.literal("save-orbat"),
      value: savedOrbatVersionSchema,
      expected: counter,
    })
    .strict(),
  z
    .object({ type: z.literal("publish"), kind, id, expected: counter })
    .strict(),
  z.object({ type: z.literal("retire"), kind, id }).strict(),
  z.object({ type: z.literal("delete-draft"), kind, id }).strict(),
  z
    .object({
      type: z.literal("derive"),
      kind,
      id,
      versionLabel: z.string().regex(/^\d+\.\d+\.\d+$/),
      newFamily: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("symbol-pin"), id }).strict(),
  z.object({ type: z.literal("profile-node"), id, parentNodeId: id }).strict(),
  z
    .object({
      type: z.literal("orbat-from-profile"),
      id,
      name: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal("import-orbat"),
      operationId: id,
      expectedRevision: counter,
      orbatVersionId: id,
      importId: id,
      parentUnitId: id.nullable(),
      confirmDuplicate: z.boolean(),
      replaceLayout: z.boolean(),
    })
    .strict(),
]);
export type LibraryCommand = z.infer<typeof libraryCommandSchema>;
export interface LibraryResult {
  symbol?: SavedSymbolVersion;
  orbat?: SavedOrbatVersion;
  page?: { items: SymbolLibrarySummary[]; total: number };
  pin?: ReturnType<Repository["resolveSymbolPin"]>;
  operation?: Operation;
  receipt?: OrbatImportReceipt;
  node?: OrbatNode;
}
export class SymbologyService {
  constructor(
    private repo: Repository,
    private rt: Runtime,
  ) {}
  private get(kind: SymbolLibraryKind, id: string): SymbolLibraryVersion {
    return kind === "SYMBOL" ? this.repo.getSymbol(id) : this.repo.getOrbat(id);
  }
  private result(
    kind: SymbolLibraryKind,
    v: SymbolLibraryVersion,
  ): LibraryResult {
    return kind === "SYMBOL"
      ? { symbol: v as SavedSymbolVersion }
      : { orbat: v as SavedOrbatVersion };
  }
  execute(input: unknown): LibraryResult {
    const c = libraryCommandSchema.parse(input);
    if (c.type === "browse")
      return { page: this.repo.browseLibrary(c.kind, c.query) };
    if (c.type === "get") return this.result(c.kind, this.get(c.kind, c.id));
    if (c.type === "symbol-pin")
      return { pin: this.repo.resolveSymbolPin(c.id) };
    if (c.type === "profile-node") {
      const p = this.repo.getUnitProfile(c.id);
      if (p.status !== "PUBLISHED")
        throw Error("Select an exact published profile");
      return {
        node: {
          nodeId: this.rt.id(),
          parentNodeId: c.parentNodeId,
          unit: {
            kind: "UNIT_PROFILE",
            source: {
              familyId: p.unitProfileFamilyId,
              versionId: p.unitProfileVersionId,
              contentHash: this.repo.unitProfileHash(p.unitProfileVersionId),
            },
            identity: p.identity,
            defaultSymbol: profileSymbol(p),
            sourceRelationshipPath: [],
          },
          nameOverride: null,
          annotation: "",
          symbolOverride: null,
        },
      };
    }
    return this.repo.transaction(() => {
      if (c.type === "new-symbol-from-definition") {
        const value = newSavedSymbol(c.name, this.rt.id, this.rt.now());
        value.definition = {
          ...structuredClone(c.definition),
          definitionId: value.definition.definitionId,
        };
        this.repo.saveLibrary("SYMBOL", value, null);
        return { symbol: value };
      }
      if (c.type === "import-orbat") return this.importOrbat(c);
      if (c.type === "orbat-from-profile")
        return this.fromProfile(c.id, c.name);
      if (c.type === "new") {
        const base = newSavedSymbol(c.name, this.rt.id, this.rt.now());
        if (c.kind === "SYMBOL") {
          this.repo.saveLibrary("SYMBOL", base, null);
          return { symbol: base };
        }
        const { definition: _d, ...common } = base,
          root = this.rt.id();
        const v: SavedOrbatVersion = {
          ...common,
          rootNodeId: root,
          nodes: [
            {
              nodeId: root,
              parentNodeId: null,
              unit: {
                kind: "INLINE_UNIT",
                identity: newUnitProfile(c.name, this.rt.id, this.rt.now())
                  .identity,
                symbol: null,
              },
              nameOverride: null,
              annotation: "",
              symbolOverride: null,
            },
          ],
          layout: newOrbatLayout(this.rt.id),
        };
        this.repo.saveLibrary("ORBAT", v, null);
        return { orbat: v };
      }
      if (c.type === "retire") {
        this.repo.retireLibrary(c.kind, c.id, this.rt.now());
        return this.result(c.kind, this.get(c.kind, c.id));
      }
      if (c.type === "delete-draft") {
        this.repo.deleteLibraryDraft(c.kind, c.id);
        return {};
      }
      if (c.type === "derive") {
        const source = this.get(c.kind, c.id);
        if (!c.newFamily && source.status === "DRAFT")
          throw Error("Create a version from a published or retired source");
        const v = structuredClone(source),
          now = this.rt.now();
        v.versionId = this.rt.id();
        v.versionLabel = c.versionLabel;
        v.contentVersion = 1;
        v.status = "DRAFT";
        v.createdAt = now;
        v.updatedAt = now;
        v.publishedAt = null;
        v.retiredAt = null;
        v.parentVersionId = c.newFamily ? null : source.versionId;
        if (c.newFamily) {
          v.familyId = this.rt.id();
          v.duplicatedFrom = {
            familyId: source.familyId,
            versionId: source.versionId,
            contentHash: this.repo.libraryHash(c.kind, source.versionId),
          };
          if ("definition" in v) v.definition.definitionId = this.rt.id();
          else {
            const map = new Map(v.nodes.map((n) => [n.nodeId, this.rt.id()]));
            v.rootNodeId = map.get(v.rootNodeId)!;
            v.nodes.forEach((n) => {
              n.nodeId = map.get(n.nodeId)!;
              n.parentNodeId = n.parentNodeId ? map.get(n.parentNodeId)! : null;
              if (
                n.unit.kind === "INLINE_UNIT" &&
                n.unit.symbol &&
                !n.unit.symbol.source
              )
                n.unit.symbol.definition.definitionId = this.rt.id();
              if (n.symbolOverride && !n.symbolOverride.source)
                n.symbolOverride.definition.definitionId = this.rt.id();
            });
            v.layout.layoutId = this.rt.id();
            v.layout.hints.forEach((h) => (h.nodeId = map.get(h.nodeId)!));
            v.layout.siblingOrder = v.layout.siblingOrder.map((id) =>
              map.get(id)!,
            );
          }
        }
        this.repo.saveLibrary(c.kind, v, null);
        return this.result(c.kind, v);
      }
      const k =
        c.type === "save-symbol"
          ? "SYMBOL"
          : c.type === "save-orbat"
            ? "ORBAT"
            : c.kind;
      const old = this.get(k, c.type === "publish" ? c.id : c.value.versionId);
      if (old.status !== "DRAFT" || old.contentVersion !== c.expected)
        throw Error("Library Draft changed or is immutable");
      const v = c.type === "publish" ? old : structuredClone(c.value);
      if (v.status !== "DRAFT") throw Error("Use explicit Publish");
      v.contentVersion = old.contentVersion + 1;
      v.updatedAt = this.rt.now();
      if (c.type === "publish") {
        v.status = "PUBLISHED";
        v.publishedAt = v.updatedAt;
      }
      this.repo.saveLibrary(k, v, c.expected);
      return this.result(k, v);
    });
  }
  private fromProfile(id: string, name: string): LibraryResult {
    const root = this.repo.getUnitProfile(id);
    if (root.status !== "PUBLISHED")
      throw Error("Select an exact published profile");
    const base = newSavedSymbol(name, this.rt.id, this.rt.now()),
      { definition: _d, ...common } = base;
    const nodes: SavedOrbatVersion["nodes"] = [];
    const add = (
      versionId: string,
      parentNodeId: string | null,
      path: string[],
      families: Set<string>,
    ) => {
      const p = this.repo.getUnitProfile(versionId);
      if (p.status === "DRAFT" || families.has(p.unitProfileFamilyId))
        throw Error("Invalid standing hierarchy");
      if (nodes.length >= 2000 || families.size >= 64)
        throw Error("ORBAT size/depth limit exceeded");
      const nodeId = this.rt.id();
      nodes.push({
        nodeId,
        parentNodeId,
        unit: {
          kind: "UNIT_PROFILE",
          source: {
            familyId: p.unitProfileFamilyId,
            versionId: p.unitProfileVersionId,
            contentHash: this.repo.unitProfileHash(p.unitProfileVersionId),
          },
          identity: p.identity,
          defaultSymbol: profileSymbol(p),
          sourceRelationshipPath: path,
        },
        nameOverride: null,
        annotation: "",
        symbolOverride: null,
      });
      for (const r of p.standingSubordinates)
        add(
          r.unitProfileVersionId,
          nodeId,
          [...path, r.relationshipId],
          new Set([...families, p.unitProfileFamilyId]),
        );
      return nodeId;
    };
    const rootNodeId = add(id, null, [], new Set()),
      v: SavedOrbatVersion = {
        ...common,
        rootNodeId,
        nodes,
        layout: newOrbatLayout(this.rt.id),
      };
    this.repo.saveLibrary("ORBAT", v, null);
    return { orbat: v };
  }
  private importOrbat(
    c: Extract<LibraryCommand, { type: "import-orbat" }>,
  ): LibraryResult {
    // The expected revision and duplicate confirmation are transport guards, not
    // the import identity. A retry after later edits still returns its receipt.
    const requestHash = this.repo.hash(
      canonical({
        operationId: c.operationId,
        orbatVersionId: c.orbatVersionId,
        parentUnitId: c.parentUnitId,
        replaceLayout: c.replaceLayout,
      }),
    );
    const receipt = this.repo.getOrbatImport(c.operationId, c.importId);
    if (receipt) {
      if (receipt.requestHash !== requestHash)
        throw Error("Import UUID was already used for a different request");
      return { receipt, operation: this.repo.getOperation(c.operationId) };
    }
    const op = this.repo.getOperation(c.operationId),
      v = this.repo.getOrbat(c.orbatVersionId);
    if (op.revision !== c.expectedRevision)
      throw Error("Operation changed; reload before import");
    if (v.status !== "PUBLISHED")
      throw Error("Select a published non-retired ORBAT");
    if (c.parentUnitId && !op.units.some((u) => u.id === c.parentUnitId))
      throw Error("Import parent does not exist");
    if (
      !c.confirmDuplicate &&
      v.nodes.some(
        (n) =>
          n.unit.kind === "UNIT_PROFILE" &&
          op.units.some(
            (u) =>
              u.sourceUnitProfile?.sourceUnitProfileFamilyId ===
              (n.unit.kind === "UNIT_PROFILE" ? n.unit.source.familyId : null),
          ),
      )
    )
      throw Error(
        "Confirm duplicate profile reuse to create independent units",
      );
    if (op.units.length + v.nodes.length > 2000)
      throw Error("ORBAT import exceeds 2,000 units");
    const map = new Map(v.nodes.map((n) => [n.nodeId, this.rt.id()])),
      source = {
        familyId: v.familyId,
        versionId: v.versionId,
        contentHash: this.repo.libraryHash("ORBAT", v.versionId),
      },
      wasEmpty = !op.units.some((u) => u.inTaskOrganization),
      config = this.repo.getConfig(op);
    for (const n of v.nodes) {
      const { fullDesignation, ...identity } = n.unit.identity;
      const base =
        n.unit.kind === "UNIT_PROFILE"
          ? n.unit.defaultSymbol
            ? inheritedSymbol(n.unit.defaultSymbol)
            : null
          : n.unit.symbol
            ? {
                schemaVersion: 1 as const,
                base: n.unit.symbol,
                override: null,
                labels: {
                  uniqueDesignation: { kind: "UNIT_NAME" as const },
                  higherFormation: { kind: "DEFINITION" as const },
                },
              }
            : null;
      // A symbol-only composition override supplies the base when no profile
      // default exists; otherwise it remains an explicit operation override.
      const symbol = base
        ? { ...base, override: structuredClone(n.symbolOverride) }
        : n.symbolOverride
          ? {
              schemaVersion: 1 as const,
              base: n.symbolOverride,
              override: null,
              labels: {
                uniqueDesignation: { kind: "UNIT_NAME" as const },
                higherFormation: { kind: "DEFINITION" as const },
              },
            }
          : null;
      op.units.push({
        id: map.get(n.nodeId)!,
        name: n.nameOverride ?? fullDesignation,
        metadata: metadata(config.doctrine.editingStatus),
        inTaskOrganization: true,
        parentUnitId: n.parentNodeId
          ? map.get(n.parentNodeId)!
          : c.parentUnitId,
        profileIdentity: identity,
        sourceOrbat: {
          source,
          nodeId: n.nodeId,
          importId: c.importId,
          importerVersion: "orbat-import-v1",
        },
        ...(n.unit.kind === "UNIT_PROFILE"
          ? {
              sourceUnitProfile: {
                sourceUnitProfileFamilyId: n.unit.source.familyId,
                sourceUnitProfileVersionId: n.unit.source.versionId,
                sourceContentHash: n.unit.source.contentHash,
                importId: c.importId,
                sourceRelationshipPath: n.unit.sourceRelationshipPath,
              },
            }
          : {}),
        ...(symbol ? { symbol } : {}),
      });
    }
    const layout = structuredClone(v.layout);
    layout.layoutId = this.rt.id();
    layout.hints.forEach((h) => (h.nodeId = map.get(h.nodeId)!));
    layout.siblingOrder = layout.siblingOrder.map((id) => map.get(id)!);
    if (wasEmpty || !op.orbatLayout || c.replaceLayout) op.orbatLayout = layout;
    else {
      op.orbatLayout.hints.push(...layout.hints);
      op.orbatLayout.siblingOrder.push(...layout.siblingOrder);
    }
    op.revision++;
    op.updatedAt = this.rt.now();
    assertOperation(op, config);
    this.repo.saveOperation(op, c.expectedRevision, this.rt.actor);
    const r: OrbatImportReceipt = {
      schemaVersion: 1,
      operationId: op.id,
      importId: c.importId,
      requestHash,
      source,
      revision: op.revision,
      at: op.updatedAt,
      nodeMap: [...map].map(([nodeId, unitId]) => ({ nodeId, unitId })),
    };
    this.repo.insertOrbatImport(r);
    return { operation: op, receipt: r };
  }
}
