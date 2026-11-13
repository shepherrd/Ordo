import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import {
  WorkingDraftService,
  type DraftKey,
} from "../src/application/working-drafts";
import { DocumentService } from "../src/application/document-service";
import { OrdoService } from "../src/application/service";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { canonical } from "../src/export/projection";
import { printHtmlV1 } from "../src/export/print-v1";
import { SymbologyService } from "../src/application/symbology-service";
import { WorkspaceService } from "../src/application/workspace-service";
import { executeDoctrine } from "../src/application/doctrine-service";
import { ReviewService } from "../src/application/review-service";
import { endpointSelector } from "../src/persistence/review-store";
import {
  preferencesDraftId,
  editablePreferences,
  parseWorkingJson,
} from "../src/application/working-drafts";
import { assertSafeOutput } from "../src/main/output-path";
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from "node:fs";
import { resolve, join } from "node:path";
let repo: SqliteRepository, service: OrdoService, recovery: WorkingDraftService;
const rt = {
  id: uid,
  now: () => "2026-10-07T12:00:00.000Z",
  actor: "Fictional essentials tester",
};
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  service = new OrdoService(repo, rt, (_name, c) =>
    demoOperation(c, uid, rt.now()),
  );
  recovery = new WorkingDraftService(repo, rt);
});
afterEach(() => repo.close());
const operation = () =>
  service.execute({
    type: "create",
    name: "Fictional essentials operation",
    demo: true,
  }).operation!;
