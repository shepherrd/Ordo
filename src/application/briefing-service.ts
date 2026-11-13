import { graphicImage } from "./graphic-image";
import { z } from "zod";
import type { Repository, Runtime } from "./ports";
import type { SymbologyRepository } from "./symbology-ports";
import type { DocumentExport } from "../domain/document-exports";
import type { Operation, ResolvedConfig } from "../domain/model";
import type { BriefingSlide } from "../domain/briefings";
import type { PlanningTarget } from "../domain/planning-target";
import type { SearchTarget } from "../domain/planning-target";
import { cardSourceTargets } from "../domain/planning-usage";
import { canonical } from "../export/projection";
import {
  projectBriefing,
  renderBriefing,
  type BriefingGraphic,
  type BriefingView,
} from "../export/briefing-v1";
const id = z.string().uuid(),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const briefingCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("generate"),
      operationId: id,
      deckId: id,
      expectedRevision: z.number().int().positive(),
      source: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("revision"),
            revision: z.number().int().positive(),
          })
          .strict(),
        z
          .object({ kind: z.literal("publication"), publicationId: id })
          .strict(),
      ]),
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
  z.object({ type: z.literal("graphic"), exportId: id }).strict(),
  z
    .object({
      type: z.literal("preview"),
      operationId: id,
      deckId: id,
      revision: z.number().int().positive(),
      publicationId: id.nullable(),
    })
    .strict(),
]);
export type BriefingCommand = z.infer<typeof briefingCommandSchema>;
export const briefingExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    rendererVersion: z.literal("briefing-v1"),
    id,
    operationId: id,
    deckId: id,
    name: z.string().max(160),
    sourceRevision: z.number().int().positive(),
    sourcePublicationId: id.nullable(),
    sourceHash: hash,
    generatedAt: z.string().datetime(),
    actor: z.string().max(160),
    html: z.string().max(32 * 1024 * 1024),
    htmlHash: hash,
    contentHash: hash,
    byteLength: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024),
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
export type BriefingExport = z.infer<typeof briefingExportSchema>;
export type BriefingSummary = Omit<BriefingExport, "html"> & {
  cardIds: string[];
  sources: PlanningTarget[];
  sourceTargets: SearchTarget[];
  status: "Current" | "Outdated" | "Source unavailable";
  superseded: boolean;
};
export type BriefingResult = {
  html?: string;
  view?: BriefingView;
  record?: BriefingExport;
  records?: BriefingSummary[];
  graphic?: BriefingGraphic;
  path?: string | null;
};
export interface BriefingStorePort {
  insert(record: BriefingExport, bytes: Uint8Array): void;
  get(id: string): { record: BriefingExport; bytes: Uint8Array };
  list(operationId: string, offset?: number): BriefingExport[];
}
export interface BriefingRenderPort {
  renderBriefing(
    html: string,
  ): Promise<{ bytes: Uint8Array; environment: DocumentExport["environment"] }>;
}
export type BriefingRepository = Repository &
  Pick<SymbologyRepository, "getGraphicExport">;
