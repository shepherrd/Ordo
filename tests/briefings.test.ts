import { expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { starterConfig } from "../src/config/profiles";
import { createOperation } from "../src/domain/factories";
import { operationSchema } from "../src/domain/model";
import { newBriefingSlide, type BriefingSlide } from "../src/domain/briefings";
import { projectBriefing, renderBriefing } from "../src/export/briefing-v1";
import {
  BriefingService,
  verifyBriefing,
} from "../src/application/briefing-service";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import { canonical } from "../src/export/projection";
import { handleRemovedCardSources } from "../src/domain/planning-card-actions";
import { independentCard } from "../src/domain/planning-card-resolution";
import { planningReferences } from "../src/domain/planning-usage";
import { operationSearchDocuments } from "../src/domain/search-documents";
import { DocumentLayoutReviewService } from "../src/application/document-layout-review";
import { renderReviewReport } from "../src/export/narrative-review-report";
import { briefingChanges } from "../src/application/briefing-review";
import { briefingGraphics } from "../src/application/briefing-service";
const now = "2026-10-16T12:00:00.000Z",
  rt = { id, now: () => now, actor: "Fictional drafter" };
function fixture() {
  const op = createOperation("Fictional briefing", starterConfig, id, now);
  op.sections[0].summary = "Original situation";
  const card = {
    id: id(),
    title: "Situation",
    mode: "linked" as const,
    source: { kind: "paragraph" as const, paragraphId: op.sections[0].id },
    fields: ["text" as const],
  };
  op.planningCards = { schemaVersion: 1, definitions: [card] };
  const slide: BriefingSlide = {
    ...newBriefingSlide(id(), "cards"),
    title: "Situation",
    cardIds: [card.id],
    notes: "Private presenter cue",
  };
  const deck = {
    id: id(),
    name: "Fictional operations update",
    footer: "Training use",
    slides: [slide],
  };
  op.briefings = { schemaVersion: 1, decks: [deck] };
  return { op, card, slide, deck };
}
it("keeps old operation shapes unchanged and rejects unsupported or unbounded briefing data", () => {
  const old = createOperation("Legacy", starterConfig, id, now);
  expect(canonical(operationSchema.parse(old))).toBe(canonical(old));
  const { op, deck } = fixture();
  expect(operationSchema.parse(op).briefings).toEqual(op.briefings);
  deck.slides.push({ ...deck.slides[0] });
  expect(operationSchema.safeParse(op).success).toBe(false);
  deck.slides = Array.from({ length: 41 }, () => ({
    ...newBriefingSlide(id(), "title"),
    title: "Test",
  }));
  expect(operationSchema.safeParse(op).success).toBe(false);
});
it("resolves linked and independent content without conflating slide layout and source facts", () => {
  const { op, card, deck, slide } = fixture();
  const frozen = projectBriefing(op, starterConfig, deck);
  const copy = independentCard(op, starterConfig, card, id(), {
    target: card.source,
    contentHash: "a".repeat(64),
    state: { kind: "saved", revision: 1 },
  });
  op.planningCards!.definitions.push(copy);
  slide.cardIds.push(copy.id);
  op.sections[0].summary = "Changed situation";
  const view = projectBriefing(op, starterConfig, deck);
  expect(view.slides[0].cards.map((c) => c.values[0].value)).toEqual([
    "Changed situation",
    "Original situation",
  ]);
  expect(frozen.slides[0].cards[0].values[0].value).toBe("Original situation");
  const html = renderBriefing(view);
  expect(html).not.toContain(slide.notes);
  expect(html).toContain("Training use");
  slide.layout = "text";
  slide.body = "<script>injection</script>";
  expect(renderBriefing(projectBriefing(op, starterConfig, deck))).toContain(
    "&lt;script&gt;",
  );
  expect(op.sections[0].summary).toBe("Changed situation");
});
it("reports missing sources and removes briefing placements in the existing source-deletion workflow", () => {
  const { op, card, deck } = fixture(),
    after = structuredClone(op);
  after.sections = [];
  expect(
    projectBriefing(after, starterConfig, deck).slides[0].issues[0],
  ).toMatch(/unavailable|missing/i);
  const removed = handleRemovedCardSources(
    op,
    after,
    starterConfig,
    "remove",
    new Map(),
  );
  expect(removed.briefings!.decks[0].slides[0].cardIds).toEqual([]);
  const copied = handleRemovedCardSources(
    op,
    after,
    starterConfig,
    "copy",
    new Map([
      [
        card.id,
        {
          target: card.source,
          contentHash: "b".repeat(64),
          state: { kind: "saved", revision: 1 },
        },
      ],
    ]),
  );
  expect(
    projectBriefing(copied, starterConfig, copied.briefings!.decks[0]).slides[0]
      .issues,
  ).toEqual([]);
});
it("preserves saved decks without exposing slide notes or usage links in 1.0 search", () => {
  const { op, slide } = fixture();
  expect(
    operationSearchDocuments(op, starterConfig).some(
      (d) =>
        (d.target.area === "operation" &&
          d.target.target.kind === "briefing") ||
        d.text.includes(slide.notes),
    ),
  ).toBe(false);
  expect(
    planningReferences(op).some(
      (r) => r.from.area === "operation" && r.from.target.kind === "briefing",
    ),
  ).toBe(false);
  expect(op.briefings?.decks[0].slides[0].notes).toBe(slide.notes);
});
it("does not resolve hidden content from other slide layouts", () => {
  const { op, deck, slide } = fixture();
  slide.layout = "text";
  slide.body = "Visible";
  slide.cardIds = [id()];
  slide.graphic = { kind: "export", exportId: id() };
  const view = projectBriefing(op, starterConfig, deck);
  expect(view.slides[0].issues).toEqual([]);
  expect(view.slides[0].cards).toEqual([]);
  expect(view.slides[0].graphic).toBeNull();
});
it("retains exact saved and published source PDFs, detects relevant changes and verifies backups and review history", async () => {
  const folder = mkdtempSync(resolve(".test-data/briefing-test-")),
    repo = new SqliteRepository(join(folder, "workspace.db"));
  try {
    repo.seedConfig(starterConfig);
    const app = new OrdoService(repo, rt, (_n, c) => demoOperation(c, id, now));
    let op = app.execute({
      type: "create",
      name: "Fictional briefing integration",
      demo: false,
    }).operation!;
    const parts = fixture();
    op.sections[0].summary = "Original situation";
    parts.card.source.paragraphId = op.sections[0].id;
    op.planningCards = parts.op.planningCards;
    op.briefings = parts.op.briefings;
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    const revision = op.revision,
      deckId = parts.deck.id;
    const bytes = new TextEncoder().encode("%PDF-fictional-unit-fixture"),
      renderer = {
        async renderBriefing() {
          return {
            bytes,
            environment: {
              appVersion: "test",
              electron: "test",
              chromium: "test",
              fontFingerprint: "c".repeat(64),
            },
          };
        },
      };
    const service = new BriefingService(repo, repo.briefings, rt, renderer);
    const record = await service.generate({
      type: "generate",
      operationId: op.id,
      deckId,
      expectedRevision: op.revision,
      source: { kind: "revision", revision },
    });
    expect(record.html).toContain("Original situation");
    expect(record.html).not.toContain("Private presenter cue");
    expect(service.list(op.id)[0].status).toBe("Current");
    op.briefings!.decks[0].slides[0].notes = "Notes changed only";
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(service.list(op.id)[0].status).toBe("Current");
    op.metadata.statusId = starterConfig.doctrine.publicationRequiredStatus;
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    app.execute({
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "Fictional fixture approval",
    });
    const pub = app.execute({
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    }).publications[0];
    op = repo.getOperation(op.id);
    op.sections[0].summary = "Changed situation";
    op.briefings!.decks[0].slides[0].title = "Updated briefing slide";
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(service.list(op.id)[0].status).toBe("Outdated");
    expect(repo.briefings.get(record.id).bytes).toEqual(Buffer.from(bytes));
    const frozen = await service.generate({
      type: "generate",
      operationId: op.id,
      deckId,
      expectedRevision: op.revision,
      source: { kind: "publication", publicationId: pub.id },
    });
    expect(frozen.html).toContain("Original situation");
    expect(frozen.html).not.toContain("Changed situation");
    expect(() =>
      verifyBriefing(repo, { ...record, html: record.html + "bad" }, bytes),
    ).toThrow(/provenance/);
    expect(() =>
      verifyBriefing(repo, record, new TextEncoder().encode("%PDF-bad")),
    ).toThrow(/provenance/);
    await expect(
      service.generate({
        type: "generate",
        operationId: op.id,
        deckId,
        expectedRevision: 1,
        source: { kind: "revision", revision },
      }),
    ).rejects.toThrow(/changed/);
    const history = repo.revisionHistory(op.id).map((r) => r.endpoint),
      a = history.find((r) => r.revisionNumber === revision)!,
      b = history.find((r) => r.revisionNumber === op.revision)!;
    const review = new DocumentLayoutReviewService(repo, rt, true).execute({
      type: "create-review",
      engineVersion: "diff-engine-v3",
      baseline: {
        kind: "REVISION",
        operationId: op.id,
        revisionId: a.revisionId,
      },
      target: {
        kind: "REVISION",
        operationId: op.id,
        revisionId: b.revisionId,
      },
      title: "Briefing review",
      description: "",
      expectedRevision: op.revision,
      parentReviewId: null,
      supersedesReviewId: null,
    }).review!;
    expect(review.reportRendererVersion).toBe("review-html-v8");
    expect(renderReviewReport(review)).toContain("Updated briefing slide");
    repo.verifyAll();
    await repo.backup(join(folder, "backup.db"));
    const backup = new SqliteRepository(join(folder, "backup.db"));
    try {
      backup.verifyAll();
      expect(backup.briefings.get(record.id).record.html).toBe(record.html);
      expect(backup.getOperation(op.id).briefings).toEqual(op.briefings);
    } finally {
      backup.close();
    }
    const preview = repo.prepareDeletion({ kind: "operation", id: op.id });
    expect(preview.blockers).toEqual([]);
    expect(
      preview.counts.some(
        (c) => c.label === "Retained briefing PDFs" && c.count === 2,
      ),
    ).toBe(true);
    repo.permanentlyDelete(
      { kind: "operation", id: op.id },
      preview.fingerprint,
    );
    expect(repo.briefings.list(op.id)).toEqual([]);
  } finally {
    repo.close();
  }
});
it("rejects missing-card output and images owned by another operation", () => {
  const { op, deck, slide } = fixture();
  slide.cardIds = [id()];
  expect(
    projectBriefing(op, starterConfig, deck).slides[0].issues,
  ).toHaveLength(1);
  const assetId = id();
  slide.graphic = {
    kind: "image",
    asset: {
      assetId,
      operationId: id(),
      doctrineVersionId: null,
      originalFilename: "image.png",
      mimeType: "image/png",
      sizeBytes: 10,
      sha256: "d".repeat(64),
      createdAt: now,
      storageReference: "asset:" + assetId,
    },
  };
  expect(operationSchema.safeParse(op).success).toBe(false);
});
it("records reordering even when slide titles match and source choices share labels", () => {
  const { op, deck, slide, card } = fixture();
  deck.slides.push({ ...structuredClone(slide), id: id() });
  const after = structuredClone(op);
  after.briefings!.decks[0].slides.reverse();
  expect(
    briefingChanges(op, after).changes.some((c) => c.field === "Slide order"),
  ).toBe(true);
  const copy = { ...card, id: id() };
  after.planningCards!.definitions.push(copy);
  after.briefings!.decks[0].slides[0].cardIds = [copy.id];
  expect(
    briefingChanges(op, after).changes.some(
      (c) => c.field === "Planning content",
    ),
  ).toBe(true);
});
it("pins imported image bytes through saved briefings and prevents deleting an image used by history", () => {
  const folder = mkdtempSync(resolve(".test-data/briefing-image-")),
    repo = new SqliteRepository(join(folder, "workspace.db"));
  try {
    repo.seedConfig(starterConfig);
    const app = new OrdoService(repo, rt, (_n, c) => demoOperation(c, id, now));
    let op = app.execute({
      type: "create",
      name: "Fictional image briefing",
      demo: false,
    }).operation!;
    const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
      assetId = id();
    const asset = {
      assetId,
      operationId: op.id,
      doctrineVersionId: null,
      originalFilename: "fixture.png",
      mimeType: "image/png" as const,
      sizeBytes: bytes.length,
      sha256: repo.hashBinary(bytes),
      createdAt: now,
      storageReference: "asset:" + assetId,
    };
    repo.modular.insertAsset(asset, bytes);
    const slide = {
      ...newBriefingSlide(id(), "graphic"),
      title: "Managed image",
      graphic: { kind: "image" as const, asset },
    };
    op.briefings = {
      schemaVersion: 1,
      decks: [{ id: id(), name: "Image deck", footer: "", slides: [slide] }],
    };
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(briefingGraphics(repo, op, [slide]).get(slide.id)?.data).toContain(
      bytes.toString("base64"),
    );
    expect(
      repo.prepareDeletion({ kind: "asset", id: assetId }).blockers.length,
    ).toBeGreaterThan(0);
    op.briefings!.decks = [];
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(
      repo.prepareDeletion({ kind: "asset", id: assetId }).blockers.length,
    ).toBeGreaterThan(0);
    repo.verifyAll();
  } finally {
    repo.close();
  }
});
