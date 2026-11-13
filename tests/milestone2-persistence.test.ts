import { it, expect } from "vitest";
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepository } from "../src/persistence/repository";
import { restoreWorkspace } from "../src/persistence/restore";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import {
  instantiateProduct,
  emptyContent,
  setApplicability,
} from "../src/domain/authoring";
import { canonical, project } from "../src/export/projection";
import { createExportProfile } from "../src/domain/factories";
const now = () => new Date().toISOString();
const makeService = (r: SqliteRepository) =>
  new OrdoService(
    r,
    { id: randomUUID, now, actor: "Acceptance planner" },
    (_name, config) => demoOperation(config, randomUUID, now()),
  );
const folder = () => {
  const path = join(".test-data", `m2-integrity-${randomUUID()}`);
  mkdirSync(path, { recursive: true });
  return path;
};

it("keeps original M1 migrations and projection implementations byte-for-byte", () => {
  const hashes: Record<string, string> = {
    "src/persistence/migrations/001.sql":
      "430687e11d8195831f617ae90a446dd4d3877746b05dc450ffd1ac98e01bab5b",
    "src/persistence/migrations/002.sql":
      "1e10f49f452da5c0bed9d1ddbb44468945dbbfea95a80e8f4a64585c5bc96996",
    "src/export/projections/v1.ts":
      "b124aff2e2b7b200bd0a9df946d2bdf00ca213d0f01461f197bc528751789c07",
    "src/export/projections/v2.ts":
      "bdcc423df3f5e4fe666e8f443183c2859c74ad906072477fd4c904b366a8942b",
  };
  for (const [path, hash] of Object.entries(hashes))
    expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(
      hash,
    );
});

