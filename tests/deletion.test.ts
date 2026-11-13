import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { SqliteRepository } from "../src/persistence/repository";
import {
  DeletionService,
  type DeletionTarget,
} from "../src/application/deletion-service";
import { OrdoService } from "../src/application/service";
import { SymbologyService } from "../src/application/symbology-service";
import { WorkspaceService } from "../src/application/workspace-service";
import { WorkingDraftService } from "../src/application/working-drafts";
import { DocumentService } from "../src/application/document-service";
import { ReviewService } from "../src/application/review-service";
import { executeDoctrine } from "../src/application/doctrine-service";
import { endpointSelector } from "../src/persistence/review-store";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { canonical } from "../src/export/projection";
import { createExportProfile } from "../src/domain/factories";
import { unitProfileSchema } from "../src/domain/unit-profiles";
import { restoreWorkspace } from "../src/persistence/restore";
import { hashBytes } from "../src/persistence/modular-store";
import { confirmDeletion } from "../src/main/confirm-deletion";
import type { BrowserWindow } from "electron";
const { showMessageBox } = vi.hoisted(() => ({ showMessageBox: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showMessageBox } }));
let repo: SqliteRepository,
  deletion: DeletionService,
  service: OrdoService,
  lib: SymbologyService,
  ws: WorkspaceService;
const rt = {
  id: uid,
  now: () => "2026-10-07T12:00:00.000Z",
  actor: "Fictional deletion tester",
};
function services() {
  deletion = new DeletionService(repo);
  service = new OrdoService(repo, rt, (_n, c) =>
    demoOperation(c, uid, rt.now()),
  );
  lib = new SymbologyService(repo, rt);
  ws = new WorkspaceService(repo, rt);
}
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  services();
  showMessageBox.mockReset();
});
afterEach(() => {
  if (repo.sqlite.open) repo.close();
});
const operation = () =>
  service.execute({ type: "create", name: "Fictional deletion", demo: true })
    .operation!;
const remove = (target: DeletionTarget) => {
  const p = deletion.preview(target);
  expect(p.blockers).toEqual([]);
  return deletion.commit({
    target,
    fingerprint: p.fingerprint,
    confirmed: true,
  });
};
const rows = () =>
  Object.fromEntries(
    (
      repo.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    ).map(({ name }) => [
      name,
      repo.sqlite
        .prepare(`SELECT * FROM "${name}"`)
        .all()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]),
  );
const symbol = () =>
  lib.execute({ type: "new", kind: "SYMBOL", name: "Fictional symbol" })
    .symbol!;
