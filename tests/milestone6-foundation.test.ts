import { afterEach, beforeEach, it, expect } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { SqliteRepository } from "../src/persistence/repository";
import { SymbologyService } from "../src/application/symbology-service";
import { WorkspaceService } from "../src/application/workspace-service";
import { OrdoService } from "../src/application/service";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import {
  militarySymbolDefinitionSchema,
  newSymbolDefinition,
  resolveSymbol,
  type SavedSymbolVersion,
} from "../src/domain/symbology";
import {
  savedOrbatVersionSchema,
  type SavedOrbatVersion,
} from "../src/domain/orbat";
import { unitProfileSchema } from "../src/domain/unit-profiles";
import { hashBytes } from "../src/persistence/modular-store";
import { canonical } from "../src/export/projection";
import {
  addOrbatNode,
  deleteOrbatNode,
  reparentOrbatNode,
  changeOrbatLayout,
} from "../src/domain/orbat-actions";
import {
  changeOperationLayout,
  operationLayout,
  reparentOperationUnit,
  deleteOperationUnit,
} from "../src/domain/organization-actions";
let repo: SqliteRepository,
  lib: SymbologyService,
  ws: WorkspaceService,
  svc: OrdoService,
  tick = 0;
const rt = {
  id: uid,
  now: () => new Date(Date.UTC(2026, 9, 3, 1, 0, tick++)).toISOString(),
  actor: "Fictional M6 tester",
};
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  lib = new SymbologyService(repo, rt);
  ws = new WorkspaceService(repo, rt);
  svc = new OrdoService(repo, rt, (_n, c) => demoOperation(c, uid, rt.now()));
});
afterEach(() => {
  if (repo.sqlite.open) repo.close();
});
const symbol = () =>
  lib.execute({ type: "new", kind: "SYMBOL", name: "Fictional infantry" })
    .symbol!;
const publish = (v: SavedSymbolVersion) =>
  lib.execute({
    type: "publish",
    kind: "SYMBOL",
    id: v.versionId,
    expected: v.contentVersion,
  }).symbol!;