it("upgrades an actual schema-002 workspace without rewriting old profile, revision, publication or export documents", () => {
  const source = new SqliteRepository(":memory:");
  source.seedConfig(starterConfig);
  const service = makeService(source);
  let state = service.execute({
    type: "create",
    name: "M1 EXISTING OPERATION",
    demo: true,
  });
  const op = state.operation!;
  op.units.forEach((u) => (u.inTaskOrganization = true));
  op.metadata.statusId = "approved";
  state = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  });
  service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: state.operation!.revision,
    note: "Existing M1 approval",
  });
  state = service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: state.operation!.revision,
  });
  const profile = state.profiles.find((p) => p.product === "opord")!;
  state = service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: state.operation!.revision,
    profileRef: { id: profile.id, version: 1 },
    publicationId: state.publications[0].id,
  });
  const path = join(folder(), "milestone1.db"),
    raw = new Database(path);
  const migration1 = readFileSync("src/persistence/migrations/001.sql", "utf8"),
    migration2 = readFileSync("src/persistence/migrations/002.sql", "utf8");
  raw.exec(migration1);
  raw.exec(migration2);
  raw.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
  );
  raw.pragma("application_id = 1330791503");
  for (const [i, sql] of [migration1, migration2].entries())
    raw
      .prepare("INSERT INTO schema_migrations VALUES(?,?)")
      .run(i + 1, createHash("sha256").update(sql).digest("hex"));
  const copyTables = [
    "profile_versions",
    "operations",
    "operation_revisions",
    "units",
    "phases",
    "objectives",
    "tasks",
    "events",
    "attachments",
    "radio_nets",
    "net_participants",
    "pace_plans",
    "export_profile_versions",
    "revision_approvals",
    "publications",
    "exports",
    "audit_events",
    "preferences",
  ];
  for (const table of copyTables)
    for (const input of source.sqlite
      .prepare(`SELECT * FROM ${table}`)
      .all() as Record<string, unknown>[]) {
      const row = { ...input };
      if (table === "attachments") {
        delete row.doctrine_node_id;
        delete row.applicability;
      }
      const keys = Object.keys(row);
      raw
        .prepare(
          `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
        )
        .run(...Object.values(row));
    }
  const immutable = [
    "profile_versions",
    "operation_revisions",
    "export_profile_versions",
    "publications",
    "exports",
    "audit_events",
    "revision_approvals",
    "publication_approvals",
    "render_template_versions",
    "export_templates",
  ];
  for (const table of immutable)
    for (const action of ["UPDATE", "DELETE"])
      raw.exec(
        `CREATE TRIGGER immutable_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'History is immutable'); END;`,
      );
  const historyTables = [
    "profile_versions",
    "operation_revisions",
    "publications",
    "exports",
  ];
  const before = historyTables.map((table) =>
    raw.prepare(`SELECT * FROM ${table}`).all(),
  );
  raw.close();
  source.close();
  const upgraded = new SqliteRepository(path, true);
  try {
    expect(
      upgraded.sqlite
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
    ]);
    expect(
      historyTables.map((table) =>
        upgraded.sqlite.prepare(`SELECT * FROM ${table}`).all(),
      ),
    ).toEqual(before);
    upgraded.seedConfig(armyConfig);
    expect(upgraded.getConfig(upgraded.getOperation(op.id))).toEqual(
      starterConfig,
    );
    expect(upgraded.listPublications(op.id)).toEqual(state.publications);
    expect(upgraded.listExports(op.id)[0].html).toBe(state.exports[0].html);
    expect(upgraded.listExports(op.id)[0].projectionVersion).toBe(2);
    expect(upgraded.getOperation(op.id).authoring).toBeUndefined();
    upgraded.verifyAll();
  } finally {
    upgraded.close();
  }
});

it("restores a M2 workspace with typed content, applicability, profiles, publication and exact export provenance", async () => {
  const dir = folder(),
    path = join(dir, "active.db"),
    backup = join(dir, "backup.db");
  let repo = new SqliteRepository(path);
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  let service = makeService(repo);
  try {
    let state = service.execute({
        type: "create",
        name: "M2 BACKUP",
        demo: true,
        configuration: { id: armyConfig.organization.id, version: 1 },
      }),
      op = state.operation!;
    const z = armyConfig.doctrine.catalog!.nodes.find(
      (n) => n.stableKey === "Z",
    )!;
    const a = instantiateProduct(op, armyConfig, z.id, randomUUID);
    a.applicability = "INCLUDED";
    a.content = emptyContent(z, randomUUID);
    if (a.content.kind === "distribution")
      a.content.recipients.push({
        id: randomUUID(),
        recipient: "DEMO recipient",
        dutyPosition: "Reviewer",
        unitId: op.units[0].id,
        location: "",
        distributionPurpose: "Review",
        copyNumber: "1",
        method: "Local",
        acknowledgmentRequired: true,
      });
    op.metadata.statusId = "approved";
    state = service.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    op = state.operation!;
    service.execute({
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "Backup test",
    });
    state = service.execute({
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    });
    const p = state.profiles.find((p) => p.product === "opord")!;
    state = service.execute({
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: p.id, version: 1 },
      publicationId: state.publications[0].id,
    });
    const before = canonical(state);
    await repo.backup(backup);
    op = state.operation!;
    op.signal.concept = "Changed after backup";
    service.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    await restoreWorkspace(repo, path, backup, (next) => {
      repo = next;
      service = makeService(repo);
    });
    expect(canonical(service.load(op.id))).toBe(before);
    repo.verifyAll();
    repo.close();
    repo = new SqliteRepository(path, true);
    service = makeService(repo);
    expect(canonical(service.load(op.id))).toBe(before);
  } finally {
    if (repo.sqlite.open) repo.close();
  }
});

it("detects damaged doctrine indexes during restore verification", () => {
  const repo = new SqliteRepository(":memory:");
  repo.seedConfig(armyConfig);
  try {
    const guard = repo.sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE name='immutable_doctrine_nodes_DELETE'",
      )
      .get() as { sql: string };
    repo.sqlite.exec("DROP TRIGGER immutable_doctrine_nodes_DELETE");
    repo.sqlite
      .prepare("DELETE FROM doctrine_nodes WHERE stable_key='A'")
      .run();
    repo.sqlite.exec(guard.sql);
    expect(() => repo.verifyAll()).toThrow(/Doctrine node index/);
  } finally {
    repo.close();
  }
});

it("tracks selected canonical task, purpose and relative event changes without storing copies in authoring", () => {
  const op = demoOperation(armyConfig, randomUUID, now()),
    base = armyConfig.doctrine.catalog!.baseFields;
  const concept = base.find((f) => f.stableKey === "concept")!;
  op.authoring!.fields.push({
    fieldId: concept.id,
    text: "Reference existing facts",
    references: [
      { kind: "phase", id: op.phases[0].id },
      { kind: "task", id: op.tasks[0].id },
      { kind: "event", id: op.events[1].id },
    ],
  });
  const profile = createExportProfile(op, "opord", randomUUID());
  const first = project(op, profile, armyConfig);
  op.tasks[0].purpose = "Changed canonical purpose";
  op.phases[0].name = "Renamed phase";
  op.events[0].at = "2026-10-01T18:00:00.000Z";
  const next = project(op, profile, armyConfig);
  expect(canonical(next.view)).toContain("Changed canonical purpose");
  expect(canonical(next.view)).toContain("Renamed phase");
  expect(canonical(next.view)).toContain("2026-10-01T19:00:00.000Z");
  expect(next.dependencies).not.toEqual(first.dependencies);
  expect(canonical(op.authoring)).not.toContain("Changed canonical purpose");
});

it("gives package selectors deterministic dependencies and respects explicit selection", () => {
  const op = demoOperation(armyConfig, randomUUID, now()),
    nodes = armyConfig.doctrine.catalog!.nodes;
  const b = nodes.find((n) => n.stableKey === "B")!;
  const profile = createExportProfile(op, "opord", randomUUID());
  const first = project(op, profile, armyConfig);
  setApplicability(op, armyConfig, b.id, "INCLUDED", randomUUID);
  const all = project(op, profile, armyConfig);
  expect(
    all.dependencies.find((d) => d.path === "selection/package-products"),
  ).not.toEqual(
    first.dependencies.find((d) => d.path === "selection/package-products"),
  );
  profile.inclusion.packageScope = "selected";
  profile.inclusion.attachmentIds = op.attachments
    .filter((a) => a.code === "A")
    .map((a) => a.id);
  const selected = project(op, profile, armyConfig);
  expect(selected.view.sections.some((s) => s.title.includes("Annex B"))).toBe(
    false,
  );
  expect(selected.view.sections.some((s) => s.title.includes("Annex H"))).toBe(
    false,
  );
  expect(selected.view.sections.some((s) => s.title.includes("Annex A"))).toBe(
    true,
  );
});
