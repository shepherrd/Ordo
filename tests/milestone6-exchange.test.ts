import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { mkdirSync, readFileSync, copyFileSync } from "node:fs";
import Database from "better-sqlite3";
import { SqliteRepository } from "../src/persistence/repository";
import { SymbologyService } from "../src/application/symbology-service";
import { WorkspaceService } from "../src/application/workspace-service";
import { ExchangeService } from "../src/application/exchange-service";
import { GraphicExportService } from "../src/application/graphic-export-service";
import {
  createNativeExchange,
  assertNativeExchange,
} from "../src/application/native-exchange";
import { parseExchangeJson } from "../src/application/exchange-json";
import { renderSymbol } from "../src/rendering/symbol-renderer";
import { canonical } from "../src/export/projection";
import { hashBytes } from "../src/persistence/modular-store";
import { starterConfig } from "../src/config/profiles";
import { unitProfileSchema } from "../src/domain/unit-profiles";
import type { GraphicRenderPort } from "../src/application/render-contracts";
import type {
  ExchangeRoot,
  NativeExchange,
} from "../src/domain/library-exchange";
import { restoreWorkspace } from "../src/persistence/restore";
import { newSavedSymbol } from "../src/domain/symbology";
const rt = {
  id: uid,
  now: () => "2026-10-03T12:00:00.000Z",
  actor: "Fictional import tester",
};
const sidc = "130310000012110000000000000000";

function nativeSymbolFile() {
  const value = newSavedSymbol("Exercise symbol", uid, rt.now());
  value.definition.code.sidc = sidc;
  return JSON.stringify(envelope({ kind: "SYMBOL", value }));
}
it("provides bounded visual previews without letting preview edits change the retained import", async () => {
  const source = nativeSymbolFile();
  const preview = await exchange.prepare(source, "visuals.json", "REUSE_EXACT");
  expect(preview.targets).toHaveLength(1);
  expect(preview.visuals).toHaveLength(1);
  const request = preview.visuals![0].request;
  expect(request.kind).toBe("SYMBOL");
  if (request.kind === "SYMBOL")
    request.input.definition.code.sidc = "invalid client edit";
  const imported = exchange.commit(
    preview.token,
    preview.requiresAcknowledgement,
  );
  expect(
    repo.getSymbol(imported.targets[0].versionId).definition.code.sidc,
  ).toBe(sidc);
  const receipt = repo.getExchangeImport(imported.receiptId);
  expect(receipt.sourceText).toBe(source);
  expect(receipt).not.toHaveProperty("visuals");
});

it("previews the remapped ORBAT hierarchy and withholds graphics for blocked imports", async () => {
  const source = JSON.stringify(envelope(composed()));
  const preview = await exchange.prepare(source, "tree.json", "REUSE_EXACT");
  const request = preview.visuals![0].request;
  expect(request.kind).toBe("ORBAT");
  if (request.kind === "ORBAT") {
    expect(request.input.nodes).toHaveLength(2);
    expect(request.input.nodes[1].parentId).toBe(request.input.nodes[0].id);
  }
  const blocked = await new ExchangeService(repo, rt, {
    render: async () => {
      throw Error("Invalid symbol geometry");
    },
  }).prepare(source, "tree.json", "REUSE_EXACT");
  expect(blocked.canCommit).toBe(false);
  expect(blocked.visuals).toBeUndefined();
});
const renderer: GraphicRenderPort = {
  render: async (r) => {
    if (r.kind !== "SYMBOL") throw Error("Unexpected validation request");
    return { kind: "SYMBOL", result: renderSymbol(r.input) };
  },
};
let repo: SqliteRepository, lib: SymbologyService, exchange: ExchangeService;
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  lib = new SymbologyService(repo, rt);
  exchange = new ExchangeService(repo, rt, renderer);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (repo.sqlite.open) repo.close();
});
const count = (table: string) =>
  (
    repo.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as {
      n: number;
    }
  ).n;
const symbol = () =>
  lib.execute({ type: "new", kind: "SYMBOL", name: "Fictional symbol" })
    .symbol!;