function profile() {
  const s = publish(symbol());
  let p = ws.execute({
    type: "unit-profile-new",
    name: "Fictional organization",
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
  return ws.execute({
    type: "unit-profile-publish",
    id: p.unitProfileVersionId,
    expectedContentVersion: p.contentVersion,
  }).profile!;
}
function orbat() {
  const p = profile();
  let o = lib.execute({
    type: "orbat-from-profile",
    id: p.unitProfileVersionId,
    name: "Fictional ORBAT",
  }).orbat!;
  const child = structuredClone(o.nodes[0]);
  child.nodeId = uid();
  child.parentNodeId = o.rootNodeId;
  o.nodes.push(child);
  o = lib.execute({
    type: "save-orbat",
    value: o,
    expected: o.contentVersion,
  }).orbat!;
  return lib.execute({
    type: "publish",
    kind: "ORBAT",
    id: o.versionId,
    expected: o.contentVersion,
  }).orbat!;
}
const operation = () =>
  svc.execute({ type: "create", name: "Fictional operation", demo: false })
    .operation!;
it("preserves protected implementations and migrations byte for byte", () => {
  const hashes = JSON.parse(
    readFileSync(
      "tests/fixtures/milestone6-frozen-implementations.json",
      "utf8",
    ),
  );
  for (const [p, h] of Object.entries(hashes))
    expect(hashBytes(readFileSync(p))).toBe(h);
});
it("migrates a genuine M5 database without rewriting historical rows", () => {
  const dest = `.test-data/m6-predecessor-${uid()}.db`;
  mkdirSync(".test-data", { recursive: true });
  copyFileSync("tests/fixtures/milestone5-0.5.0.db", dest);
  const r = new SqliteRepository(dest, true);
  try {
    const f = JSON.parse(
      readFileSync("tests/fixtures/milestone6-predecessor-hashes.json", "utf8"),
    );
    for (const [table, s] of Object.entries(f.frozen) as [
      string,
      { count: number; hash: string },
    ][]) {
      const rows = r.sqlite
        .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
        .all();
      expect(rows).toHaveLength(s.count);
      expect(hashBytes(canonical(rows))).toBe(s.hash);
    }
    r.verifyAll();
    expect(
      r.sqlite
        .prepare("SELECT max(version) version FROM schema_migrations")
        .get(),
    ).toEqual({ version: 20 });
  } finally {
    r.close();
  }
});
it("rejects arbitrary options, SVG, unsupported code lengths and nonfinite geometry", () => {
  const d = newSymbolDefinition(uid);
  expect(() =>
    militarySymbolDefinitionSchema.parse({ ...d, svg: "<svg/>" }),
  ).toThrow();
  expect(() =>
    militarySymbolDefinitionSchema.parse({
      ...d,
      amplifiers: { ...d.amplifiers, onclick: "alert(1)" },
    }),
  ).toThrow();
  expect(() =>
    militarySymbolDefinitionSchema.parse({
      ...d,
      code: { ...d.code, sidc: "123" },
    }),
  ).toThrow();
  expect(() =>
    militarySymbolDefinitionSchema.parse({
      ...d,
      appearance: { ...d.appearance, strokeWidth: Infinity },
    }),
  ).toThrow();
});
it("creates independent family, version and definition identifiers", () => {
  const a = symbol(),
    b = symbol();
  expect(
    new Set([
      a.familyId,
      a.versionId,
      a.definition.definitionId,
      b.familyId,
      b.versionId,
      b.definition.definitionId,
    ]).size,
  ).toBe(6);
});
it("guards concurrent Draft saves and rejects published mutation at SQL boundary", () => {
  let s = symbol(),
    stale = structuredClone(s);
  s.name = "Renamed";
  s = lib.execute({
    type: "save-symbol",
    value: s,
    expected: s.contentVersion,
  }).symbol!;
  expect(() =>
    lib.execute({
      type: "save-symbol",
      value: stale,
      expected: stale.contentVersion,
    }),
  ).toThrow(/changed/);
  s = publish(s);
  expect(() =>
    repo.sqlite
      .prepare(
        "UPDATE saved_symbol_versions SET content_version=content_version+1,document=json_set(document,'$.contentVersion',content_version+1,'$.name','Changed') WHERE id=?",
      )
      .run(s.versionId),
  ).toThrow(/immutable/);
  expect(() =>
    repo.sqlite
      .prepare("DELETE FROM saved_symbol_versions WHERE id=?")
      .run(s.versionId),
  ).toThrow(/retained/);
});
it("retirement preserves published content hash and exact pins", () => {
  const s = publish(symbol()),
    pin = repo.resolveSymbolPin(s.versionId),
    hash = repo.libraryHash("SYMBOL", s.versionId);
  lib.execute({ type: "retire", kind: "SYMBOL", id: s.versionId });
  expect(repo.getSymbol(s.versionId).status).toBe("RETIRED");
  expect(repo.libraryHash("SYMBOL", s.versionId)).toBe(hash);
  expect(repo.resolveSymbolPin(s.versionId)).toEqual(pin);
  repo.verifyAll();
});
it("profile v1 does not acquire defaults; v2 validates its exact snapshot", () => {
  const p = ws.execute({ type: "unit-profile-new", name: "Legacy" }).profile!;
  expect(unitProfileSchema.parse(p)).toEqual(p);
  expect(p).not.toHaveProperty("defaultSymbol");
  const s = publish(symbol()),
    pin = repo.resolveSymbolPin(s.versionId);
  pin.definition.code.sidc = "130610000012110000000000000000";
  expect(() =>
    ws.execute({
      type: "unit-profile-save",
      profile: { ...p, schemaVersion: 2, defaultSymbol: pin },
      expectedContentVersion: p.contentVersion,
    }),
  ).toThrow(/snapshot/);
});
it("inherits operation snapshots and resolves bound labels without mutating source", () => {
  const p = profile(),
    op = operation(),
    n = ws.execute({
      type: "unit-profile-instantiate",
      operation: op,
      unitProfileVersionId: p.unitProfileVersionId,
      subtree: false,
      confirmDuplicate: false,
      importId: uid(),
    }).operation!;
  expect(n.units[0].symbol).toBeDefined();
  const state = n.units[0].symbol!,
    before = canonical(state);
  expect(
    resolveSymbol(state, "Renamed canonical unit", null).amplifiers
      .uniqueDesignation,
  ).toBe("Renamed canonical unit");
  expect(canonical(state)).toBe(before);
  state.override = { definition: newSymbolDefinition(uid), source: null };
  state.override.definition.code.sidc = "130610000012110000000000000000";
  expect(resolveSymbol(state, "Name", null).code.sidc).toBe(
    state.override.definition.code.sidc,
  );
  state.override = null;
  expect(resolveSymbol(state, "Name", null).code).toEqual(
    state.base.definition.code,
  );
});
it("checks ORBAT cycles, dangling references, duplicate node IDs and layout keys", () => {
  const o = orbat();
  const mutate = (f: (v: SavedOrbatVersion) => void) => {
    const n = structuredClone(o);
    f(n);
    return () => savedOrbatVersionSchema.parse(n);
  };
  expect(
    mutate((n) => (n.nodes[0].parentNodeId = n.nodes[1].nodeId)),
  ).toThrow();
  expect(mutate((n) => (n.nodes[1].parentNodeId = uid()))).toThrow();
  expect(mutate((n) => (n.nodes[1].nodeId = n.nodes[0].nodeId))).toThrow();
  expect(mutate((n) => (n.layout.siblingOrder = [uid()]))).toThrow();
});
it("permits repeated profile references but instantiates each explicit node once", () => {
  const o = orbat(),
    op = operation();
  const result = lib.execute({
    type: "import-orbat",
    operationId: op.id,
    expectedRevision: op.revision,
    orbatVersionId: o.versionId,
    importId: uid(),
    parentUnitId: null,
    confirmDuplicate: false,
    replaceLayout: false,
  });
  expect(result.operation!.units).toHaveLength(2);
  expect(new Set(result.operation!.units.map((u) => u.id)).size).toBe(2);
  const root = result.receipt!.nodeMap.find((n) => n.nodeId === o.rootNodeId)!;
  expect(
    result.operation!.units.find((u) => u.id !== root.unitId)!.parentUnitId,
  ).toBe(root.unitId);
  expect(result.operation!.revision).toBe(op.revision + 1);
  repo.verifyAll();
});
it("retains import idempotency after all imported units are deleted", () => {
  const o = orbat(),
    op = operation(),
    command = {
      type: "import-orbat" as const,
      operationId: op.id,
      expectedRevision: op.revision,
      orbatVersionId: o.versionId,
      importId: uid(),
      parentUnitId: null,
      confirmDuplicate: false,
      replaceLayout: false,
    };
  const first = lib.execute(command),
    changed = first.operation!;
  changed.units = [];
  changed.orbatLayout!.hints = [];
  changed.orbatLayout!.siblingOrder = [];
  const saved = svc.execute({
    type: "save",
    operation: changed,
    expectedRevision: changed.revision,
  }).operation!;
  const retry = lib.execute({ ...command, expectedRevision: saved.revision });
  expect(retry.receipt).toEqual(first.receipt);
  expect(retry.operation!.units).toHaveLength(0);
  expect(() => lib.execute({ ...command, replaceLayout: true })).toThrow(
    /different request/,
  );
  repo.verifyAll();
});
it("rolls back failed import without units, revision or receipt", () => {
  const o = orbat(),
    op = operation(),
    importId = uid();
  repo.sqlite.exec(
    "CREATE TRIGGER test_receipt_failure BEFORE INSERT ON operation_orbat_imports BEGIN SELECT RAISE(ABORT,'Injected failure'); END;",
  );
  expect(() =>
    lib.execute({
      type: "import-orbat",
      operationId: op.id,
      expectedRevision: op.revision,
      orbatVersionId: o.versionId,
      importId,
      parentUnitId: null,
      confirmDuplicate: false,
      replaceLayout: false,
    }),
  ).toThrow(/Injected/);
  expect(repo.getOperation(op.id)).toEqual(op);
  expect(repo.getOrbatImport(op.id, importId)).toBeNull();
});
it("library duplication remaps owned identities and preserves profile pins", () => {
  const o = orbat(),
    d = lib.execute({
      type: "derive",
      kind: "ORBAT",
      id: o.versionId,
      versionLabel: "1.0.0",
      newFamily: true,
    }).orbat!;
  expect(d.familyId).not.toBe(o.familyId);
  expect(
    d.nodes.some((n) => o.nodes.some((old) => old.nodeId === n.nodeId)),
  ).toBe(false);
  expect(d.nodes[0].unit).toEqual(o.nodes[0].unit);
  savedOrbatVersionSchema.parse(d);
  repo.verifyAll();
});
it("restore verification detects weakened triggers and tampered pin snapshots", () => {
  const p = profile();
  repo.sqlite.exec(
    "DROP TRIGGER saved_symbol_frozen_update; CREATE TRIGGER saved_symbol_frozen_update BEFORE UPDATE ON saved_symbol_versions BEGIN SELECT 1; END;",
  );
  expect(() => repo.verifyAll()).toThrow(/protection/);
  expect(p.schemaVersion).toBe(2);
});
it("never creates a second operational organization hierarchy", () => {
  expect(
    repo.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='operation_orbat_nodes'",
      )
      .get(),
  ).toBeUndefined();
});
it("adds deliberate repeated profile instances with verified exact pins", () => {
  const p = profile(),
    draft = lib.execute({
      type: "new",
      kind: "ORBAT",
      name: "Repeated profiles",
    }).orbat!;
  const first = lib.execute({
    type: "profile-node",
    id: p.unitProfileVersionId,
    parentNodeId: draft.rootNodeId,
  }).node!;
  const second = lib.execute({
    type: "profile-node",
    id: p.unitProfileVersionId,
    parentNodeId: draft.rootNodeId,
  }).node!;
  expect(first.nodeId).not.toBe(second.nodeId);
  const next = addOrbatNode(addOrbatNode(draft, first), second);
  lib.execute({
    type: "save-orbat",
    value: next,
    expected: draft.contentVersion,
  });
  expect(repo.getOrbat(draft.versionId).nodes).toHaveLength(3);
  repo.verifyAll();
});
it("reparents composition nodes without replacing the occupied parent or descendants", () => {
  const published = orbat(),
    draft = lib.execute({
      type: "derive",
      kind: "ORBAT",
      id: published.versionId,
      versionLabel: "1.0.1",
      newFamily: false,
    }).orbat!;
  const a = draft.nodes[1],
    b = { ...structuredClone(a), nodeId: uid(), parentNodeId: a.nodeId };
  const withChild = addOrbatNode(draft, b),
    moved = reparentOrbatNode(withChild, b.nodeId, draft.rootNodeId);
  expect(moved.nodes.map((n) => n.nodeId)).toEqual(
    withChild.nodes.map((n) => n.nodeId),
  );
  expect(moved.nodes[1]).toEqual(withChild.nodes[1]);
  expect(moved.nodes[2].parentNodeId).toBe(draft.rootNodeId);
  expect(withChild.nodes[2].parentNodeId).toBe(a.nodeId);
  expect(() => reparentOrbatNode(withChild, a.nodeId, b.nodeId)).toThrow(
    /cycle/,
  );
  expect(() =>
    reparentOrbatNode(withChild, draft.rootNodeId, b.nodeId),
  ).toThrow(/root/);
  expect(() => reparentOrbatNode(withChild, b.nodeId, uid())).toThrow(/parent/);
});
it("changes only presentation state when moving an ORBAT node and rejects nonfinite positions", () => {
  const p = orbat(),
    draft = lib.execute({
      type: "derive",
      kind: "ORBAT",
      id: p.versionId,
      versionLabel: "1.0.1",
      newFamily: false,
    }).orbat!;
  const layout = {
    ...draft.layout,
    hints: [
      {
        nodeId: draft.rootNodeId,
        offset: { x: 40, y: -10 },
        folded: true,
        hqStaff: false,
      },
    ],
  };
  const next = changeOrbatLayout(draft, layout);
  expect(next.nodes).toEqual(draft.nodes);
  expect(draft.layout.hints).toHaveLength(0);
  expect(() =>
    changeOrbatLayout(draft, {
      ...layout,
      hints: [{ ...layout.hints[0], offset: { x: Infinity, y: 0 } }],
    }),
  ).toThrow();
  expect(() => changeOrbatLayout(p, layout)).toThrow(/immutable/);
});
it("deletes only leaf composition nodes and removes their layout hints", () => {
  const p = orbat(),
    draft = lib.execute({
      type: "derive",
      kind: "ORBAT",
      id: p.versionId,
      versionLabel: "1.0.1",
      newFamily: false,
    }).orbat!;
  const id = draft.nodes[1].nodeId;
  draft.layout.hints.push({
    nodeId: id,
    offset: null,
    folded: false,
    hqStaff: false,
  });
  draft.layout.siblingOrder.push(id);
  expect(() => deleteOrbatNode(draft, draft.rootNodeId)).toThrow(/root/);
  const next = deleteOrbatNode(draft, id);
  expect(next.nodes).toHaveLength(1);
  expect(next.layout.hints).toEqual([]);
  expect(next.layout.siblingOrder).toEqual([]);
  expect(draft.nodes).toHaveLength(2);
});
it("uses canonical operation parents for both views while layout movement preserves units", () => {
  let op = operation();
  const saved = orbat();
  op = lib.execute({
    type: "import-orbat",
    operationId: op.id,
    expectedRevision: op.revision,
    orbatVersionId: saved.versionId,
    importId: uid(),
    parentUnitId: null,
    confirmDuplicate: false,
    replaceLayout: false,
  }).operation!;
  const [root, child] = op.units;
  expect(() => reparentOperationUnit(op, root.id, child.id)).toThrow(/cycle/);
  const next = changeOperationLayout(op, {
    ...operationLayout(op),
    mode: "SIMPLE",
    hints: [
      {
        nodeId: child.id,
        offset: { x: 20, y: 0 },
        folded: false,
        hqStaff: false,
      },
    ],
  });
  expect(next.units).toEqual(op.units);
  const detached = reparentOperationUnit(next, child.id, null);
  expect(detached.units[1].parentUnitId).toBeNull();
  expect(detached.orbatLayout).toEqual(next.orbatLayout);
  expect(() => deleteOperationUnit(op, root.id, repo.getConfig(op))).toThrow(
    /children/,
  );
  const deleted = deleteOperationUnit(next, child.id, repo.getConfig(op));
  expect(deleted.units).toHaveLength(1);
  expect(deleted.orbatLayout!.hints).toEqual([]);
});
