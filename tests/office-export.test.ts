import { expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { fromBuffer } from "yauzl";
import { createOfficeDocx } from "../src/main/office-docx";
import { createOfficePptx } from "../src/main/office-pptx";
import {
  OfficeService,
  officePayload,
  verifyOffice,
} from "../src/application/office-service";
import type { OfficeSlideLayout } from "../src/application/office-layout";
import type { ExportRecord } from "../src/domain/model";
import { starterConfig } from "../src/config/profiles";
import { newBriefingSlide } from "../src/domain/briefings";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
const now = "2026-10-19T12:00:00.000Z",
  rt = { id, now: () => now, actor: "Fictional drafter" };
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const rasterize = async () => ({ data: png, width: 80, height: 40 });
async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  return new Promise((resolve, reject) =>
    fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const files = new Map<string, string>();
      zip.on("error", reject);
      zip.on("end", () => resolve(files));
      zip.on("entry", (e) =>
        zip.openReadStream(e, (err, stream) => {
          if (err || !stream) return reject(err);
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("error", reject);
          stream.on("end", () => {
            files.set(e.fileName, Buffer.concat(chunks).toString("utf8"));
            zip.readEntry();
          });
        }),
      );
      zip.readEntry();
    }),
  );
}
const layouts = (text = "Editable text"): OfficeSlideLayout[] => [
  {
    texts: [
      {
        text,
        x: 64,
        y: 60,
        w: 1000,
        h: 50,
        size: 42,
        lineHeight: 48,
        bold: true,
        color: "182e28",
        align: "left",
      },
    ],
    cards: [{ x: 64, y: 160, w: 500, h: 300 }],
    images: [
      { data: png, alt: "Fictional graphic", x: 700, y: 180, w: 200, h: 100 },
    ],
    footerY: 650,
  },
];
it("writes native Word text, tables, lists, rich formatting, hyperlinks, configured header/footer and page fields", async () => {
  const source = {
    schemaVersion: 7,
    id: id(),
    sourceRevision: 3,
    documentLayout: {
      footer: {
        left: "Left",
        centre: "Centre",
        right: "Right",
        pageNumbers: true,
      },
    },
    html: `<html><head><title>Fictional order</title></head><body><header class="document-header"><h1>OPERATION ORDER</h1><img src="${png}" alt="Logo"><div class="document-identity-lines"><p><strong>Fictional HQ</strong></p><p>19 October</p></div><p class="document-classification">Unclassified</p></header><section><h2>Situation</h2><p><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <a href="https://example.invalid/">Reference</a></p><ul><li>First<ul><li>Nested</li></ul></li><li>Second</li></ul><table><thead><tr><th>Unit</th><th>Task</th></tr></thead><tbody><tr><td>Alpha</td><td>Support</td></tr></tbody></table><svg width="80" height="40"><rect width="80" height="40"/></svg></section><footer>Mechanical provenance must stay outside document</footer></body></html>`,
  } as unknown as ExportRecord;
  const zip = await unzip(
      await createOfficeDocx(
        source,
        { paper: "Letter", orientation: "portrait" },
        now,
        rasterize,
      ),
    ),
    xml = zip.get("word/document.xml")!;
  expect(xml).toContain("Fictional HQ");
  expect(xml).toContain("Unclassified");
  expect(xml).toContain("<w:tbl>");
  expect(xml).toContain("<w:b/>");
  expect(xml).toContain("<w:i/>");
  expect(xml).toContain('<w:u w:val="single"/>');
  expect(xml).toContain('<w:ilvl w:val="0"/>');
  expect(xml).toContain('<w:ilvl w:val="1"/>');
  expect(xml).toContain("<w:drawing>");
  expect(xml).not.toContain("Mechanical provenance");
  expect(zip.get("word/_rels/document.xml.rels")).toContain(
    "https://example.invalid/",
  );
  const footer = zip.get("word/footer1.xml")!;
  expect(footer).toContain("Centre");
  expect(footer).toContain("NUMPAGES");
  expect(footer).toContain("PAGE");
  expect([...zip.keys()].some((k) => k.startsWith("word/media/"))).toBe(true);
});
it("writes editable PowerPoint shapes, text, embedded images, notes and wide slide dimensions", async () => {
  const zip = await unzip(
    await createOfficePptx(
      "Fictional briefing",
      layouts(),
      ["Private presenter cue"],
      now,
      rasterize,
    ),
  );
  const slide = zip.get("ppt/slides/slide1.xml")!;
  expect(slide).toContain("Editable text");
  expect(slide).toContain("<p:sp>");
  expect(slide).toContain("<p:pic>");
  expect(slide).not.toContain("Private presenter cue");
  expect(zip.get("ppt/notesSlides/notesSlide1.xml")).toContain(
    "Private presenter cue",
  );
  expect(zip.get("ppt/presentation.xml")).toContain(
    'cx="12192000" cy="6858000"',
  );
});
it("retains exact revisions and publications, verifies bytes and backups, and includes Office files in permanent operation deletion", async () => {
  const folder = mkdtempSync(resolve(".test-data/office-test-")),
    repo = new SqliteRepository(join(folder, "workspace.db"));
  try {
    repo.seedConfig(starterConfig);
    const app = new OrdoService(repo, rt, (_n, c) => demoOperation(c, id, now));
    let op = app.execute({
      type: "create",
      name: "Fictional Office",
      demo: false,
    }).operation!;
    const slide = {
        ...newBriefingSlide(id(), "text"),
        title: "Original title",
        body: "Original body",
        notes: "Original note",
      },
      deck = {
        id: id(),
        name: "Fictional deck",
        footer: "Training",
        slides: [slide],
      };
    op.briefings = { schemaVersion: 1, decks: [deck] };
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    const source = {
      kind: "briefing" as const,
      deckId: deck.id,
      revision: op.revision,
      publicationId: null,
    };
    const service = new OfficeService(repo, repo.office, rt, {
      appVersion: "test",
      render: async (payload) => {
        if (payload.kind !== "briefing") throw Error("Expected briefing");
        return createOfficePptx(
          payload.view.name,
          layouts(payload.view.slides[0].body),
          payload.notes,
          now,
          rasterize,
        );
      },
    });
    const record = await service.generate({
        type: "generate",
        operationId: op.id,
        expectedRevision: op.revision,
        source,
      }),
      saved = repo.office.get(record.id);
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
      note: "Fixture",
    });
    const publication = app.execute({
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    }).publications[0];
    op = repo.getOperation(op.id);
    op.briefings!.decks[0].slides[0].body = "Changed body";
    op.briefings!.decks[0].slides[0].notes = "Changed note";
    op = app.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(repo.office.get(record.id).bytes).toEqual(saved.bytes);
    const frozen = officePayload(repo, op.id, {
      ...source,
      revision: publication.snapshot.revision,
      publicationId: publication.id,
    }).payload;
    expect(frozen.kind === "briefing" && frozen.notes[0]).toBe("Original note");
    await service.generate({
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      source: {
        ...source,
        revision: publication.snapshot.revision,
        publicationId: publication.id,
      },
    });
    expect(() =>
      verifyOffice(
        repo,
        { ...record, sourceHash: "f".repeat(64) },
        saved.bytes,
      ),
    ).toThrow(/provenance/);
    expect(() =>
      verifyOffice(repo, record, new Uint8Array([0x50, 0x4b, 0])),
    ).toThrow(/provenance/);
    expect(() =>
      repo.sqlite
        .prepare("UPDATE office_exports SET bytes=? WHERE id=?")
        .run(Buffer.from("bad"), record.id),
    ).toThrow(/immutable/);
    expect(() =>
      repo.sqlite
        .prepare("DELETE FROM office_exports WHERE id=?")
        .run(record.id),
    ).toThrow(/immutable/);
    await expect(
      service.generate({
        type: "generate",
        operationId: op.id,
        expectedRevision: 1,
        source,
      }),
    ).rejects.toThrow(/changed/);
    const other = app.execute({
      type: "create",
      name: "Other",
      demo: false,
    }).operation!;
    expect(() => officePayload(repo, other.id, source)).toThrow();
    repo.verifyAll();
    await repo.backup(join(folder, "backup.db"));
    const backup = new SqliteRepository(join(folder, "backup.db"));
    try {
      backup.verifyAll();
      expect(backup.office.get(record.id).bytes).toEqual(saved.bytes);
    } finally {
      backup.close();
    }
    const deletion = repo.prepareDeletion({ kind: "operation", id: op.id });
    expect(deletion.blockers).toEqual([]);
    expect(
      deletion.counts.some(
        (c) => c.label === "Retained Office exports" && c.count === 2,
      ),
    ).toBe(true);
    repo.permanentlyDelete(
      { kind: "operation", id: op.id },
      deletion.fingerprint,
    );
    expect(repo.office.list(op.id)).toEqual([]);
  } finally {
    repo.close();
  }
});