export function briefingGraphics(
  repo: BriefingRepository,
  op: Operation,
  slides: BriefingSlide[],
) {
  const values = new Map<string, BriefingGraphic>();
  let total = 0;
  for (const s of slides)
    if (s.layout === "graphic" && s.graphic) {
      if (s.graphic.kind === "export")
        values.set(s.id, graphicImage(repo, s.graphic.exportId));
      else {
        const a = s.graphic.asset;
        if (a.operationId !== op.id || !a.mimeType.startsWith("image/"))
          throw Error("A briefing image must belong to this operation.");
        repo.verifyAssetReferences([a]);
        values.set(s.id, {
          data: repo.assetData(a.assetId),
          hash: a.sha256,
          label: a.originalFilename,
        });
      }
      total += values.get(s.id)?.data.length ?? 0;
      if (total > 24 * 1024 * 1024)
        throw Error(
          "Briefing graphics exceed 24 MiB. Use smaller images or split this briefing.",
        );
    }
  return values;
}
export function briefingSource(
  repo: Repository,
  operationId: string,
  revision: number,
  publicationId: string | null,
) {
  if (publicationId) {
    const p = repo
      .listPublications(operationId)
      .find((p) => p.id === publicationId);
    if (!p || p.snapshot.revision !== revision)
      throw Error("Briefing publication source is unavailable.");
    return { op: p.snapshot, config: p.config };
  }
  const op = repo.getOperation(operationId, revision);
  return { op, config: repo.getConfig(op) };
}
export function resolvedBriefing(
  repo: BriefingRepository,
  op: Operation,
  config: ResolvedConfig,
  deckId: string,
): BriefingView {
  const deck = op.briefings?.decks.find((d) => d.id === deckId);
  if (!deck)
    throw Error("This briefing is not present in the selected source.");
  if (!deck.slides.length)
    throw Error("Add a slide before presenting or exporting.");
  const view = projectBriefing(
    op,
    config,
    deck,
    briefingGraphics(repo, op, deck.slides),
  );
  const issues = view.slides.flatMap((s, i) =>
    s.issues.map((issue) => `Slide ${i + 1}: ${issue}`),
  );
  if (issues.length) throw Error(issues.join("\n"));
  return view;
}
export function verifyBriefing(
  repo: BriefingRepository,
  record: BriefingExport,
  bytes: Uint8Array,
) {
  briefingExportSchema.parse(record);
  const { op, config } = briefingSource(
    repo,
    record.operationId,
    record.sourceRevision,
    record.sourcePublicationId,
  );
  const view = resolvedBriefing(repo, op, config, record.deckId);
  if (
    record.name !== view.name ||
    record.sourceHash !== repo.hash(canonical({ op, config })) ||
    record.html !== renderBriefing(view) ||
    record.htmlHash !== repo.hash(record.html) ||
    record.contentHash !== repo.hashBinary(bytes) ||
    record.byteLength !== bytes.byteLength ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    throw Error(
      "Briefing PDF or its provenance differs from its frozen source.",
    );
}
export class BriefingService {
  constructor(
    private repo: BriefingRepository,
    private store: BriefingStorePort,
    private rt: Runtime,
    private renderer: BriefingRenderPort,
  ) {}
  async generate(input: unknown) {
    const c = briefingCommandSchema.parse(input);
    if (c.type !== "generate") throw Error("Expected briefing generation.");
    const current = this.repo.getOperation(c.operationId);
    if (current.revision !== c.expectedRevision)
      throw Error("Operation changed. Reload before generating.");
    const publication =
      c.source.kind === "publication"
        ? this.repo
            .listPublications(c.operationId)
            .find(
              (p) =>
                p.id ===
                (c.source.kind === "publication" ? c.source.publicationId : ""),
            )
        : null;
    if (c.source.kind === "publication" && !publication)
      throw Error("Publication not found.");
    const revision =
      c.source.kind === "revision"
        ? c.source.revision
        : publication!.snapshot.revision;
    const { op, config } = briefingSource(
      this.repo,
      c.operationId,
      revision,
      publication?.id ?? null,
    );
    const view = resolvedBriefing(this.repo, op, config, c.deckId),
      html = renderBriefing(view);
    const rendered = await this.renderer.renderBriefing(html);
    if (this.repo.getOperation(c.operationId).revision !== c.expectedRevision)
      throw Error("Operation changed during PDF generation. Try again.");
    const record = briefingExportSchema.parse({
      schemaVersion: 1,
      rendererVersion: "briefing-v1",
      id: this.rt.id(),
      operationId: op.id,
      deckId: c.deckId,
      name: view.name,
      sourceRevision: op.revision,
      sourcePublicationId: publication?.id ?? null,
      sourceHash: this.repo.hash(canonical({ op, config })),
      generatedAt: this.rt.now(),
      actor: this.rt.actor,
      html,
      htmlHash: this.repo.hash(html),
      contentHash: this.repo.hashBinary(rendered.bytes),
      byteLength: rendered.bytes.byteLength,
      environment: rendered.environment,
    });
    this.repo.transaction(() => this.store.insert(record, rendered.bytes));
    return record;
  }
  list(operationId: string, offset = 0): BriefingSummary[] {
    const op = this.repo.getOperation(operationId),
      config = this.repo.getConfig(op),
      publications = this.repo.listPublications(operationId);
    const currentHtml = new Map<string, string | null>();
    const snapshots = new Map<number, Operation>();
    return this.store.list(operationId, offset).map((record) => {
      const { html, ...summary } = record;
      let status: BriefingSummary["status"] = "Source unavailable";
      try {
        if (!currentHtml.has(record.deckId))
          currentHtml.set(
            record.deckId,
            renderBriefing(
              resolvedBriefing(this.repo, op, config, record.deckId),
            ),
          );
        status =
          currentHtml.get(record.deckId) === null
            ? "Source unavailable"
            : currentHtml.get(record.deckId) === html
              ? "Current"
              : "Outdated";
      } catch {
        currentHtml.set(record.deckId, null);
        /* Keep the saved PDF available when its live sources are removed. */
      }
      if (!snapshots.has(record.sourceRevision))
        snapshots.set(
          record.sourceRevision,
          this.repo.getOperation(operationId, record.sourceRevision),
        );
      const frozen = snapshots.get(record.sourceRevision)!;
      const cardIds =
        frozen.briefings?.decks
          .find((d) => d.id === record.deckId)
          ?.slides.filter((s) => s.layout === "cards")
          .flatMap((s) => s.cardIds) ?? [];
      const sources = (frozen.planningCards?.definitions ?? [])
        .filter((c) => cardIds.includes(c.id))
        .map((c) => (c.mode === "linked" ? c.source : c.origin.target));
      return {
        ...summary,
        cardIds,
        sources,
        sourceTargets: cardSourceTargets(
          frozen,
          cardIds,
          this.repo.cardOrigins?.(frozen),
        ),
        status,
        superseded:
          !!record.sourcePublicationId &&
          publications.some(
            (p) => p.supersedesId === record.sourcePublicationId,
          ),
      };
    });
  }
}
