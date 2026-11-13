import { z } from "zod";
import type { ExportRecord } from "../domain/model";
import { paperOptionsSchema } from "../domain/document-exports";
import type { BriefingView } from "../export/briefing-v1";
import { canonical } from "../export/projection";
import { renderBriefing } from "../export/briefing-v1";
import { documentStaleness } from "./verify-document-layout";
import type { SearchTarget } from "../domain/planning-target";
import { cardSourceTargets } from "../domain/planning-usage";
import {
  briefingSource,
  resolvedBriefing,
  type BriefingRepository,
} from "./briefing-service";
import type { Runtime } from "./ports";

const id = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const officeSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("order"),
      exportId: id,
      options: paperOptionsSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("briefing"),
      deckId: id,
      revision: z.number().int().positive(),
      publicationId: id.nullable(),
    })
    .strict(),
]);
export type OfficeSource = z.infer<typeof officeSourceSchema>;
export const officeCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("generate"),
      operationId: id,
      expectedRevision: z.number().int().positive(),
      source: officeSourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("list"),
      operationId: id,
      offset: z.number().int().min(0).max(100000).optional(),
    })
    .strict(),
  z.object({ type: z.literal("save"), id }).strict(),
  z.object({ type: z.literal("inspect"), id }).strict(),
]);
export type OfficeCommand = z.infer<typeof officeCommandSchema>;
export const officeExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    rendererVersion: z.literal("office-v1"),
    id,
    operationId: id,
    sourceRevision: z.number().int().positive(),
    source: officeSourceSchema,
    format: z.enum(["DOCX", "PPTX"]),
    name: z.string().min(1).max(260),
    sourceHash: hash,
    contentHash: hash,
    byteLength: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024),
    generatedAt: z.string().datetime(),
    actor: z.string().max(160),
    engine: z
      .object({
        appVersion: z.string().max(32),
        docx: z.literal("9.12.0"),
        pptx: z.literal("4.0.1"),
      })
      .strict(),
  })
  .strict();
export type OfficeExport = z.infer<typeof officeExportSchema>;
export type OfficeSummary = OfficeExport & {
  status: "Current" | "Outdated" | "Source unavailable" | "Unsupported";
  superseded: boolean;
  sources: SearchTarget[];
  cardIds: string[];
};
export type OfficeResult = {
  record?: OfficeExport;
  records?: OfficeSummary[];
  html?: string;
  path?: string | null;
};
export type OfficePayload =
  | {
      kind: "order";
      export: ExportRecord;
      options: z.infer<typeof paperOptionsSchema>;
    }
  | { kind: "briefing"; view: BriefingView; notes: string[] };