it("requires explicit confirmation, defaults to Cancel and names the permanent loss", async () => {
  const op = operation(),
    target: DeletionTarget = { kind: "operation", id: op.id },
    before = rows();
  showMessageBox.mockResolvedValueOnce({ response: 0 });
  expect(
    (await confirmDeletion(deletion, {} as BrowserWindow, target)).reason,
  ).toBe("canceled");
  expect(rows()).toEqual(before);
  const dialog = showMessageBox.mock.calls[0][1];
  expect(dialog.defaultId).toBe(0);
  expect(dialog.cancelId).toBe(0);
  expect(dialog.buttons).toEqual(["Cancel", "Delete permanently"]);
  expect(dialog.message).toContain(op.name);
  expect(dialog.message).toContain("Are you sure");
  expect(dialog.detail).toContain("permanent and cannot be undone");
  expect(dialog.detail).toContain("published orders");
  expect(dialog.detail).toContain("Existing backups");
  expect(() =>
    deletion.commit({
      target,
      fingerprint: deletion.preview(target).fingerprint,
      confirmed: false,
    }),
  ).toThrow();
  showMessageBox.mockResolvedValueOnce({ response: 1 });
  expect(
    (await confirmDeletion(deletion, {} as BrowserWindow, target)).deleted,
  ).toBe(true);
  expect(repo.listOperations()).toHaveLength(0);
});
it("purges the complete published operation, PDFs, reviews and recovery, preserving unrelated rows", async () => {
  let op = operation();
  const other = operation();
  const recovery = new WorkingDraftService(repo, rt);
  op.units.forEach((u) => (u.inTaskOrganization = true));
  op.metadata.statusId = "approved";
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "Fictional review",
  });
  service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  });
  const reviews = new ReviewService(repo, rt),
    h = reviews.execute({ type: "history", operationId: op.id }).history;
  const review = reviews.execute({
    type: "create-review",
    baseline: endpointSelector(h.at(-1)!.endpoint),
    target: endpointSelector(h[0].endpoint),
    engineVersion: "diff-engine-v3",
    title: "Fictional review",
    description: "",
    expectedRevision: op.revision,
    parentReviewId: null,
    supersedesReviewId: null,
  }).review!;
  reviews.execute({
    type: "review-actions",
    id: review.id,
    expectedSequence: 0,
    actions: [
      {
        type: "COMMENT",
        changeId: null,
        text: "Preserved until operation deletion",
      },
    ],
    confirmedBulk: false,
  });
  const profile = repo.listExportProfiles(op.id)[0];
  service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId: null,
  });
  const exp = repo.listExports(op.id)[0];
  await new DocumentService(repo, rt, {
    render: async () => ({
      bytes: Buffer.from("%PDF-1.7\nfictional\n%%EOF"),
      environment: {
        appVersion: "0.6.5",
        electron: "fixture",
        chromium: "fixture",
        fontFingerprint: "a".repeat(64),
      },
    }),
  }).generate({
    type: "generate",
    operationId: op.id,
    exportId: exp.id,
    options: { paper: "A4", orientation: "portrait" },
  });
  for (const current of [op, other])
    recovery.execute({
      type: "put",
      key: { kind: "operation", id: current.id, scope: current.id },
      source: canonical(current),
      value: canonical({ ...current, name: "Unfinished" }),
      label: current.name,
      token: recovery.token,
      expected: 0,
    });
  const before = rows(),
    target: DeletionTarget = { kind: "operation", id: op.id },
    preview = deletion.preview(target);
  expect(
    preview.counts.find((c) => c.label === "Published orders")?.count,
  ).toBe(1);
  expect(preview.counts.find((c) => c.label === "Retained PDFs")?.count).toBe(
    1,
  );
  remove(target);
  const after = rows();
  for (const [table, records] of Object.entries(before))
    for (const record of records as Record<string, unknown>[]) {
      if (
        record.operation_id === other.id ||
        (table === "operations" && record.id === other.id)
      )
        expect(after[table]).toContainEqual(record);
      if (
        record.operation_id === op.id ||
        (table === "operations" && record.id === op.id)
      )
        expect(after[table]).not.toContainEqual(record);
    }
  expect(repo.listWorkingDrafts().map((d) => d.id)).toEqual([other.id]);
  for (const table of [
    "publications",
    "revision_approvals",
    "change_reviews",
    "change_review_changes",
    "change_review_events",
    "exports",
    "export_templates",
    "document_exports",
  ])
    expect(after[table]).toHaveLength(0);
  repo.verifyAll();
});
it("rejects stale confirmation after saved or recovery content changes", () => {
  const op = operation(),
    target: DeletionTarget = { kind: "operation", id: op.id },
    p = deletion.preview(target);
  service.execute({
    type: "save",
    operation: { ...op, name: "Changed after preview" },
    expectedRevision: op.revision,
  });
  expect(() =>
    deletion.commit({ target, fingerprint: p.fingerprint, confirmed: true }),
  ).toThrow(/changed/);
  expect(repo.listOperations()).toHaveLength(1);
});
it("limits deletion permits to exact rows and rolls back every deletion on a hostile side effect", () => {
  const a = operation(),
    b = operation(),
    target: DeletionTarget = { kind: "operation", id: a.id },
    before = rows();
  repo.sqlite.exec(
    `CREATE TRIGGER test_unrelated_delete AFTER DELETE ON operations WHEN OLD.id='${a.id}' BEGIN DELETE FROM operations WHERE id='${b.id}'; END;`,
  );
  expect(() => remove(target)).toThrow(/confirmed/);
  expect(rows()).toEqual(before);
  expect(() =>
    repo.sqlite
      .prepare("DELETE FROM operation_revisions WHERE operation_id=?")
      .run(a.id),
  ).toThrow(/immutable/);
  expect(() =>
    repo.sqlite.prepare("DELETE FROM operations WHERE id=?").run(b.id),
  ).toThrow(/confirmed/);
  repo.sqlite.exec("DROP TRIGGER test_unrelated_delete");
  remove(target);
  repo.verifyAll();
});
it("protects exact symbol pins and explains references before asking to delete", async () => {
  let s = symbol();
  s = lib.execute({
    type: "publish",
    kind: "SYMBOL",
    id: s.versionId,
    expected: s.contentVersion,
  }).symbol!;
  let p = ws.execute({
    type: "unit-profile-new",
    name: "Fictional pinned profile",
  }).profile!;
  p = ws.execute({
    type: "unit-profile-save",
    profile: unitProfileSchema.parse({
      ...p,
      schemaVersion: 2,
      defaultSymbol: repo.resolveSymbolPin(s.versionId),
    }),
    expectedContentVersion: p.contentVersion,
  }).profile!;
  const target: DeletionTarget = { kind: "symbol", id: s.versionId };
  expect(deletion.preview(target).blockers.join(" ")).toContain(
    "Fictional pinned profile",
  );
  showMessageBox.mockResolvedValue({ response: 0 });
  expect(
    (await confirmDeletion(deletion, {} as BrowserWindow, target)).reason,
  ).toBe("referenced");
  expect(showMessageBox.mock.calls[0][1].buttons).toEqual(["OK"]);
  remove({ kind: "unit-profile", id: p.unitProfileVersionId });
  remove(target);
  repo.verifyAll();
});
it("protects old operation revision sources even after removing the unit from live planning", () => {
  let p = ws.execute({
    type: "unit-profile-new",
    name: "Pinned only in history",
  }).profile!;
  p = ws.execute({
    type: "unit-profile-publish",
    id: p.unitProfileVersionId,
    expectedContentVersion: p.contentVersion,
  }).profile!;
  let op = operation();
  op = ws.execute({
    type: "unit-profile-instantiate",
    operation: op,
    unitProfileVersionId: p.unitProfileVersionId,
    subtree: false,
    confirmDuplicate: false,
    importId: uid(),
  }).operation!;
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  const target: DeletionTarget = {
    kind: "unit-profile",
    id: p.unitProfileVersionId,
  };
  expect(deletion.preview(target).blockers.length).toBeGreaterThan(0);
  op.units = op.units.filter((u) => !u.sourceUnitProfile);
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  expect(deletion.preview(target).blockers.length).toBeGreaterThan(0);
  remove({ kind: "operation", id: op.id });
  remove(target);
  repo.verifyAll();
});
it("deletes only the chosen library version and protects derivation ancestry", () => {
  let s = symbol();
  s = lib.execute({
    type: "publish",
    kind: "SYMBOL",
    id: s.versionId,
    expected: s.contentVersion,
  }).symbol!;
  const child = lib.execute({
    type: "derive",
    kind: "SYMBOL",
    id: s.versionId,
    versionLabel: "1.0.1",
    newFamily: false,
  }).symbol!;
  expect(
    deletion.preview({ kind: "symbol", id: s.versionId }).blockers.length,
  ).toBeGreaterThan(0);
  remove({ kind: "symbol", id: child.versionId });
  expect(repo.getSymbol(s.versionId)).toEqual(s);
  remove({ kind: "symbol", id: s.versionId });
  expect(
    repo.sqlite.prepare("SELECT * FROM saved_symbol_families").all(),
  ).toHaveLength(0);
  const o = lib.execute({
    type: "new",
    kind: "ORBAT",
    name: "Unused composition",
  }).orbat!;
  remove({ kind: "orbat", id: o.versionId });
  repo.verifyAll();
});
it("protects bundled doctrine while deleting an unreferenced custom published version", () => {
  const source = repo.listDoctrines()[0];
  expect(
    deletion
      .preview({ kind: "doctrine", id: source.doctrineVersionId })
      .blockers.join(" "),
  ).toContain("Bundled");
  const id = executeDoctrine(repo, rt, {
    type: "doctrine-create",
    sourceId: source.doctrineVersionId,
    name: "Unused doctrine",
    versionLabel: "1.0.0",
    newFamily: true,
  })!;
  const d = repo.listDoctrines().find((v) => v.doctrineVersionId === id)!;
  executeDoctrine(repo, rt, {
    type: "doctrine-publish",
    id,
    expectedContentVersion: d.contentVersion,
  });
  remove({ kind: "doctrine", id });
  expect(
    repo.listDoctrines().find((v) => v.doctrineVersionId === id),
  ).toBeUndefined();
  repo.verifyAll();
});
it("allows empty export-profile catalogs and protects profiles used by retained exports", () => {
  const op = operation();
  for (const p of repo.listExportProfiles(op.id))
    remove({ kind: "export-profile", id: p.id });
  expect(repo.listExportProfiles(op.id)).toEqual([]);
  const p = service.execute({
    type: "save-profile",
    profile: createExportProfile(op, "opord", uid()),
    isNew: true,
  }).profiles[0];
  service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: p.id, version: 1 },
    publicationId: null,
  });
  expect(
    deletion.preview({ kind: "export-profile", id: p.id }).blockers.length,
  ).toBeGreaterThan(0);
  repo.verifyAll();
});
it("persists deletion across reopen and restores the complete pre-deletion backup", async () => {
  repo.close();
  const folder = `.test-data/deletion-${uid()}`;
  mkdirSync(folder, { recursive: true });
  const file = folder + "/ordo.db",
    backup = folder + "/before.db";
  repo = new SqliteRepository(file);
  repo.seedConfig(starterConfig);
  services();
  const op = operation();
  await repo.backup(backup);
  const bytes = readFileSync(backup);
  remove({ kind: "operation", id: op.id });
  repo.close();
  repo = new SqliteRepository(file, true);
  services();
  expect(repo.listOperations()).toEqual([]);
  repo.verifyAll();
  await restoreWorkspace(repo, file, backup, (next) => {
    repo = next;
    services();
  });
  expect(repo.getOperation(op.id)).toEqual(op);
  expect(readFileSync(backup)).toEqual(bytes);
  repo.verifyAll();
});

