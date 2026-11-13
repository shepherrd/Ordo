import { z } from "zod";
import type { Repository, Runtime } from "./ports";
import type {
  GraphicRenderPort,
  GraphicRenderRequest,
  RasterPort,
} from "./render-contracts";
import {
  graphicExportProfileSchema,
  graphicExportRecordSchema,
  type GraphicExportRecord,
} from "../domain/graphic-exports";
import { symbolId } from "../domain/symbology";
import { newOrbatLayout, m6Limits } from "../domain/orbat";
import { createNativeExchange } from "./native-exchange";
import {
  diagramFromSaved,
  diagramFromOperation,
  selectDiagram,
} from "./orbat-projection";
import { canonical } from "../export/projection";
import { projectGraphicV2 } from "../export/graphic-projection-v2";
import { presentGraphicSvg } from "./graphic-output";
export const graphicExportCommandSchema = z
  .object({
    source: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("SAVED_SYMBOL"),
          versionId: symbolId,
          expectedContentVersion: z.number().int().positive(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("SAVED_ORBAT"),
          versionId: symbolId,
          expectedContentVersion: z.number().int().positive(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("OPERATION"),
          operationId: symbolId,
          revision: z.number().int().positive(),
          publicationId: symbolId.nullable(),
        })
        .strict(),
    ]),
    profile: graphicExportProfileSchema.refine(
      (p) =>
        !p.jsonMode ||
        p.jsonMode === "DERIVED" ||
        p.jsonMode === "NATIVE_EXCHANGE",
      "This archived export format is read-only. Choose Ordo JSON.",
    ),
  })
  .strict();