it("recovers incomplete edits without creating a revision, approval, or publication", () => {
  const source = operation(),
    value = structuredClone(source);
  value.name = "";
  value.sections[0].summary = "Unfinished narrative";
  const key: DraftKey = { kind: "operation", id: source.id, scope: source.id };
  const d = recovery.execute({
    type: "put",
    key,
    source: canonical(source),
    value: canonical(value),
    label: source.name,
    token: recovery.token,
    expected: 0,
  }).draft!;
  expect(d.sequence).toBeGreaterThan(0);
  expect(recovery.execute({ type: "get", key }).compatible).toBe(true);
  expect(repo.getOperation(source.id)).toEqual(source);
  expect(repo.listPublications(source.id)).toHaveLength(0);
  expect(repo.listApprovals(source.id)).toHaveLength(0);
  const reopened = new WorkingDraftService(repo, rt);
  expect(
    JSON.parse(reopened.execute({ type: "get", key }).draft!.value).name,
  ).toBe("");
  repo.verifyAll();
});
it("retains a stale copy, rejects changed sources, and invalidates old workspace tokens", () => {
  const source = operation(),
    value = { ...source, name: "Unfinished name" },
    key: DraftKey = { kind: "operation", id: source.id, scope: source.id };
  const c = {
    type: "put" as const,
    key,
    source: canonical(source),
    value: canonical(value),
    label: source.name,
    token: recovery.token,
    expected: 0,
  };
  const d = recovery.execute(c).draft!;
  service.execute({
    type: "save",
    operation: { ...source, name: "Saved elsewhere" },
    expectedRevision: source.revision,
  });
  expect(recovery.execute({ type: "get", key }).compatible).toBe(false);
  expect(() => recovery.execute({ ...c, expected: d.sequence })).toThrow(
    /source changed/,
  );
  const next = new WorkingDraftService(repo, rt);
  expect(() =>
    next.execute({
      type: "remove",
      token: recovery.token,
      key,
      expected: d.sequence,
    }),
  ).toThrow(/workspace changed/);
  expect(next.execute({ type: "get", key }).draft!.value).toBe(c.value);
});
it("does not let another editor replace or delete a newer recovery generation", () => {
  const source = operation(),
    key: DraftKey = { kind: "operation", id: source.id, scope: source.id };
  const put = (expected: number) =>
    recovery.execute({
      type: "put",
      key,
      source: canonical(source),
      value: canonical({ ...source, name: "Unfinished" }),
      label: source.name,
      token: recovery.token,
      expected,
    }).draft!;
  const a = put(0);
  expect(() => put(0)).toThrow(/Another editor/);
  recovery.execute({
    type: "remove",
    token: recovery.token,
    key,
    expected: a.sequence,
  });
  const b = put(0);
  expect(b.sequence).toBeGreaterThan(a.sequence);
  expect(() =>
    recovery.execute({
      type: "remove",
      token: recovery.token,
      key,
      expected: a.sequence,
    }),
  ).toThrow(/copy changed/);
});
it("rejects structural corruption and changed identity before retaining a working copy", () => {
  const source = operation(),
    key: DraftKey = { kind: "operation", id: source.id, scope: source.id };
  const put = (v: unknown) =>
    recovery.execute({
      type: "put",
      key,
      source: canonical(source),
      value: JSON.stringify(v),
      label: source.name,
      token: recovery.token,
      expected: 0,
    });
  expect(() => put({ ...source, units: "invalid" })).toThrow(/structure/);
  expect(() => put({ ...source, id: uid() })).toThrow(/cannot change id/);
  expect(() => put({ ...source, revision: 999 })).toThrow(
    /cannot change revision/,
  );
  expect(repo.listWorkingDrafts()).toHaveLength(0);
});
it("explicit discard affects only working copies touched in this session and scope", () => {
  const a = operation(),
    b = operation();
  for (const op of [a, b])
    recovery.execute({
      type: "put",
      key: { kind: "operation", id: op.id, scope: op.id },
      source: canonical(op),
      value: canonical({ ...op, name: "Unfinished" }),
      label: op.name,
      token: recovery.token,
      expected: 0,
    });
  recovery.discardSessionCopies(a.id);
  expect(repo.listWorkingDrafts().map((d) => d.id)).toEqual([b.id]);
  new WorkingDraftService(repo, rt).discardSessionCopies();
  expect(repo.listWorkingDrafts()).toHaveLength(1);
});
it("retains exact PDF bytes and provenance independently of later planning changes", async () => {
  const op = operation(),
    profile = repo.listExportProfiles(op.id)[0];
  service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId: null,
  });
  const source = repo.listExports(op.id)[0],
    original = source.html,
    bytes = Buffer.from("%PDF-1.7\nfixture bytes\n%%EOF");
  const documents = new DocumentService(repo, rt, {
    render: async (html, options) => {
      expect(html).toContain(source.id);
      expect(options.paper).toBe("Letter");
      return {
        bytes,
        environment: {
          appVersion: "0.6.4",
          electron: "fixture",
          chromium: "fixture",
          fontFingerprint: "a".repeat(64),
        },
      };
    },
  });
  const record = await documents.generate({
    type: "generate",
    operationId: op.id,
    exportId: source.id,
    options: { paper: "Letter", orientation: "portrait" },
  });
  expect(repo.getDocument(record.id).bytes).toEqual(bytes);
  expect(record.sourceHtmlHash).toBe(repo.hash(original));
  service.execute({
    type: "save",
    operation: { ...op, name: "Changed later" },
    expectedRevision: op.revision,
  });
  expect(repo.listExports(op.id)[0].html).toBe(original);
  expect(repo.getDocument(record.id).record).toEqual(record);
  expect(() =>
    repo.sqlite
      .prepare("UPDATE document_exports SET bytes=? WHERE id=?")
      .run(Buffer.from("changed"), record.id),
  ).toThrow(/immutable/);
  expect(() =>
    repo.sqlite
      .prepare("DELETE FROM document_exports WHERE id=?")
      .run(record.id),
  ).toThrow(/immutable/);
  expect(printHtmlV1(source, record.options)).toContain("table-header-group");
  repo.verifyAll();
});