export interface OfficeStorePort {
  insert(record: OfficeExport, bytes: Uint8Array): void;
  get(id: string): { record: OfficeExport; bytes: Uint8Array };
  list(
    operationId: string,
    offset?: number,
    format?: OfficeExport["format"],
  ): OfficeExport[];
}
export interface OfficeRenderPort {
  render(payload: OfficePayload, at: string): Promise<Uint8Array>;
  appVersion: string;
}
export function officePayload(
  repo: BriefingRepository,
  operationId: string,
  source: OfficeSource,
) {
  if (source.kind === "order") {
    const record = repo
      .listExports(operationId)
      .find((e) => e.id === source.exportId);
    if (!record)
      throw Error("The saved order export is unavailable in this operation.");
    return {
      payload: {
        kind: "order",
        export: record,
        options: source.options,
      } as OfficePayload,
      revision: record.sourceRevision,
      name: record.profile.name,
    };
  }
  const { op, config } = briefingSource(
      repo,
      operationId,
      source.revision,
      source.publicationId,
    ),
    view = resolvedBriefing(repo, op, config, source.deckId);
  return {
    payload: {
      kind: "briefing",
      view,
      notes: op
        .briefings!.decks.find((d) => d.id === source.deckId)!
        .slides.map((s) => s.notes),
    } as OfficePayload,
    revision: op.revision,
    name: view.name,
  };
}
export function verifyOffice(
  repo: BriefingRepository,
  record: OfficeExport,
  bytes: Uint8Array,
) {
  officeExportSchema.parse(record);
  const source = officePayload(repo, record.operationId, record.source);
  if (
    record.sourceRevision !== source.revision ||
    record.name !== source.name ||
    record.format !== (source.payload.kind === "order" ? "DOCX" : "PPTX") ||
    record.sourceHash !== repo.hash(canonical(source.payload)) ||
    record.contentHash !== repo.hashBinary(bytes) ||
    record.byteLength !== bytes.byteLength ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b
  )
    throw Error(
      "Office export or its provenance differs from its saved source.",
    );
}
export class OfficeService {
  constructor(
    private repo: BriefingRepository,
    private store: OfficeStorePort,
    private rt: Runtime,
    private renderer: OfficeRenderPort,
  ) {}
  inspect(id: string, format?: OfficeExport["format"]) {
    const { record } = this.store.get(id);
    if (format && record.format !== format)
      throw Error("This export format is not available in this release.");
    const { payload } = officePayload(
      this.repo,
      record.operationId,
      record.source,
    );
    return {
      record,
      html:
        payload.kind === "order"
          ? payload.export.html
          : renderBriefing(payload.view),
    };
  }
  list(
    operationId: string,
    offset = 0,
    format?: OfficeExport["format"],
  ): OfficeSummary[] {
    const op = this.repo.getOperation(operationId),
      config = this.repo.getConfig(op);
    const publications = this.repo.listPublications(operationId);
    const exports = this.repo.listExports(operationId);
    return this.store.list(operationId, offset, format).map((record) => {
      let status: OfficeSummary["status"] = "Source unavailable";
      let publicationId: string | null = null;
      let sources: SearchTarget[] = [],
        cardIds: string[] = [];
      if (record.source.kind === "order") {
        const exportId = record.source.exportId;
        const saved = exports.find((e) => e.id === exportId);
        if (saved) {
          const state = documentStaleness(saved, op);
          status =
            state.compatibility !== "supported"
              ? "Unsupported"
              : state.outdated
                ? "Outdated"
                : "Current";
          publicationId = saved.sourcePublicationId;
        }
      } else {
        const source = record.source;
        publicationId = source.publicationId;
        const frozen = briefingSource(
          this.repo,
          operationId,
          source.revision,
          source.publicationId,
        ).op;
        cardIds =
          frozen.briefings?.decks
            .find((d) => d.id === source.deckId)
            ?.slides.filter((s) => s.layout === "cards")
            .flatMap((s) => s.cardIds) ?? [];
        const origins = this.repo.cardOrigins?.(frozen) ?? {};
        sources = cardSourceTargets(frozen, cardIds, origins);
        try {
          const payload: OfficePayload = {
            kind: "briefing",
            view: resolvedBriefing(this.repo, op, config, source.deckId),
            notes: op
              .briefings!.decks.find((d) => d.id === source.deckId)!
              .slides.map((s) => s.notes),
          };
          status =
            this.repo.hash(canonical(payload)) === record.sourceHash
              ? "Current"
              : "Outdated";
        } catch {
          /* The retained file remains available after source removal. */
        }
      }
      return {
        ...record,
        status,
        sources,
        cardIds,
        superseded:
          !!publicationId &&
          publications.some((p) => p.supersedesId === publicationId),
      };
    });
  }
  async generate(input: unknown) {
    const c = officeCommandSchema.parse(input);
    if (c.type !== "generate") throw Error("Expected Office generation.");
    if (this.repo.getOperation(c.operationId).revision !== c.expectedRevision)
      throw Error("Operation changed. Reload before exporting.");
    const source = officePayload(this.repo, c.operationId, c.source),
      at = this.rt.now();
    const bytes = await this.renderer.render(source.payload, at);
    if (this.repo.getOperation(c.operationId).revision !== c.expectedRevision)
      throw Error("Operation changed during export. Try again.");
    const record = officeExportSchema.parse({
      schemaVersion: 1,
      rendererVersion: "office-v1",
      id: this.rt.id(),
      operationId: c.operationId,
      sourceRevision: source.revision,
      source: c.source,
      format: source.payload.kind === "order" ? "DOCX" : "PPTX",
      name: source.name,
      sourceHash: this.repo.hash(canonical(source.payload)),
      contentHash: this.repo.hashBinary(bytes),
      byteLength: bytes.byteLength,
      generatedAt: at,
      actor: this.rt.actor,
      engine: {
        appVersion: this.renderer.appVersion,
        docx: "9.12.0",
        pptx: "4.0.1",
      },
    });
    this.repo.transaction(() => this.store.insert(record, bytes));
    return record;
  }
}