export type GraphicExportCommand = z.infer<typeof graphicExportCommandSchema>;
export class GraphicExportService {
  constructor(
    private repo: Repository,
    private rt: Runtime,
    private renderer: GraphicRenderPort,
    private raster: RasterPort,
  ) {}
  private resolve(input: unknown) {
    const c = graphicExportCommandSchema.parse(input),
      p = c.profile,
      selector = c.source;
    if (p.renderProfile.id !== "ordo-symbol" || p.renderProfile.version !== 1)
      throw Error("Unavailable graphic render profile");
    if ((selector.kind === "SAVED_SYMBOL") !== (p.product === "SYMBOL"))
      throw Error("Graphic product does not match its source");
    let source: GraphicExportRecord["source"], request: GraphicRenderRequest;
    if (selector.kind === "SAVED_SYMBOL") {
      const v = this.repo.getSymbol(selector.versionId);
      if (v.contentVersion !== selector.expectedContentVersion)
        throw Error("Symbol changed; reload before exporting");
      const snapshot =
        v.status === "RETIRED"
          ? { ...v, status: "PUBLISHED" as const, retiredAt: null }
          : v;
      source = {
        kind: selector.kind,
        ref: {
          familyId: v.familyId,
          versionId: v.versionId,
          contentHash: this.repo.libraryHash("SYMBOL", v.versionId),
        },
        contentVersion: v.contentVersion,
        snapshot,
      };
      request = {
        kind: "SYMBOL",
        input: {
          definition: snapshot.definition,
          size: p.size,
          context: "SYMBOL",
          labelSide: "RIGHT",
        },
      };
    } else if (selector.kind === "SAVED_ORBAT") {
      const v = this.repo.getOrbat(selector.versionId);
      if (v.contentVersion !== selector.expectedContentVersion)
        throw Error("ORBAT changed; reload before exporting");
      const snapshot =
        v.status === "RETIRED"
          ? { ...v, status: "PUBLISHED" as const, retiredAt: null }
          : v;
      source = {
        kind: selector.kind,
        ref: {
          familyId: v.familyId,
          versionId: v.versionId,
          contentHash: this.repo.libraryHash("ORBAT", v.versionId),
        },
        contentVersion: v.contentVersion,
        snapshot,
      };
      request = {
        kind: "ORBAT",
        input: { ...selectDiagram(diagramFromSaved(v), p), symbolSize: p.size },
      };
    } else {
      const op = this.repo.getOperation(
        selector.operationId,
        selector.revision,
      );
      if (
        selector.publicationId &&
        !this.repo
          .listPublications(op.id)
          .some(
            (pub) =>
              pub.id === selector.publicationId &&
              pub.sourceRevision === op.revision,
          )
      )
        throw Error("Publication does not freeze the selected revision");
      source = {
        kind: "OPERATION",
        operationId: op.id,
        revision: op.revision,
        publicationId: selector.publicationId,
        contentHash: this.repo.hash(canonical(op)),
      };
      // Legacy operations have no persisted M6 layout. A stable operation UUID is
      // sufficient for this derived default and never writes into historical data.
      request = {
        kind: "ORBAT",
        input: {
          ...selectDiagram(
            diagramFromOperation(
              op,
              newOrbatLayout(() => op.id),
            ),
            p,
          ),
          symbolSize: p.size,
        },
      };
    }
    if (request.kind === "ORBAT" && request.input.nodes.length === 0)
      throw Error("Select at least one unit to export");
    return { p, selector, source, request };
  }
  async generate(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<GraphicExportRecord> {
    const resolved = this.resolve(input),
      { p, selector, source } = resolved;
    let request = resolved.request;
    if (p.jsonMode === "NATIVE_EXCHANGE") {
      if (source.kind === "OPERATION")
        throw Error(
          "Native library exchange requires a Saved Symbol or Saved ORBAT",
        );
      const envelope = createNativeExchange(
        source.kind === "SAVED_SYMBOL"
          ? { kind: "SYMBOL", value: source.snapshot }
          : { kind: "ORBAT", value: source.snapshot },
        this.repo,
        (t) => this.repo.hash(t),
      );
      const bytes = new TextEncoder().encode(JSON.stringify(envelope) + "\n");
      if (bytes.byteLength > m6Limits.jsonBytes)
        throw Error("Native exchange exceeds the 10 MiB import limit");
      if (signal?.aborted) throw Error("Graphic export cancelled");
      const record = graphicExportRecordSchema.parse({
        schemaVersion: 1,
        id: this.rt.id(),
        source,
        profile: p,
        profileHash: this.repo.hash(canonical(p)),
        generatedAt: this.rt.now(),
        actor: this.rt.actor,
        projectionVersion: 5,
        layoutVersion: null,
        renderManifests: [],
        dependencies: [
          { path: "exchange/envelope", canonicalValue: canonical(envelope) },
        ],
        mimeType: "application/json",
        byteLength: bytes.byteLength,
        contentHash: this.repo.hashBinary(bytes),
        raster: null,
      });
      this.repo.transaction(() => {
        this.repo.saveGraphicProfile(p);
        this.repo.insertGraphicExport(record, bytes);
      });
      return record;
    }
    const projection = projectGraphicV2(
      source,
      p,
      source.kind === "OPERATION"
        ? this.repo.getOperation(source.operationId, source.revision)
        : undefined,
    );
    request = projection.request;
    const rendered = await this.renderer.render(request, signal);
    if (rendered.kind !== request.kind) throw Error("Unexpected render result");
    const dependencies = projection.dependencies;
    const renderManifests =
      rendered.kind === "SYMBOL"
        ? [rendered.result.manifest]
        : rendered.result.renderManifests;
    let bytes: Uint8Array,
      raster: GraphicExportRecord["raster"] = null;
    if (p.format === "PNG") {
      const result = await this.raster.rasterize(
        rendered.result.svg,
        p.scale,
        p.background,
        signal,
      );
      bytes = result.bytes;
      const { bytes: _bytes, ...manifest } = result;
      raster = manifest;
    } else if (p.format === "SVG") {
      bytes = new TextEncoder().encode(
        presentGraphicSvg(rendered.result.svg, p),
      );
    } else {
      // Selected JSON contains only the selected projection. Full local source
      // snapshots stay in the immutable workspace provenance record.
      bytes = new TextEncoder().encode(
        JSON.stringify(
          {
            schemaVersion: 1,
            format: "ORDO_GRAPHIC",
            projectionVersion: 5,
            source:
              source.kind === "OPERATION"
                ? source
                : {
                    kind: source.kind,
                    ref: source.ref,
                    contentVersion: source.contentVersion,
                  },
            profile: p,
            renderManifests,
            request,
          },
          null,
          2,
        ) + "\n",
      );
    }
    if (signal?.aborted) throw Error("Graphic export cancelled");
    const record = graphicExportRecordSchema.parse({
      schemaVersion: 2,
      dependencyVersion: "graphic-input-v2",
      renderedSvg: rendered.result.svg,
      renderedSvgHash: this.repo.hash(rendered.result.svg),
      id: this.rt.id(),
      source,
      profile: p,
      profileHash: this.repo.hash(canonical(p)),
      generatedAt: this.rt.now(),
      actor: this.rt.actor,
      projectionVersion: 5,
      layoutVersion:
        request.kind === "ORBAT" ? request.input.layout.algorithm : null,
      renderManifests,
      dependencies,
      mimeType: {
        SVG: "image/svg+xml",
        PNG: "image/png",
        JSON: "application/json",
      }[p.format],
      byteLength: bytes.byteLength,
      contentHash: this.repo.hashBinary(bytes),
      raster,
    });
    this.repo.transaction(() => {
      if (selector.kind !== "OPERATION") {
        const current =
          selector.kind === "SAVED_SYMBOL"
            ? this.repo.getSymbol(selector.versionId)
            : this.repo.getOrbat(selector.versionId);
        if (current.contentVersion !== selector.expectedContentVersion)
          throw Error("Source changed while exporting; generate again");
      }
      this.repo.saveGraphicProfile(p);
      this.repo.insertGraphicExport(record, bytes);
    });
    return record;
  }
}