function composed(): ExchangeRoot {
  let s = symbol();
  s = lib.execute({
    type: "publish",
    kind: "SYMBOL",
    id: s.versionId,
    expected: s.contentVersion,
  }).symbol!;
  const ws = new WorkspaceService(repo, rt);
  let p = ws.execute({
    type: "unit-profile-new",
    name: "Fictional profile",
  }).profile!;
  p = unitProfileSchema.parse({
    ...p,
    schemaVersion: 2,
    defaultSymbol: repo.resolveSymbolPin(s.versionId),
  });
  p = ws.execute({
    type: "unit-profile-save",
    profile: p,
    expectedContentVersion: p.contentVersion,
  }).profile!;
  p = ws.execute({
    type: "unit-profile-publish",
    id: p.unitProfileVersionId,
    expectedContentVersion: p.contentVersion,
  }).profile!;
  let o = lib.execute({
    type: "orbat-from-profile",
    id: p.unitProfileVersionId,
    name: "Fictional composition",
  }).orbat!;
  const child = structuredClone(o.nodes[0]);
  child.nodeId = uid();
  child.parentNodeId = o.rootNodeId;
  o.nodes.push(child);
  o.layout.hints.push({
    nodeId: child.nodeId,
    folded: true,
    hqStaff: true,
    offset: { x: 15, y: -10 },
  });
  o.layout.siblingOrder = [child.nodeId, o.rootNodeId];
  o = lib.execute({
    type: "save-orbat",
    value: o,
    expected: o.contentVersion,
  }).orbat!;
  return { kind: "ORBAT", value: o };
}
const envelope = (root: ExchangeRoot) =>
  createNativeExchange(root, repo, hashBytes);
