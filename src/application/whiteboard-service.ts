import { z } from "zod";
import type { Repository, Runtime } from "./ports";
import type { SymbologyRepository } from "./symbology-ports";
import type { GraphicRenderPort } from "./render-contracts";
import { assetSchema, type ManagedAsset } from "../domain/modules";
import { renderManifestSchema } from "../domain/symbology";
import { planningTargetSchema } from "../domain/planning-target";
import type { SearchTarget } from "../domain/planning-target";
import { cardSourceTargets } from "../domain/planning-usage";
import type { WhiteboardItem } from "../domain/whiteboards";
import { canonical } from "../export/projection";
import { projectWhiteboard, renderWhiteboard } from "../export/whiteboard-v1";
import { assertGeneratedSvg } from "../validation/generated-svg";
import { assertWhiteboardSvg } from "../validation/whiteboard-svg";
import { graphicImage } from "./graphic-image";
import { briefingSource } from "./briefing-service";
const id = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const whiteboardCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("generate"),
      operationId: id,
      boardId: id,
      expectedRevision: z.number().int().positive(),
      revision: z.number().int().positive(),
      publicationId: id.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("list"),
      operationId: id,
      offset: z.number().int().min(0).max(100000).default(0),
    })
    .strict(),
  z.object({ type: z.literal("preview"), id }).strict(),
  z.object({ type: z.literal("image"), id }).strict(),
  z
    .object({ type: z.literal("save"), id, format: z.enum(["PNG", "SVG"]) })
    .strict(),
]);
export type WhiteboardCommand = z.input<typeof whiteboardCommandSchema>;
const resourceSchema = z
  .object({
    itemId: id,
    data: z.string().max(14 * 1024 * 1024),
    hash,
    label: z.string().max(160),
    manifest: renderManifestSchema.optional(),
  })
  .strict();
export const whiteboardSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    rendererVersion: z.literal("whiteboard-v1"),
    id,
    operationId: id,
    boardId: id,
    name: z.string().max(160),
    sourceRevision: z.number().int().positive(),
    sourcePublicationId: id.nullable(),
    sourceHash: hash,
    viewHash: hash,
    generatedAt: z.string().datetime(),
    actor: z.string().max(160),
    svg: z.string().max(16 * 1024 * 1024),
    svgHash: hash,
    pngHash: hash,
    pngBytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    resources: z.array(resourceSchema).max(300),
    cardIds: z.array(id).max(300),
    sources: z.array(planningTargetSchema).max(300),
    environment: z
      .object({
        appVersion: z.string().max(32),
        electron: z.string().max(32),
        chromium: z.string().max(32),
        fontFingerprint: hash,
      })
      .strict(),
  })
  .strict();
export type WhiteboardSnapshot = z.infer<typeof whiteboardSnapshotSchema>;
export type WhiteboardSummary = Omit<
  WhiteboardSnapshot,
  "svg" | "resources"
> & {
  status: "Current" | "Outdated" | "Source unavailable";
  sourceTargets: SearchTarget[];
};
export type WhiteboardResult = {
  record?: WhiteboardSummary;
  records?: WhiteboardSummary[];
  data?: string;
  asset?: ManagedAsset;
  path?: string | null;
};
export interface WhiteboardStorePort {
  insert(record: WhiteboardSnapshot, bytes: Uint8Array): void;
  get(id: string): { record: WhiteboardSnapshot; bytes: Uint8Array };
  list(operationId: string, offset?: number): WhiteboardSnapshot[];
  image(id: string, asset: ManagedAsset): void;
}
export interface WhiteboardRenderPort {
  renderWhiteboard(svg: string): Promise<{
    bytes: Uint8Array;
    environment: WhiteboardSnapshot["environment"];
  }>;
}
export type WhiteboardRepository = Repository &
  Pick<SymbologyRepository, "verifySymbolPin" | "getGraphicExport">;
export const boardSymbolInput = (
  item: Extract<WhiteboardItem, { kind: "symbol" }>,
) => ({
  definition: item.pin.definition,
  size: 160,
  context: "SYMBOL" as const,
  labelSide: "RIGHT" as const,
});
export function binaryData(bytes: Uint8Array, mime: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
const decodeData = (data: string) =>
  Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );
