import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepository } from "../src/persistence/repository";
import { restoreWorkspace } from "../src/persistence/restore";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { OrdoService } from "../src/application/service";
import { DocumentLayoutReviewService } from "../src/application/document-layout-review";
import { ConfiguredDocumentService } from "../src/application/configured-document-service";
import { newDocumentLayout } from "../src/domain/document-layout";
import { operationSchema, type Operation } from "../src/domain/model";
import { canonical } from "../src/export/projection";
import { printDocumentHtml } from "../src/export/print-v2";
import { printHtmlV1 } from "../src/export/print-v1";
import { renderReviewReport } from "../src/export/narrative-review-report";
import { documentStaleness } from "../src/application/verify-document-layout";

const rt = {
  id,
  now: () => "2026-10-09T18:00:00.000Z",
  actor: "Fictional planner",
};
let repo: SqliteRepository, service: OrdoService, op: Operation;
const makeService = () =>
  new OrdoService(repo, rt, (_n, c) => demoOperation(c, id, rt.now()));
const save = () => {
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
};
const generate = (publicationId: string | null = null) => {
  const previous = new Set(repo.listExports(op.id).map((e) => e.id));
  const p = repo.listExportProfiles(op.id).find((p) => p.product === "opord")!;
  service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: p.id, version: p.version },
    publicationId,
  });
  return repo.listExports(op.id).find((e) => !previous.has(e.id))!;
};
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  service = makeService();
  op = service.execute({
    type: "create",
    name: "Fictional header test",
    demo: true,
  }).operation!;
});
afterEach(() => repo.close());
function configure() {
  op.metadata.documentLayout = newDocumentLayout();
  Object.assign(op.metadata.documentLayout.header, {
    unit: "38th Mobile Infantry Division",
    organization: "Fictional Directorate",
    location: "Arcadia, GCR",
    dateTime: "24 MAY 2036, 1200 GMT",
    classification: "Unclassified",
  });
  Object.assign(op.metadata.documentLayout.footer, {
    left: "Exercise",
    centre: "Operation Testify",
    right: "Planning copy",
    pageNumbers: true,
  });
  save();
}
it("retains configured header/footer and safely escapes drafter text in HTML and print", () => {
  configure();
  op.metadata.documentLayout!.header.unit = '<img src=x onerror="bad"> & unit';
  op.metadata.documentLayout!.footer.right = '"</style><script>bad</script>\\';
  save();
  const e = generate();
  expect(e.schemaVersion).toBe(6);
  expect(e.html).toContain('class="document-header"');
  expect(e.html).toContain(
    "&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; unit",
  );
  expect(e.html).not.toContain("ORDO / DERIVED PRODUCT");
  expect(e.html).not.toContain("renderer html-v6");
  const html = printDocumentHtml(e, { paper: "A4", orientation: "portrait" });
  expect(html).not.toContain('class="ordo-print-provenance"');
  expect(html).toContain("counter(page)");
  expect(html).toContain("ordo-print-v2");
  expect(html).not.toContain("</style><script>");
  repo.verifyAll();
});
it("preserves historical HTML and print output when operation settings change", () => {
  const historical = generate(),
    bytes = canonical(historical),
    printed = printHtmlV1(historical, {
      paper: "Letter",
      orientation: "landscape",
    });
  configure();
  const fresh = generate();
  expect(fresh.id).not.toBe(historical.id);
  expect(
    canonical(repo.listExports(op.id).find((e) => e.id === historical.id)),
  ).toBe(bytes);
  expect(
    printDocumentHtml(historical, {
      paper: "Letter",
      orientation: "landscape",
    }),
  ).toBe(printed);
  expect(
    documentStaleness(historical, op).changedPaths.some((p) =>
      p.startsWith("document/"),
    ),
  ).toBe(false);
});
it("tracks exact document fields without treating an unrelated edit as a header change", () => {
  configure();
  const e = generate();
  expect(documentStaleness(e, op).outdated).toBe(false);
  op.metadata.documentLayout!.footer.left = "Changed";
  save();
  expect(documentStaleness(e, op).changedPaths).toEqual([
    "document/footer/left",
  ]);
  op.metadata.documentLayout!.footer.left = "Exercise";
  op.signal.maintenanceNotes = "internal note";
  save();
  expect(
    documentStaleness(e, op).changedPaths.filter((p) =>
      p.startsWith("document/"),
    ),
  ).toEqual([]);
  const forged = structuredClone(e);
  if (forged.schemaVersion !== 6) throw Error();
  forged.id = id();
  forged.documentLayout.header.title = "Forged";
  expect(() => repo.insertExport(forged)).toThrow(/source revision/);
});
it("owns and verifies the logo and keeps it through backup/restore", async () => {
  configure();
  const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRz8AAAAASUVORK5CYII=",
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
    createdAt: rt.now(),
    storageReference: `asset:${assetId}`,
  };
  repo.modular.insertAsset(asset, bytes);
  op.metadata.documentLayout!.header.logo = asset;
  save();
  const e = generate();
  expect(e.html).toContain(`data:image/png;base64,${bytes.toString("base64")}`);
  const wrong = structuredClone(op);
  wrong.metadata.documentLayout!.header.logo!.operationId = id();
  expect(operationSchema.safeParse(wrong).success).toBe(false);
  const modified = structuredClone(op);
  modified.metadata.documentLayout!.header.logo!.sha256 = "0".repeat(64);
  expect(() =>
    service.execute({
      type: "save",
      operation: modified,
      expectedRevision: op.revision,
    }),
  ).toThrow();
  const folder = mkdtempSync(".test-data/document-layout-"),
    live = join(folder, "live.db"),
    backup = join(folder, "backup.db");
  await repo.backup(live);
  await repo.backup(backup);
  repo.close();
  repo = new SqliteRepository(live);
  await restoreWorkspace(repo, live, backup, (r) => {
    repo = r;
  });
  repo.verifyAll();
  expect(repo.listExports(op.id)[0]).toEqual(e);
  expect(repo.assetData(assetId)).toContain(bytes.toString("base64"));
});
it("publication exports retain the original header and footer", () => {
  configure();
  op.units.forEach((u) => {
    u.inTaskOrganization = true;
  });
  op.metadata.statusId = "approved";
  save();
  expect(
    service.load(op.id).findings.filter((f) => f.severity === "error"),
  ).toEqual([]);
  service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "Fictional fixture",
  });
  op = repo.getOperation(op.id);
  service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  });
  op = repo.getOperation(op.id);
  const pub = repo.listPublications(op.id)[0];
  op.metadata.documentLayout!.header.unit = "Later unit";
  save();
  const e = generate(pub.id);
  expect(e.schemaVersion).toBe(6);
  if (e.schemaVersion === 6)
    expect(e.documentLayout.header.unit).toBe("38th Mobile Infantry Division");
  expect(documentStaleness(e, op).changedPaths).toContain(
    "document/header/unit",
  );
  repo.verifyAll();
});
it("retains supplemental document impact review without changing historical comparison semantics", () => {
  configure();
  const e = generate(),
    a = repo.revisionHistory(op.id)[0].endpoint;
  op.metadata.documentLayout!.footer.left = "Updated exercise";
  save();
  const b = repo.revisionHistory(op.id)[0].endpoint;
  const reviews = new DocumentLayoutReviewService(repo, rt),
    pair = {
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
      engineVersion: "diff-engine-v3",
    };
  const result = reviews.execute({
    type: "create-review",
    ...pair,
    title: "Document change",
    description: "",
    expectedRevision: op.revision,
    parentReviewId: null,
    supersedesReviewId: null,
  });
  const r = result.review!;
  expect(r.reportRendererVersion).toBe("review-html-v5");
  expect(r.comparison.documentPresentation!.exports[0]).toMatchObject({
    exportId: e.id,
    baselineChangedPaths: [],
    targetChangedPaths: ["document/footer/left"],
  });
  expect(renderReviewReport(r)).toContain("Document header and footer");
  repo.verifyAll();
});
it("retains a v2 PDF against the exact configured export", async () => {
  configure();
  const e = generate();
  let printed = "";
  const service = new ConfiguredDocumentService(repo, rt, {
    render: async (html) => {
      printed = html;
      return {
        bytes: Buffer.from("%PDF-fictional fixture"),
        environment: {
          appVersion: "0.6.5",
          electron: "fixture",
          chromium: "fixture",
          fontFingerprint: "1".repeat(64),
        },
      };
    },
  });
  const pdf = await service.generate({
    type: "generate",
    operationId: op.id,
    exportId: e.id,
    options: { paper: "A4", orientation: "portrait" },
  });
  expect(pdf.printVersion).toBe("ordo-print-v2");
  expect(pdf.printHtmlHash).toBe(repo.hash(printed));
  expect(repo.getDocument(pdf.id).record).toEqual(pdf);
  repo.verifyAll();
});