const seal = (e: NativeExchange) => {
  e.rootHash = hashBytes(canonical(e.root.value));
  const { contentHash: _h, ...p } = e;
  e.contentHash = hashBytes(canonical(p));
  return e;
};
it("round trips complete native composition pins once and remaps nodes/layout consistently", async () => {
  const root = composed(),
    e = envelope(root);
  expect(e.dependencies.map((d) => d.kind)).toEqual(["PROFILE", "SYMBOL"]);
  const before = count("saved_orbat_versions"),
    preview = await exchange.prepare(
      JSON.stringify(e),
      "native.json",
      "REUSE_EXACT",
    );
  expect(preview.canCommit).toBe(true);
  expect(preview.fields.filter((f) => f.action === "REUSED")).toHaveLength(2);
  expect(count("saved_orbat_versions")).toBe(before);
  const result = exchange.commit(preview.token, false),
    o = repo.getOrbat(result.targets[0].versionId);
  expect(o.status).toBe("DRAFT");
  expect(o.familyId).not.toBe(root.value.familyId);
  expect(o.nodes).toHaveLength(2);
  expect(o.nodes[1].parentNodeId).toBe(o.rootNodeId);
  expect(o.layout.hints[0].nodeId).toBe(o.nodes[1].nodeId);
  expect(o.layout.siblingOrder).toEqual([o.nodes[1].nodeId, o.rootNodeId]);
  expect(o.nodes[0].unit).toEqual(
    root.kind === "ORBAT" ? root.value.nodes[0].unit : null,
  );
  expect(exchange.commit(preview.token, false)).toEqual(result);
  expect(count("saved_orbat_versions")).toBe(before + 1);
  repo.verifyAll();
});
it("requires explicit detachment for missing dependencies without publishing imported data", async () => {
  const e = envelope(composed()),
    destination = new SqliteRepository(":memory:");
  destination.seedConfig(starterConfig);
  try {
    const x = new ExchangeService(destination, rt, renderer),
      p = await x.prepare(JSON.stringify(e), "foreign.json", "REUSE_EXACT");
    expect(p.canCommit).toBe(false);
    expect(p.fields.filter((f) => f.action === "MISSING")).toHaveLength(2);
    expect(() => x.commit(p.token, true)).toThrow(/invalid/);
    const detached = await x.revise(p.token, "DETACHED_COPIES");
    expect(detached.canCommit).toBe(true);
    expect(() => x.commit(detached.token, false)).toThrow(/Acknowledge/);
    const result = x.commit(detached.token, true),
      o = destination.getOrbat(result.targets[0].versionId);
    expect(
      o.nodes.every(
        (n) =>
          n.unit.kind === "INLINE_UNIT" &&
          n.unit.symbol?.source === null &&
          n.unit.symbol.definition.origin.kind === "IMPORT",
      ),
    ).toBe(true);
    expect(
      destination.browseLibrary("SYMBOL", {
        search: "",
        status: "",
        offset: 0,
        limit: 30,
      }).total,
    ).toBe(0);
    expect(destination.getExchangeImport(result.receiptId).sourceText).toBe(
      JSON.stringify(e),
    );
    destination.verifyAll();
  } finally {
    destination.close();
  }
});
it("reports same-ID content conflicts and never overwrites the existing family", async () => {
  const e = envelope(composed()),
    symbolDep = e.dependencies.find((d) => d.kind === "SYMBOL")!;
  if (symbolDep.kind !== "SYMBOL") throw Error();
  const original = repo.getSymbol(symbolDep.ref.versionId);
  symbolDep.document.name = "Different foreign name";
  symbolDep.ref.contentHash = hashBytes(canonical(symbolDep.document));
  const profileDep = e.dependencies.find((d) => d.kind === "PROFILE")!;
  if (
    profileDep.kind !== "PROFILE" ||
    profileDep.document.schemaVersion !== 2 ||
    !profileDep.document.defaultSymbol ||
    e.root.kind !== "ORBAT"
  )
    throw Error();
  profileDep.document.defaultSymbol.contentHash = symbolDep.ref.contentHash;
  profileDep.ref.contentHash = hashBytes(canonical(profileDep.document));
  for (const n of e.root.value.nodes)
    if (n.unit.kind === "UNIT_PROFILE") {
      n.unit.source.contentHash = profileDep.ref.contentHash;
      n.unit.defaultSymbol!.contentHash = symbolDep.ref.contentHash;
    }
  seal(e);
  const p = await exchange.prepare(
    JSON.stringify(e),
    "conflict.json",
    "REUSE_EXACT",
  );
  expect(p.canCommit).toBe(false);
  expect(p.fields.some((f) => f.action === "CONFLICT")).toBe(true);
  expect(repo.getSymbol(original.versionId)).toEqual(original);
});
it("rechecks publication lifecycle at commit and blocks newly retired dependencies", async () => {
  const e = envelope(composed()),
    p = await exchange.prepare(JSON.stringify(e), "native.json", "REUSE_EXACT"),
    d = e.dependencies.find((d) => d.kind === "SYMBOL")!;
  lib.execute({ type: "retire", kind: "SYMBOL", id: d.ref.versionId });
  expect(() => exchange.commit(p.token, false)).toThrow(
    /changed since preview/,
  );
  expect(count("library_exchange_imports")).toBe(0);
  const retired = await exchange.prepare(
    JSON.stringify(e),
    "retired.json",
    "REUSE_EXACT",
  );
  expect(retired.fields.some((f) => f.action === "CONFLICT")).toBe(true);
});
it("exports already pinned retired dependencies using the original published bytes", () => {
  const root = composed(),
    before = envelope(root),
    d = before.dependencies.find((d) => d.kind === "SYMBOL")!;
  lib.execute({ type: "retire", kind: "SYMBOL", id: d.ref.versionId });
  expect(envelope(root)).toEqual(before);
});
it("rejects missing, extra, mismatched and cyclic native dependencies even with resealed outer hashes", () => {
  const e = envelope(composed());
  const missing = structuredClone(e);
  missing.dependencies = [];
  expect(() => assertNativeExchange(seal(missing), hashBytes)).toThrow(
    /Missing/,
  );
  const duplicate = structuredClone(e);
  duplicate.dependencies.push(duplicate.dependencies[0]);
  expect(() => assertNativeExchange(seal(duplicate), hashBytes)).toThrow(
    /Duplicate/,
  );
  const wrong = structuredClone(e);
  if (wrong.root.kind !== "ORBAT") throw Error();
  wrong.root.value.nodes[0].unit.identity.fullDesignation =
    "Not the pinned name";
  expect(() => assertNativeExchange(seal(wrong), hashBytes)).toThrow(
    /profile dependency/,
  );
  const extra = structuredClone(e),
    s = symbol();
  const published = lib.execute({
    type: "publish",
    kind: "SYMBOL",
    id: s.versionId,
    expected: 1,
  }).symbol!;
  extra.dependencies.push({
    kind: "SYMBOL",
    ref: {
      familyId: published.familyId,
      versionId: published.versionId,
      contentHash: repo.libraryHash("SYMBOL", published.versionId),
    },
    document: published,
  });
  expect(() => assertNativeExchange(seal(extra), hashBytes)).toThrow(
    /unrelated/,
  );
  const bad = structuredClone(e);
  bad.contentHash = "0".repeat(64);
  expect(() => assertNativeExchange(bad, hashBytes)).toThrow(/hash mismatch/);
});
it.each([
  { payload: [{ sidc }] },
  { payload: { options: { sidc }, subOrganizations: [], commandLevels: "1" } },
  { payload: { format: "unknown" } },
  { payload: null },
])(
  "rejects an unsupported JSON format before creating any records",
  async ({ payload }) => {
    await expect(
      exchange.prepare(JSON.stringify(payload), "external.json", "REUSE_EXACT"),
    ).rejects.toThrow(/Choose an Ordo JSON/);
    expect(count("saved_symbol_versions")).toBe(0);
    expect(count("library_exchange_imports")).toBe(0);
  },
);
it("rejects duplicate/prototype keys, malformed, oversized, and deeply nested JSON before interpretation", () => {
  for (const s of [
    '{"sidc":"a","sidc":"b"}',
    '{"x":{},"x":1}',
    '{"__proto__":{}}',
    '{"constructor":{}}',
    '["unterminated]',
    "[".repeat(161) + "0" + "]".repeat(161),
    '"' + "a".repeat(10 * 1024 * 1024) + '"',
  ])
    expect(() => parseExchangeJson(s)).toThrow();
  expect(
    parseExchangeJson('\ufeff{"text":"escaped \\\" quote","nested":{"a":1}}'),
  ).toEqual({ text: 'escaped " quote', nested: { a: 1 } });
});
it("cancels previews without writes, expires tokens and bounds pending preview count", async () => {
  let now = 0;
  const x = new ExchangeService(repo, rt, renderer, () => now),
    source = nativeSymbolFile();
  const cancelled = await x.prepare(source, "a.json", "REUSE_EXACT");
  x.cancel(cancelled.token);
  expect(() => x.commit(cancelled.token, true)).toThrow(/cancelled/);
  const p = await x.prepare(source, "a.json", "REUSE_EXACT");
  now = 600001;
  expect(() => x.commit(p.token, true)).toThrow(/expired/);
  for (let i = 0; i < 4; i++) await x.prepare(source, "a.json", "REUSE_EXACT");
  await expect(x.prepare(source, "a.json", "REUSE_EXACT")).rejects.toThrow(
    /limit 4/,
  );
  const ac = new AbortController();
  ac.abort();
  await expect(
    exchange.prepare(source, "a.json", "REUSE_EXACT", ac.signal),
  ).rejects.toThrow(/cancelled/);
  expect(count("library_exchange_imports")).toBe(0);
});
it("rolls back every target and receipt if any library save fails", async () => {
  const p = await exchange.prepare(
    nativeSymbolFile(),
    "symbol.json",
    "REUSE_EXACT",
  );
  vi.spyOn(repo, "saveLibrary").mockImplementation(() => {
    throw Error("Injected save failure");
  });
  expect(() => exchange.commit(p.token, true)).toThrow(/Injected/);
  expect(count("saved_symbol_versions")).toBe(0);
  expect(count("library_exchange_imports")).toBe(0);
  vi.restoreAllMocks();
  expect(exchange.commit(p.token, true).targets).toHaveLength(1);
});
it("keeps immutable receipts through editing, derivation and deletion and prevents origin forgery", async () => {
  const p = await exchange.prepare(
      nativeSymbolFile(),
      "one.json",
      "REUSE_EXACT",
    ),
    r = exchange.commit(p.token, true);
  let s = repo.getSymbol(r.targets[0].versionId);
  const receipt = repo.getExchangeImport(r.receiptId);
  const forged = structuredClone(s);
  delete forged.exchangeOrigin;
  expect(() =>
    lib.execute({ type: "save-symbol", value: forged, expected: 1 }),
  ).toThrow(/immutable/);
  s.name = "Renamed";
  s = lib.execute({ type: "save-symbol", value: s, expected: 1 }).symbol!;
  expect(repo.getExchangeImport(r.receiptId)).toEqual(receipt);
  const copy = lib.execute({
    type: "derive",
    kind: "SYMBOL",
    id: s.versionId,
    versionLabel: "1.0.0",
    newFamily: true,
  }).symbol!;
  expect(copy.exchangeOrigin).toEqual(s.exchangeOrigin);
  lib.execute({ type: "delete-draft", kind: "SYMBOL", id: copy.versionId });
  lib.execute({ type: "delete-draft", kind: "SYMBOL", id: s.versionId });
  expect(repo.getExchangeImport(r.receiptId)).toEqual(receipt);
  expect(() =>
    repo.sqlite.exec("DELETE FROM library_exchange_imports"),
  ).toThrow(/retained/);
  expect(() =>
    repo.sqlite.exec("UPDATE library_exchange_imports SET content_hash='bad'"),
  ).toThrow(/immutable/);
  repo.verifyAll();
});
it("retains native export profile/source/dependencies and rejects tampered or selected native output", async () => {
  const root = composed();
  if (root.kind !== "ORBAT") throw Error();
  const service = new GraphicExportService(
      repo,
      rt,
      {
        render: async () => {
          throw Error("Native JSON must not render");
        },
      },
      {
        rasterize: async () => {
          throw Error();
        },
      },
    ),
    profile = {
      schemaVersion: 1,
      id: uid(),
      version: 1,
      name: "Native composition",
      product: "ORBAT",
      format: "JSON",
      jsonMode: "NATIVE_EXCHANGE",
      size: 30,
      scale: 1,
      background: "TRANSPARENT",
      foldPolicy: "AS_SHOWN",
      ancestorPolicy: "BOUNDARY",
      selectedUnitIds: null,
      renderProfile: { id: "ordo-symbol", version: 1 },
    },
    source = {
      kind: "SAVED_ORBAT",
      versionId: root.value.versionId,
      expectedContentVersion: root.value.contentVersion,
    };
  const r = await service.generate({ source, profile }),
    stored = repo.getGraphicExport(r.id),
    e = assertNativeExchange(
      JSON.parse(Buffer.from(stored.bytes).toString()),
      hashBytes,
    );
  expect(e).toEqual(envelope(root));
  expect(r.renderManifests).toEqual([]);
  expect(r.profile.jsonMode).toBe("NATIVE_EXCHANGE");
  const changed = structuredClone(e);
  changed.root.value.name = "Different";
  seal(changed);
  const bytes = Buffer.from(JSON.stringify(changed));
  expect(() =>
    repo.insertGraphicExport(
      {
        ...r,
        id: uid(),
        contentHash: hashBytes(bytes),
        byteLength: bytes.length,
      },
      bytes,
    ),
  ).toThrow(/source or dependency/);
  await expect(
    service.generate({
      source,
      profile: {
        ...profile,
        id: uid(),
        selectedUnitIds: [root.value.rootNodeId],
      },
    }),
  ).rejects.toThrow(/Native exchange/);
  repo.verifyAll();
});
it("validates a shared symbol only once across the imported hierarchy", async () => {
  const source = JSON.stringify(envelope(composed()));
  const spy = vi.spyOn(renderer, "render");
  const p = await exchange.prepare(source, "repeated.json", "REUSE_EXACT");
  expect(p.canCommit).toBe(true);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(
    repo.getExchangeImport(exchange.commit(p.token, false).receiptId)
      .sourceText,
  ).toBe(source);
});
it("backs up/restores immutable exchange receipts and rejects altered receipt protection", async () => {
  mkdirSync(".test-data", { recursive: true });
  const path = `.test-data/exchange-${uid()}.db`,
    backup = `.test-data/exchange-backup-${uid()}.db`;
  let active = new SqliteRepository(path);
  active.seedConfig(starterConfig);
  try {
    const x = new ExchangeService(active, rt, renderer),
      p = await x.prepare(nativeSymbolFile(), "restore.json", "REUSE_EXACT"),
      r = x.commit(p.token, true);
    await active.backup(backup);
    const before = active.getExchangeImport(r.receiptId);
    await restoreWorkspace(active, path, backup, (next) => {
      active = next;
    });
    expect(active.getExchangeImport(r.receiptId)).toEqual(before);
    active.verifyAll();
    active.sqlite.exec(
      "DROP TRIGGER immutable_library_exchange_imports_update",
    );
    expect(() => active.verifyAll()).toThrow(/protection/);
  } finally {
    if (active.sqlite.open) active.close();
  }
});
it("upgrades schema 007 without altering staged library bytes or earlier migration checksums", () => {
  mkdirSync(".test-data", { recursive: true });
  const path = `.test-data/exchange-upgrade-${uid()}.db`;
  copyFileSync("tests/fixtures/milestone5-0.5.0.db", path);
  const db = new Database(path),
    sql = readFileSync("src/persistence/migrations/007.sql", "utf8"),
    s = newSavedSymbol("Existing staged symbol", uid, rt.now());
  db.exec(sql);
  db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
    7,
    hashBytes(sql),
  );
  db.prepare("INSERT INTO saved_symbol_families VALUES(?,?)").run(
    s.familyId,
    s.createdAt,
  );
  db.prepare("INSERT INTO saved_symbol_versions VALUES(?,?,?,?,?,?)").run(
    s.versionId,
    s.familyId,
    s.contentVersion,
    s.status,
    JSON.stringify(s),
    hashBytes(canonical(s)),
  );
  const before = db.prepare("SELECT * FROM saved_symbol_versions").all(),
    migrations = db
      .prepare("SELECT * FROM schema_migrations ORDER BY version")
      .all();
  db.close();
  const upgraded = new SqliteRepository(path, true);
  try {
    expect(
      upgraded.sqlite.prepare("SELECT * FROM saved_symbol_versions").all(),
    ).toEqual(before);
    expect(
      upgraded.sqlite
        .prepare(
          "SELECT * FROM schema_migrations WHERE version<=7 ORDER BY version",
        )
        .all(),
    ).toEqual(migrations);
    expect(upgraded.getSymbol(s.versionId)).toEqual(s);
    upgraded.verifyAll();
  } finally {
    upgraded.close();
  }
});
it("cancels in-flight render validation without leaving a committable preview", async () => {
  const controller = new AbortController(),
    x = new ExchangeService(repo, rt, {
      render: async () => {
        controller.abort();
        throw Error("Worker cancelled");
      },
    });
  await expect(
    x.prepare(
      nativeSymbolFile(),
      "cancel.json",
      "REUSE_EXACT",
      controller.signal,
    ),
  ).rejects.toThrow(/cancelled/);
  expect(count("library_exchange_imports")).toBe(0);
});
it("detects native dependency cycles before recursive rendering", () => {
  const s = newSavedSymbol("Cycle fixture", uid, rt.now());
  s.status = "PUBLISHED";
  s.publishedAt = rt.now();
  const ref = {
    familyId: s.familyId,
    versionId: s.versionId,
    contentHash: "0".repeat(64),
  };
  s.definition.origin = { kind: "SAVED_SYMBOL", source: ref };
  expect(() =>
    assertNativeExchange(
      {
        format: "ORDO_LIBRARY_EXCHANGE",
        schemaVersion: 1,
        dependencyScope: "COMPOSITION_PINS_AND_SYMBOL_ORIGINS",
        root: { kind: "SYMBOL", value: s },
        rootHash: ref.contentHash,
        dependencies: [{ kind: "SYMBOL", ref, document: s }],
        contentHash: ref.contentHash,
      },
      () => ref.contentHash,
    ),
  ).toThrow(/cycle/);
});