it("keeps library, doctrine, export-profile, and preference edits bound to exact source versions", () => {
  const op = operation(),
    symbols = new SymbologyService(repo, rt),
    workspace = new WorkspaceService(repo, rt);
  const symbol = symbols.execute({
    type: "new",
    kind: "SYMBOL",
    name: "Symbol",
  }).symbol!;
  const orbat = symbols.execute({
    type: "new",
    kind: "ORBAT",
    name: "ORBAT",
  }).orbat!;
  const unit = workspace.execute({
    type: "unit-profile-new",
    name: "Unit",
  }).profile!;
  const doctrineId = executeDoctrine(repo, rt, {
    type: "doctrine-create",
    sourceId: repo.listDoctrines()[0].doctrineVersionId,
    name: "Doctrine",
    versionLabel: "1.0.0",
    newFamily: true,
  });
  const doctrine = repo
    .listDoctrines()
    .find((d) => d.doctrineVersionId === doctrineId)!;
  const profile = repo.listExportProfiles(op.id)[0];
  const preferences = editablePreferences(repo.preferences())!;
  const examples: { key: DraftKey; source: unknown; value: unknown }[] = [
    {
      key: { kind: "symbol", id: symbol.versionId, scope: null },
      source: symbol,
      value: { ...symbol, name: "Working symbol" },
    },
    {
      key: { kind: "orbat", id: orbat.versionId, scope: null },
      source: orbat,
      value: { ...orbat, name: "Working ORBAT" },
    },
    {
      key: { kind: "unit-profile", id: unit.unitProfileVersionId, scope: null },
      source: unit,
      value: {
        ...unit,
        identity: { ...unit.identity, fullDesignation: "Working unit" },
      },
    },
    {
      key: { kind: "doctrine", id: doctrineId, scope: null },
      source: doctrine,
      value: { ...doctrine, displayName: "Working doctrine" },
    },
    {
      key: { kind: "export-profile", id: profile.id, scope: op.id },
      source: profile,
      value: { ...profile, name: "Working profile" },
    },
    {
      key: { kind: "preferences", id: preferencesDraftId, scope: null },
      source: preferences,
      value: {
        ...preferences,
        pageSize: preferences.pageSize === "letter" ? "a4" : "letter",
      },
    },
  ];
  for (const { key, source, value } of examples) {
    const d = recovery.execute({
      type: "put",
      key,
      source: canonical(source),
      value: canonical(value),
      label: key.kind,
      token: recovery.token,
      expected: 0,
    }).draft!;
    expect(
      recovery.execute({
        type: "recover",
        key,
        token: recovery.token,
        expected: d.sequence,
      }).draft?.value,
    ).toBe(canonical(value));
  }
  repo.preferences({ ...repo.preferences(), lastOpenedOperationId: op.id });
  expect(
    recovery.execute({ type: "get", key: examples[5].key }).compatible,
  ).toBe(true);
  expect(repo.getSymbol(symbol.versionId).name).toBe("Symbol");
  expect(
    repo.getUnitProfile(unit.unitProfileVersionId).identity.fullDesignation,
  ).toBe("Unit");
  repo.verifyAll();
});

it("binds review notes to their event history and restores the chosen comparison pair", () => {
  let op = operation();
  op = service.execute({
    type: "save",
    operation: { ...op, name: "Second revision" },
    expectedRevision: op.revision,
  }).operation!;
  const reviews = new ReviewService(repo, rt),
    h = reviews.execute({ type: "history", operationId: op.id }).history;
  const r = reviews.execute({
    type: "create-review",
    baseline: endpointSelector(h[1].endpoint),
    target: endpointSelector(h[0].endpoint),
    engineVersion: "diff-engine-v3",
    title: "Review",
    description: "",
    expectedRevision: op.revision,
    parentReviewId: null,
    supersedesReviewId: null,
  }).review!;
  const value = {
    baseline: `r:${h[1].endpoint.revisionId}`,
    target: `r:${h[0].endpoint.revisionId}`,
    title: "Working review",
    description: "Unsubmitted",
    comment: "Draft comment",
    note: "",
    parent: null,
    supersedes: null,
    changeDrafts: {},
  };
  const key: DraftKey = { kind: "review", id: r.id, scope: op.id };
  const d = recovery.execute({
    type: "put",
    key,
    source: canonical(r),
    value: canonical(value),
    label: "Review",
    token: recovery.token,
    expected: 0,
  }).draft!;
  expect(JSON.parse(d.value)).toEqual(value);
  expect(repo.getReview(r.id).events).toHaveLength(0);
  reviews.execute({
    type: "review-actions",
    id: r.id,
    expectedSequence: 0,
    actions: [{ type: "COMMENT", changeId: null, text: "Recorded separately" }],
    confirmedBulk: false,
  });
  expect(recovery.execute({ type: "get", key }).compatible).toBe(false);
  expect(() =>
    recovery.execute({
      type: "recover",
      key,
      expected: d.sequence,
      token: recovery.token,
    }),
  ).toThrow(/source changed/);
  expect(repo.getWorkingDraft(key)?.value).toBe(canonical(value));
});