it("removes unused managed files while preserving their owner and unrelated bytes", () => {
  const op = operation(),
    bytes = Buffer.from("Fictional managed document");
  const assetId = uid(),
    secondId = uid();
  const asset = {
    assetId,
    operationId: op.id,
    doctrineVersionId: null,
    originalFilename: "fictional.txt",
    mimeType: "text/plain" as const,
    sizeBytes: bytes.length,
    sha256: hashBytes(bytes),
    createdAt: rt.now(),
    storageReference: `asset:${assetId}`,
  };
  repo.modular.insertAsset(asset, bytes);
  repo.modular.insertAsset(
    { ...asset, assetId: secondId, storageReference: `asset:${secondId}` },
    bytes,
  );
  expect(deletion.preview({ kind: "asset", id: assetId }).name).toBe(
    "fictional.txt",
  );
  remove({ kind: "asset", id: assetId });
  expect(repo.getOperation(op.id)).toEqual(op);
  expect(repo.modular.readAsset(secondId).bytes).toEqual(bytes);
  remove({ kind: "operation", id: op.id });
  expect(repo.modular.listAssets()).toHaveLength(0);
  repo.verifyAll();
});

it("protects doctrine role mappings without relying on an exact-version ID field", () => {
  const source = repo.listDoctrines()[0];
  const id = executeDoctrine(repo, rt, {
    type: "doctrine-create",
    sourceId: source.doctrineVersionId,
    name: "Mapped doctrine",
    versionLabel: "1.0.0",
    newFamily: true,
  })!;
  const d = repo.listDoctrines().find((v) => v.doctrineVersionId === id)!;
  executeDoctrine(repo, rt, {
    type: "doctrine-publish",
    id,
    expectedContentVersion: d.contentVersion,
  });
  let p = ws.execute({
    type: "unit-profile-new",
    name: "Mapping owner",
  }).profile!;
  p.roleMappings.push({
    doctrineFamilyId: d.doctrineFamilyId,
    doctrineVersion: d.config.doctrine.version,
    staffId: d.config.doctrine.staff[0].id,
    functionalRole: "OPERATIONS",
  });
  p = ws.execute({
    type: "unit-profile-save",
    profile: p,
    expectedContentVersion: p.contentVersion,
  }).profile!;
  expect(
    deletion.preview({ kind: "doctrine", id }).blockers.join(" "),
  ).toContain("Mapping owner");
  remove({ kind: "unit-profile", id: p.unitProfileVersionId });
  remove({ kind: "doctrine", id });
  repo.verifyAll();
});

it("preserves qualified migrations and historical render, projection, review and print implementations", () => {
  const frozen = JSON.parse(
    readFileSync("tests/fixtures/deletion-frozen-implementations.json", "utf8"),
  );
  expect(Object.keys(frozen)).toHaveLength(69);
  for (const [file, hash] of Object.entries(frozen))
    expect(hashBytes(readFileSync(file)), file).toBe(hash);
});
