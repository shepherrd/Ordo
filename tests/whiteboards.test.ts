import { expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { starterConfig } from "../src/config/profiles";
import { createOperation } from "../src/domain/factories";
import { operationSchema } from "../src/domain/model";
import {
  newWhiteboard,
  whiteboardSchema,
  duplicateWhiteboard,
  removeBoardItems,
  fitBoardItem,
} from "../src/domain/whiteboards";
import {
  projectWhiteboard,
  renderWhiteboard,
} from "../src/export/whiteboard-v1";
import {
  WhiteboardService,
  verifyWhiteboard,
  binaryData,
} from "../src/application/whiteboard-service";
import { assertWhiteboardSvg } from "../src/validation/whiteboard-svg";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import { canonical } from "../src/export/projection";
import { handleRemovedCardSources } from "../src/domain/planning-card-actions";
import { independentCard } from "../src/domain/planning-card-resolution";
import { planningReferences } from "../src/domain/planning-usage";
import { operationSearchDocuments } from "../src/domain/search-documents";
import { whiteboardChanges } from "../src/application/whiteboard-review";
import { DocumentLayoutReviewService } from "../src/application/document-layout-review";
import { renderReviewReport } from "../src/export/narrative-review-report";
import { insertWhiteboardImage } from "../src/domain/whiteboard-embedding";
import { newBriefingSlide } from "../src/domain/briefings";
const now = "2026-10-19T12:00:00.000Z",
  rt = { id, now: () => now, actor: "Fictional drafter" };
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
const frame = () => ({
  id: id(),
  x: 40,
  y: 40,
  width: 400,
  height: 300,
  locked: false,
});
function fixture() {
  const op = createOperation("Fictional whiteboard", starterConfig, id, now),
    board = newWhiteboard(id());
  op.sections[0].summary = "Original situation";
  const card = {
    id: id(),
    title: "Situation",
    mode: "linked" as const,
    source: { kind: "paragraph" as const, paragraphId: op.sections[0].id },
    fields: ["text" as const],
  };
  op.planningCards = { schemaVersion: 1, definitions: [card] };
  board.items = [
    { ...frame(), kind: "card", cardId: card.id },
    {
      ...frame(),
      kind: "note",
      x: 600,
      text: "Decision point",
      fontSize: 18,
      fill: "#fff1a8",
      ink: "#172c30",
    },
  ];
  board.connectors = [
    {
      id: id(),
      fromId: board.items[0].id,
      toId: board.items[1].id,
      label: "Consider",
      color: "#496773",
      style: "dashed",
      arrow: "end",
    },
  ];
  op.whiteboards = { schemaVersion: 1, boards: [board] };
  return { op, board, card };
}
it("preserves old operation shapes and rejects duplicate identities, invalid geometry and broken connectors", () => {
  const old = createOperation("Legacy", starterConfig, id, now);
  expect(canonical(operationSchema.parse(old))).toBe(canonical(old));
  const { op, board } = fixture();
  expect(operationSchema.parse(op).whiteboards).toEqual(op.whiteboards);
  board.items.push({ ...board.items[0] });
  expect(whiteboardSchema.safeParse(board).success).toBe(false);
  board.items.pop();
  board.connectors[0].toId = id();
  expect(whiteboardSchema.safeParse(board).success).toBe(false);
  board.connectors = [];
  board.items[0].x = 1600;
  expect(whiteboardSchema.safeParse(board).success).toBe(false);
  fitBoardItem(board, board.items[0]);
  expect(whiteboardSchema.safeParse(board).success).toBe(true);
  board.items = Array.from({ length: 301 }, () => ({
    ...board.items[0],
    id: id(),
  }));
  expect(whiteboardSchema.safeParse(board).success).toBe(false);
});
it("duplicates layout identities, keeps linked facts current and leaves planning relationships untouched", () => {
  const { op, board, card } = fixture(),
    facts = canonical(op.sections),
    copy = duplicateWhiteboard(board, id);
  expect(copy.items[0].id).not.toBe(board.items[0].id);
  expect(copy.connectors[0].fromId).toBe(copy.items[0].id);
  expect(copy.items[0]).toMatchObject({ kind: "card", cardId: card.id });
  board.items[0].x += 50;
  board.connectors[0].label = "Visual only";
  expect(canonical(op.sections)).toBe(facts);
  const independent = independentCard(op, starterConfig, card, id(), {
    target: card.source,
    contentHash: "a".repeat(64),
    state: { kind: "saved", revision: 1 },
  });
  op.planningCards!.definitions.push(independent);
  board.items.push({
    ...frame(),
    kind: "card",
    cardId: independent.id,
    y: 500,
  });
  op.sections[0].summary = "Updated situation";
  const view = projectWhiteboard(op, starterConfig, board);
  expect(view.items[0].paragraphs.at(-1)!.text).toBe("Updated situation");
  expect(view.items[2].paragraphs.at(-1)!.text).toBe("Original situation");
  removeBoardItems(board, [board.items[0].id]);
  expect(board.connectors).toHaveLength(0);
  expect(op.sections[0].summary).toBe("Updated situation");
});
it("indexes board items, opens the exact canvas item and records card references", () => {
  const { op, board, card } = fixture();
  const docs = operationSearchDocuments(op, starterConfig);
  const doc = docs.find((d) => d.text.includes("Decision point"))!;
  if (doc.target.area !== "operation") throw Error();
  expect(doc.target).toMatchObject({
    target: {
      kind: "whiteboard",
      boardId: board.id,
      itemId: board.items[1].id,
    },
  });
  expect(
    planningReferences(op).some(
      (r) =>
        r.from.area === "operation" &&
        r.from.target.kind === "whiteboard" &&
        r.to.area === "operation" &&
        r.to.target.kind === "card" &&
        r.to.target.cardId === card.id,
    ),
  ).toBe(true);
});
it("uses the existing source-deletion choice for board cards and their connectors", () => {
  const { op, card } = fixture(),
    after = structuredClone(op);
  after.sections = [];
  const removed = handleRemovedCardSources(
    op,
    after,
    starterConfig,
    "remove",
    new Map(),
  );
  expect(removed.whiteboards!.boards[0].items).toHaveLength(1);
  expect(removed.whiteboards!.boards[0].connectors).toHaveLength(0);
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
          contentHash: "a".repeat(64),
          state: { kind: "saved", revision: 1 },
        },
      ],
    ]),
  );
  expect(
    projectWhiteboard(copied, starterConfig, copied.whiteboards!.boards[0])
      .items[0].issue,
  ).toBeUndefined();
});
it("escapes canvas text, rejects unsafe embedded images and identifies cropped text before export", () => {
  const { op, board } = fixture();
  const note = board.items[1];
  if (note.kind !== "note") throw Error();
  note.text = '<script>bad</script> & "quoted"';
  let svg = renderWhiteboard(
    projectWhiteboard(op, starterConfig, board),
    new Map(),
  ).svg;
  expect(svg).toContain("&lt;script&gt;");
  assertWhiteboardSvg(svg);
  for (const bad of [
    '<image href="https://example.invalid/a.png"/>',
    '<image x="8" y="8" width="20" height="20" preserveAspectRatio="xMidYMid meet" href="' +
      binaryData(bytes, "image/png") +
      '" onload="bad()"/>',
    '<image x="8" y="8" width="20" height="20" preserveAspectRatio="xMidYMid meet" href="' +
      binaryData(
        new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>bad</script></svg>',
        ),
        "image/svg+xml",
      ) +
      '"/>',
  ])
    expect(() =>
      assertWhiteboardSvg(svg.replace("</svg>", bad + "</svg>")),
    ).toThrow();
  note.text = "Long text ".repeat(300);
  expect(
    renderWhiteboard(
      projectWhiteboard(op, starterConfig, board),
      new Map(),
    ).issues.join(" "),
  ).toContain("does not fit");
});
it("handles 300 layout items without changing facts and records reordering in reviews", () => {
  const { op, board } = fixture();
  board.connectors = [];
  board.items = Array.from({ length: 300 }, (_, n) => ({
    ...frame(),
    kind: "note" as const,
    x: (n % 10) * 150,
    y: Math.floor(n / 10) * 70,
    width: 140,
    height: 60,
    text: `Item ${n}`,
    fontSize: 14,
    fill: "#ffffff",
    ink: "#172c30",
  }));
  board.width = 1600;
  board.height = 2400;
  const view = projectWhiteboard(op, starterConfig, board);
  expect(renderWhiteboard(view, new Map()).issues).toEqual([]);
  const next = structuredClone(op);
  next.whiteboards!.boards[0].items.reverse();
  expect(
    whiteboardChanges(op, next).changes.some((c) => c.field === "Layer order"),
  ).toBe(true);
});
it("retains frozen snapshots and inserted images through edits, review, backup and permanent deletion", async () => {
  const folder = mkdtempSync(resolve(".test-data/whiteboard-test-")),
    repo = new SqliteRepository(join(folder, "workspace.db"));
  try {
    repo.seedConfig(starterConfig);
    const app = new OrdoService(repo, rt, (_n, c) => demoOperation(c, id, now));
    let op = app.execute({
      type: "create",
      name: "Fictional board integration",
      demo: false,
    }).operation!;
    const f = fixture();
    f.card.source.paragraphId = op.sections[0].id;
    op.sections[0].summary = "Original situation";
    op.planningCards = f.op.planningCards;
    op.whiteboards = f.op.whiteboards;
    op.briefings = {
      schemaVersion: 1,
      decks: [
        {
          id: id(),
          name: "Board briefing",
          footer: "",
          slides: [newBriefingSlide(id(), "title")],
        },
      ],
    };
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    const revision = op.revision,
      boardId = f.board.id;
    const service = new WhiteboardService(
      repo,
      repo.whiteboards,
      rt,
      {
        async render() {
          throw Error("No graphics in fixture");
        },
      },
      {
        async renderWhiteboard() {
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
      },
    );
    const command = {
      type: "generate",
      operationId: op.id,
      boardId,
      expectedRevision: op.revision,
      revision,
      publicationId: null,
    };
    const summary = await service.generate(command),
      record = repo.whiteboards.get(summary.id).record;
    expect(record.svg).toContain("Original situation");
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
      note: "Fictional publication",
    });
    const publication = app.execute({
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    }).publications[0];
    op = repo.getOperation(op.id);
    const first = service.image(record.id),
      second = service.image(record.id);
    expect(first.asset.assetId).not.toBe(second.asset.assetId);
    insertWhiteboardImage(
      op,
      first.asset,
      "Board · saved whiteboard snapshot · revision 2",
      { kind: "order", productId: op.orderId },
      id,
      now,
    );
    insertWhiteboardImage(
      op,
      second.asset,
      "Board · saved whiteboard snapshot · revision 2",
      { kind: "briefing", deckId: op.briefings!.decks[0].id },
      id,
      now,
    );
    expect(op.sections[0].summary).toBe("Original situation");
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(service.list(op.id)[0].status).toBe("Current");
    op.sections[0].summary = "Changed situation";
    op.whiteboards!.boards[0].items[1].x += 10;
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(service.list(op.id)[0].status).toBe("Outdated");
    const published = await service.generate({
      ...command,
      expectedRevision: op.revision,
      revision: publication.sourceRevision,
      publicationId: publication.id,
    });
    expect(repo.whiteboards.get(published.id).record.svg).toContain(
      "Original situation",
    );
    expect(repo.whiteboards.get(published.id).record.svg).not.toContain(
      "Changed situation",
    );
    expect(repo.whiteboards.get(record.id).record.svg).toBe(record.svg);
    expect(() =>
      verifyWhiteboard(repo, { ...record, svg: record.svg + "bad" }, bytes),
    ).toThrow();
    expect(() => verifyWhiteboard(repo, record, Buffer.from("bad"))).toThrow();
    await expect(service.generate(command)).rejects.toThrow(/changed/);
    const history = repo.revisionHistory(op.id).map((r) => r.endpoint),
      a = history.find((r) => r.revisionNumber === revision)!,
      b = history.find((r) => r.revisionNumber === op.revision)!;
    const review = new DocumentLayoutReviewService(repo, rt).execute({
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
      title: "Board review",
      description: "",
      expectedRevision: op.revision,
      parentReviewId: null,
      supersedesReviewId: null,
    }).review!;
    expect(review.reportRendererVersion).toBe("review-html-v9");
    expect(renderReviewReport(review)).toContain("Whiteboard");
    for (const sql of [
      "UPDATE whiteboard_snapshots SET bytes=X'00'",
      "DELETE FROM whiteboard_snapshots",
      "DELETE FROM whiteboard_snapshot_assets",
    ])
      expect(() => repo.sqlite.exec(sql)).toThrow();
    repo.verifyAll();
    await repo.backup(join(folder, "backup.db"));
    const backup = new SqliteRepository(join(folder, "backup.db"));
    try {
      backup.verifyAll();
      expect(backup.whiteboards.get(record.id).bytes).toEqual(bytes);
      expect(backup.getOperation(op.id).whiteboards).toEqual(op.whiteboards);
    } finally {
      backup.close();
    }
    op.whiteboards!.boards = [];
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(service.list(op.id)[0].status).toBe("Source unavailable");
    expect(repo.modular.readAsset(first.asset.assetId).bytes).toEqual(bytes);
    repo.verifyAll();
    const preview = repo.prepareDeletion({ kind: "operation", id: op.id });
    expect(preview.blockers).toEqual([]);
    repo.permanentlyDelete(
      { kind: "operation", id: op.id },
      preview.fingerprint,
    );
    expect(repo.whiteboards.list(op.id)).toEqual([]);
  } finally {
    repo.close();
  }
});