function boardSource(
  repo: WhiteboardRepository,
  record: Pick<
    WhiteboardSnapshot,
    "operationId" | "sourceRevision" | "sourcePublicationId" | "boardId"
  >,
) {
  const { op, config } = briefingSource(
    repo,
    record.operationId,
    record.sourceRevision,
    record.sourcePublicationId,
  );
  const board = op.whiteboards?.boards.find((b) => b.id === record.boardId);
  if (!board)
    throw Error("Whiteboard is unavailable in the selected saved source.");
  return { op, config, board };
}
export function verifyWhiteboard(
  repo: WhiteboardRepository,
  record: WhiteboardSnapshot,
  bytes: Uint8Array,
) {
  whiteboardSnapshotSchema.parse(record);
  const { op, config, board } = boardSource(repo, record),
    view = projectWhiteboard(op, config, board);
  const imageItems = board.items.filter(
    (i) => i.kind === "symbol" || i.kind === "graphic",
  );
  if (
    record.resources.length !== imageItems.length ||
    new Set(record.resources.map((r) => r.itemId)).size !== imageItems.length
  )
    throw Error("Whiteboard resources differ from their source");
  for (const r of record.resources) {
    const item = imageItems.find((i) => i.id === r.itemId);
    if (!item || repo.hashBinary(decodeData(r.data)) !== r.hash)
      throw Error("Whiteboard resource hash mismatch");
    if (item.kind === "symbol") {
      const svg = new TextDecoder().decode(decodeData(r.data));
      assertGeneratedSvg(svg);
      repo.verifySymbolPin(item.pin, true);
      if (
        !r.data.startsWith("data:image/svg+xml;base64,") ||
        r.label !== item.label ||
        r.manifest?.inputHash !==
          repo.hash(canonical(boardSymbolInput(item))) ||
        r.manifest.definitionHash !== item.pin.definitionHash
      )
        throw Error("Whiteboard symbol provenance differs");
    } else if (
      canonical({
        ...graphicImage(repo, item.exportId),
        label: item.label,
      }) !== canonical({ data: r.data, hash: r.hash, label: r.label }) ||
      r.manifest
    )
      throw Error("Whiteboard graphic differs from retained source");
  }
  const rendered = renderWhiteboard(
    view,
    new Map(record.resources.map((r) => [r.itemId, r])),
  );
  const cards = board.items.flatMap((i) =>
    i.kind === "card" ? [i.cardId] : [],
  );
  const sources = cards.flatMap((id) => {
    const c = op.planningCards?.definitions.find((c) => c.id === id);
    return c?.mode === "linked" ? [c.source] : [];
  });
  assertWhiteboardSvg(record.svg);
  if (
    rendered.issues.length ||
    record.name !== board.name ||
    canonical(cards) !== canonical(record.cardIds) ||
    canonical(sources) !== canonical(record.sources) ||
    record.sourceHash !== repo.hash(canonical({ op, config })) ||
    record.viewHash !== repo.hash(canonical(view)) ||
    record.svg !== rendered.svg ||
    record.svgHash !== repo.hash(record.svg) ||
    record.pngHash !== repo.hashBinary(bytes) ||
    record.pngBytes !== bytes.byteLength ||
    !binaryData(bytes.slice(0, 8), "image/png").endsWith("iVBORw0KGgo=")
  )
    throw Error("Whiteboard snapshot differs from its frozen source");
}
export function summarizeWhiteboard(
  repo: WhiteboardRepository,
  record: WhiteboardSnapshot,
): WhiteboardSummary {
  const { svg: _svg, resources: _resources, ...summary } = record;
  let status: WhiteboardSummary["status"] = "Source unavailable";
  try {
    const op = repo.getOperation(record.operationId),
      board = op.whiteboards?.boards.find((b) => b.id === record.boardId);
    if (board)
      status =
        repo.hash(
          canonical(projectWhiteboard(op, repo.getConfig(op), board)),
        ) === record.viewHash
          ? "Current"
          : "Outdated";
  } catch {
    /* The retained snapshot still exists after the authoring source is removed. */
  }
  const frozen = repo.getOperation(record.operationId, record.sourceRevision);
  return {
    ...summary,
    status,
    sourceTargets: cardSourceTargets(
      frozen,
      record.cardIds,
      repo.cardOrigins?.(frozen),
    ),
  };
}
export class WhiteboardService {
  constructor(
    private repo: WhiteboardRepository,
    private store: WhiteboardStorePort,
    private rt: Runtime,
    private symbols: GraphicRenderPort,
    private renderer: WhiteboardRenderPort,
  ) {}
  list(operationId: string, offset = 0) {
    return this.store
      .list(operationId, offset)
      .map((r) => summarizeWhiteboard(this.repo, r));
  }
  async generate(input: unknown) {
    const c = whiteboardCommandSchema.parse(input);
    if (c.type !== "generate") throw Error("Expected snapshot generation");
    if (this.repo.getOperation(c.operationId).revision !== c.expectedRevision)
      throw Error("Operation changed. Reload before creating a snapshot.");
    const { op, config, board } = boardSource(this.repo, {
      operationId: c.operationId,
      sourceRevision: c.revision,
      sourcePublicationId: c.publicationId,
      boardId: c.boardId,
    });
    if (!board.items.length)
      throw Error("Add an item before creating a snapshot.");
    const resources: WhiteboardSnapshot["resources"] = [];
    for (const item of board.items) {
      if (item.kind === "symbol") {
        this.repo.verifySymbolPin(item.pin, true);
        const r = await this.symbols.render({
          kind: "SYMBOL",
          input: boardSymbolInput(item),
        });
        if (r.kind !== "SYMBOL")
          throw Error("Unexpected symbol renderer result");
        resources.push({
          itemId: item.id,
          data: binaryData(
            new TextEncoder().encode(r.result.svg),
            "image/svg+xml",
          ),
          hash: r.result.svgHash,
          label: item.label,
          manifest: r.result.manifest,
        });
      } else if (item.kind === "graphic")
        resources.push({
          ...graphicImage(this.repo, item.exportId),
          label: item.label,
          itemId: item.id,
        });
      if (resources.reduce((n, r) => n + r.data.length, 0) > 14 * 1024 * 1024)
        throw Error(
          "Whiteboard graphics exceed 14 MiB. Use smaller graphics or split this board.",
        );
    }
    const view = projectWhiteboard(op, config, board),
      rendered = renderWhiteboard(
        view,
        new Map(resources.map((r) => [r.itemId, r])),
      );
    if (rendered.issues.length) throw Error(rendered.issues.join("\n"));
    assertWhiteboardSvg(rendered.svg);
    const image = await this.renderer.renderWhiteboard(rendered.svg);
    if (this.repo.getOperation(c.operationId).revision !== c.expectedRevision)
      throw Error("Operation changed while creating the snapshot.");
    const cardIds = board.items.flatMap((i) =>
      i.kind === "card" ? [i.cardId] : [],
    );
    const record = whiteboardSnapshotSchema.parse({
      schemaVersion: 1,
      rendererVersion: "whiteboard-v1",
      id: this.rt.id(),
      operationId: op.id,
      boardId: board.id,
      name: board.name,
      sourceRevision: op.revision,
      sourcePublicationId: c.publicationId,
      sourceHash: this.repo.hash(canonical({ op, config })),
      viewHash: this.repo.hash(canonical(view)),
      generatedAt: this.rt.now(),
      actor: this.rt.actor,
      svg: rendered.svg,
      svgHash: this.repo.hash(rendered.svg),
      pngHash: this.repo.hashBinary(image.bytes),
      pngBytes: image.bytes.byteLength,
      resources,
      cardIds,
      sources: cardIds.flatMap((id) => {
        const c = op.planningCards?.definitions.find((c) => c.id === id);
        return c?.mode === "linked" ? [c.source] : [];
      }),
      environment: image.environment,
    });
    this.repo.transaction(() => this.store.insert(record, image.bytes));
    return summarizeWhiteboard(this.repo, record);
  }
  image(snapshotId: string) {
    const { record, bytes } = this.store.get(snapshotId),
      id = this.rt.id();
    const asset = assetSchema.parse({
      assetId: id,
      operationId: record.operationId,
      doctrineVersionId: null,
      originalFilename: `${record.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")} - whiteboard snapshot r${record.sourceRevision}.png`,
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      sha256: record.pngHash,
      createdAt: this.rt.now(),
      storageReference: `asset:${id}`,
    });
    this.store.image(snapshotId, asset);
    return { asset, data: binaryData(bytes, "image/png") };
  }
}