it("rejects wrong scopes, unsafe JSON, excessive inputs, and corrupted retained recovery values", () => {
  const op = operation(),
    key: DraftKey = { kind: "operation", id: op.id, scope: op.id };
  const c = {
    type: "put",
    key,
    source: canonical(op),
    value: canonical({ ...op, name: "Unfinished" }),
    label: "Work",
    token: recovery.token,
    expected: 0,
  };
  expect(() =>
    recovery.execute({ ...c, key: { ...key, scope: uid() } }),
  ).toThrow(/source changed/);
  expect(() =>
    recovery.execute({ ...c, value: " ".repeat(8 * 1024 * 1024 + 1) }),
  ).toThrow();
  expect(() => parseWorkingJson('{"__proto__":{"test":true}}')).toThrow(
    /Invalid working/,
  );
  expect(() => parseWorkingJson("[".repeat(82) + "0" + "]".repeat(82))).toThrow(
    /limits/,
  );
  const d = recovery.execute(c).draft!;
  repo.sqlite
    .prepare("UPDATE working_drafts SET document=?")
    .run(JSON.stringify({ ...d, value: '{"units":"corrupt"}' }));
  expect(recovery.execute({ type: "get", key }).compatible).toBe(false);
  expect(() =>
    recovery.execute({
      type: "recover",
      token: recovery.token,
      key,
      expected: d.sequence,
    }),
  ).toThrow();
  expect(() => repo.verifyAll()).toThrow(/structure/);
});

it("clears only the submitted working copy after a successful save", () => {
  const op = operation(),
    value = { ...op, name: "Save this" },
    key: DraftKey = { kind: "operation", id: op.id, scope: op.id };
  recovery.execute({
    type: "put",
    key,
    source: canonical(op),
    value: canonical(value),
    label: "Work",
    token: recovery.token,
    expected: 0,
  });
  recovery.commandSucceeded({
    type: "save",
    operation: { ...value, name: "Different pending edits" },
  });
  expect(repo.getWorkingDraft(key)).not.toBeNull();
  service.execute({
    type: "save",
    operation: value,
    expectedRevision: op.revision,
  });
  recovery.commandSucceeded({ type: "save", operation: value });
  expect(repo.getWorkingDraft(key)).toBeNull();
});

it("protects workspace files including symlinked output paths without blocking sibling folders", () => {
  mkdirSync(".test-data", { recursive: true });
  const folder = mkdtempSync(resolve(".test-data/essentials-output-")),
    data = join(folder, "workspace"),
    sibling = join(folder, "workspace-exports");
  mkdirSync(data);
  mkdirSync(sibling);
  mkdirSync(join(data, "..exports"));
  writeFileSync(join(data, "ordo.db"), "fixture");
  symlinkSync(data, join(folder, "alias"), "junction");
  expect(() => assertSafeOutput(join(data, "ordo.db"), data)).toThrow(
    /outside/,
  );
  expect(() =>
    assertSafeOutput(join(folder, "alias", "new.pdf"), data),
  ).toThrow(/outside/);
  expect(() => assertSafeOutput(join(data, "..output.pdf"), data)).toThrow(
    /outside/,
  );
  expect(() =>
    assertSafeOutput(join(data, "..exports", "new.pdf"), data),
  ).toThrow(/outside/);
  expect(() => assertSafeOutput(join(sibling, "new.pdf"), data)).not.toThrow();
});

it("does not retain partial documents when rendering fails and rejects invalid document options", async () => {
  const op = operation(),
    profile = repo.listExportProfiles(op.id)[0];
  service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId: null,
  });
  const source = repo.listExports(op.id)[0],
    docs = new DocumentService(repo, rt, {
      render: async () => {
        throw Error("Render failed");
      },
    });
  const input = {
    type: "generate",
    operationId: op.id,
    exportId: source.id,
    options: { paper: "Letter", orientation: "portrait" },
  };
  await expect(docs.generate(input)).rejects.toThrow(/Render failed/);
  await expect(
    docs.generate({
      ...input,
      options: { paper: "custom", orientation: "portrait" },
    }),
  ).rejects.toThrow();
  await expect(
    docs.generate({ ...input, operationId: uid() }),
  ).rejects.toThrow();
  expect(repo.listDocuments(op.id)).toHaveLength(0);
  const html = printHtmlV1(
    source,
    input.options as { paper: "Letter"; orientation: "portrait" },
  );
  expect(html.indexOf("Content-Security-Policy")).toBeLessThan(
    html.indexOf("<style"),
  );
  expect(html).toContain("counter(pages)");
});
