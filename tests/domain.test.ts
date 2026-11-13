import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import {
  doctrineSchema,
  type Operation,
  type ExportProfile,
} from "../src/domain/model";
import { assertOperation, eventTime } from "../src/domain/invariants";
import { createExportProfile } from "../src/domain/factories";
import { project, exportStaleness } from "../src/export/projection";
import { renderHtml } from "../src/export/html";
import { validate } from "../src/validation/engine";

let repo: SqliteRepository,
  service: OrdoService,
  operation: Operation,
  card: ExportProfile;
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 1, 14, 0, tick++)).toISOString();
  service = new OrdoService(
    repo,
    { id: randomUUID, now, actor: "Test planner" },
    () => demoOperation(starterConfig, randomUUID, now()),
  );
  const state = service.execute({
    type: "create",
    name: "DEMO OPERATION",
    demo: true,
  });
  operation = state.operation!;
  card = state.profiles.find((p) => p.product === "communications-card")!;
});
afterEach(() => repo.close());
function save(op: Operation = operation) {
  return service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  });
}
function generate(profile = card, publicationId: string | null = null) {
  return service.execute({
    type: "generate",
    operationId: operation.id,
    expectedRevision: repo.getOperation(operation.id).revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId,
  }).exports[0];
}
function approve() {
  const op = repo.getOperation(operation.id);
  op.units.forEach((u) => {
    u.inTaskOrganization = true;
  });
  op.metadata.statusId = "approved";
  operation = save(op).operation!;
  service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: operation.revision,
    note: "Reviewed demo",
  });
  return service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: operation.revision,
  }).publications[0];
}

describe("domain and configuration boundaries", () => {
  it("validates a doctrine schema and rejects unknown keys, duplicate definitions, and dangling owners", () => {
    expect(() =>
      doctrineSchema.parse({ ...starterConfig.doctrine, arbitrary: true }),
    ).toThrow();
    expect(() =>
      doctrineSchema.parse({
        ...starterConfig.doctrine,
        paragraphs: [
          ...starterConfig.doctrine.paragraphs,
          starterConfig.doctrine.paragraphs[0],
        ],
      }),
    ).toThrow();
    expect(() =>
      doctrineSchema.parse({
        ...starterConfig.doctrine,
        annexCatalog: [
          { ...starterConfig.doctrine.annexCatalog[0], ownerId: "missing" },
        ],
      }),
    ).toThrow();
  });
  it("accepts catalog extensions beyond H without changing source code", () => {
    expect(
      doctrineSchema.parse({
        ...starterConfig.doctrine,
        annexCatalog: [
          ...starterConfig.doctrine.annexCatalog,
          {
            id: randomUUID(),
            code: "Z-EXT",
            title: "Supplied extension",
            editor: "narrative",
            ownerId: null,
          },
        ],
      }).annexCatalog,
    ).toHaveLength(5);
  });
  it("keeps profile versions immutable and operations pinned when a new version appears", () => {
    const next = structuredClone(starterConfig);
    next.doctrine.version = 2;
    next.doctrine.name = "Renamed version";
    repo.seedConfig(next);
    expect(repo.getConfig(operation).doctrine.version).toBe(1);
    expect(() =>
      repo.seedConfig({
        ...starterConfig,
        doctrine: { ...starterConfig.doctrine, name: "Overwrite" },
      }),
    ).toThrow(/overwritten/);
  });
  it("preserves stable IDs and references after names change", () => {
    const oldId = operation.units[0].id;
    operation.units[0].name = "Renamed unit";
    operation.phases[0].name = "Renamed phase";
    const saved = save().operation!;
    expect(saved.units[0].id).toBe(oldId);
    expect(saved.tasks[0].unitId).toBe(oldId);
    expect(
      project(saved, card, starterConfig).view.sections.find(
        (s) => s.title === "Radio nets",
      )?.rows?.[0].Participants,
    ).toBe("Renamed unit");
  });
  it("enforces every level of the attachment hierarchy and sibling codes", () => {
    expect(assertOperation(operation, starterConfig).attachments).toHaveLength(
      7,
    );
    const bad = structuredClone(operation);
    bad.attachments.find((a) => a.kind === "exhibit")!.parentId = bad.orderId;
    expect(() => assertOperation(bad, starterConfig)).toThrow(
      /exhibit must belong to a tab/,
    );
    bad.attachments = operation.attachments.map((a) => ({ ...a }));
    bad.attachments[1].code = bad.attachments[0].code;
    expect(() => assertOperation(bad, starterConfig)).toThrow(
      /unique among siblings/,
    );
  });
  it("rejects dangling references and unit or event cycles", () => {
    operation.tasks[0].unitId = randomUUID();
    expect(() => save()).toThrow(/Unknown task unit/);
    operation = repo.getOperation(operation.id);
    operation.units[0].parentUnitId = operation.units[0].id;
    expect(() => save()).toThrow(/cycle/);
    operation = repo.getOperation(operation.id);
    operation.events[0].at = null;
    operation.events[0].relativeToEventId = operation.events[1].id;
    expect(() => save()).toThrow(/cycle/);
  });
  it("resolves shared H-hour offsets from the authoritative event", () => {
    expect(eventTime(operation, operation.events[1].id)).toBe(
      "2026-10-01T15:00:00.000Z",
    );
    operation.events[0].at = "2026-10-01T16:00:00.000Z";
    expect(eventTime(operation, operation.events[1].id)).toBe(
      "2026-10-01T17:00:00.000Z",
    );
  });
  it("reports explainable cross-object findings without changing plans", () => {
    const before = JSON.stringify(operation);
    const findings = validate(operation, starterConfig);
    expect(
      findings.some(
        (f) => f.ruleId === "net-task-organization" && f.severity === "error",
      ),
    ).toBe(true);
    expect(JSON.stringify(operation)).toBe(before);
    operation.tasks[0].purpose = "";
    operation.tasks[0].unitId = randomUUID();
    expect(validate(operation, starterConfig).map((f) => f.ruleId)).toEqual(
      expect.arrayContaining(["task-purpose", "task-unit"]),
    );
  });
});
describe("transactions and historical integrity", () => {
  it("rejects empty or unrelated files as workspace backups", () => {
    const folder = join(process.cwd(), ".test-data");
    mkdirSync(folder, { recursive: true });
    const path = join(folder, `${randomUUID()}.db`);
    writeFileSync(path, "");
    expect(() => new SqliteRepository(path, true)).toThrow(/not an Ordo/);
  });
  it("stores complete immutable revisions and detects stale writes", () => {
    const previous = structuredClone(operation);
    operation.name = "Renamed operation";
    const saved = save().operation!;
    expect(saved.revision).toBe(2);
    expect(repo.getOperation(operation.id, 1).name).toBe("DEMO OPERATION");
    expect(() => save(previous)).toThrow(/changed/);
    expect(() =>
      repo.sqlite
        .prepare("UPDATE operation_revisions SET actor=?")
        .run("Other"),
    ).toThrow(/immutable/);
    repo.verifyAll();
  });
  it("rejects cross-operation references at the database boundary", () => {
    const other = service.execute({
      type: "create",
      name: "Other operation",
      demo: true,
    }).operation!;
    expect(() =>
      repo.sqlite
        .prepare("UPDATE tasks SET unit_id=? WHERE id=?")
        .run(other.units[0].id, operation.tasks[0].id),
    ).toThrow(/FOREIGN KEY/);
  });
  it("rolls back failed operation changes completely", () => {
    const before = repo.getOperation(operation.id);
    operation.tasks[0].unitId = randomUUID();
    expect(() => save()).toThrow();
    expect(repo.getOperation(operation.id)).toEqual(before);
    expect(
      repo.sqlite
        .prepare("SELECT count(*) AS n FROM operation_revisions")
        .get(),
    ).toEqual({ n: 1 });
  });
  it("requires review status and resolves errors before publishing", () => {
    expect(() =>
      service.execute({
        type: "publish",
        operationId: operation.id,
        expectedRevision: 1,
      }),
    ).toThrow(/Approve/);
    operation.metadata.statusId = "approved";
    operation = save().operation!;
    expect(() =>
      service.execute({
        type: "publish",
        operationId: operation.id,
        expectedRevision: operation.revision,
      }),
    ).toThrow(/validation errors/);
  });
  it("freezes publications, invalidates approval on edits, and records supersession separately", () => {
    const first = approve(),
      oldChannel = first.snapshot.signal.nets[0].channel;
    operation = repo.getOperation(operation.id);
    operation.signal.nets[0].channel = "DEMO UPDATED";
    operation = save().operation!;
    expect(operation.metadata.statusId).toBe("draft");
    expect(
      repo.listPublications(operation.id)[0].snapshot.signal.nets[0].channel,
    ).toBe(oldChannel);
    expect(() =>
      repo.sqlite.prepare("DELETE FROM publications WHERE id=?").run(first.id),
    ).toThrow(/immutable/);
    const second = approve();
    expect(second.supersedesId).toBe(first.id);
    expect(second.version).toBe(2);
    expect(
      repo.listPublications(operation.id).find((p) => p.id === first.id),
    ).toEqual(first);
    repo.verifyAll();
  });
  it("backs up, verifies, and reopens a full workspace with history and profiles", async () => {
    approve();
    generate();
    const folder = join(process.cwd(), ".test-data");
    mkdirSync(folder, { recursive: true });
    const path = join(folder, `${randomUUID()}.db`);
    await repo.backup(path);
    const restored = new SqliteRepository(path);
    try {
      restored.verifyAll();
      expect(restored.getOperation(operation.id)).toEqual(
        repo.getOperation(operation.id),
      );
      expect(restored.listExports(operation.id)).toHaveLength(1);
      expect(restored.listPublications(operation.id)).toHaveLength(1);
    } finally {
      restored.close();
    }
  });
});
describe("export profiles, selection and source tracking", () => {
  it("derives full OPORD and card from the same Signal value", () => {
    operation.signal.nets[0].channel = "DEMO SHARED";
    const full = createExportProfile(operation, "opord", randomUUID());
    expect(
      JSON.stringify(project(operation, full, starterConfig).view),
    ).toContain("DEMO SHARED");
    expect(
      JSON.stringify(project(operation, card, starterConfig).view),
    ).toContain("DEMO SHARED");
    expect(
      JSON.stringify(project(operation, card, starterConfig).view),
    ).not.toContain(operation.signal.architecture);
  });
  it("filters audience and phase before rendering and honors excluded fields", () => {
    card.inclusion.audienceUnitIds = [operation.units[0].id];
    card.inclusion.phaseIds = [operation.phases[0].id];
    card.inclusion.netFields = ["system"];
    card.inclusion.includePace = false;
    card.inclusion.includeLostCommunications = false;
    const text = JSON.stringify(project(operation, card, starterConfig).view);
    expect(text).toContain("DEMO CMD NET 1");
    expect(text).not.toContain("DEMO SUPPORT NET");
    expect(text).not.toContain("DEMO CHANNEL 01");
    expect(text).not.toContain("DEMO PRIMARY");
    expect(text).not.toContain("DEMO instruction");
  });
  it("permits including lost communications without exporting PACE methods", () => {
    card.inclusion.includePace = false;
    const text = JSON.stringify(project(operation, card, starterConfig).view);
    expect(text).toContain("DEMO instruction");
    expect(text).not.toContain("DEMO PRIMARY");
  });
  it("records exact export profile versions and never overwrites generated artifacts", () => {
    const first = generate();
    card.inclusion.netFields = ["system"];
    const next = service
      .execute({ type: "save-profile", profile: card, isNew: false })
      .profiles.find((p) => p.id === card.id)!;
    expect(next.version).toBe(2);
    expect(repo.getExportProfile(card.id, 1).inclusion.netFields).toContain(
      "channel",
    );
    expect(first.profile.version).toBe(1);
    expect(repo.listExports(operation.id)[0].html).toContain("DEMO CHANNEL 01");
    expect(generate(next).html).not.toContain("DEMO CHANNEL 01");
    expect(() => repo.sqlite.prepare("DELETE FROM exports").run()).toThrow(
      /immutable/,
    );
    expect(() =>
      repo.sqlite
        .prepare("UPDATE export_profile_versions SET version=10")
        .run(),
    ).toThrow(/immutable/);
  });
  it("ignores excluded changes and detects changes in selected source values", () => {
    const record = generate();
    operation.signal.architecture = "Changed excluded detail";
    operation.signal.maintenanceNotes = "Different note";
    expect(exportStaleness(record, operation).outdated).toBe(false);
    operation.signal.nets[0].channel = "DEMO CHANGED";
    expect(exportStaleness(record, operation).changedPaths).toContain(
      `nets/${operation.signal.nets[0].id}/channel`,
    );
  });
  it("detects newly matching nets even if their IDs did not exist at generation time", () => {
    const record = generate();
    operation.signal.nets.push({
      ...structuredClone(operation.signal.nets[0]),
      id: randomUUID(),
      name: "New matching net",
    });
    expect(exportStaleness(record, operation).changedPaths).toContain(
      "selection/radio-nets",
    );
  });
  it("uses the frozen publication source and identifies its supersession", () => {
    const pub = approve();
    const record = generate(card, pub.id);
    operation = repo.getOperation(operation.id);
    operation.signal.nets[0].channel = "DEMO NEW";
    operation = save().operation!;
    const after = generate(card, pub.id);
    expect(after.html).toContain("DEMO CHANNEL 01");
    expect(after.html).not.toContain("DEMO NEW");
    expect(after.dependencies).toEqual(record.dependencies);
    expect(service.load(operation.id).exports[0].staleness.outdated).toBe(true);
    approve();
    expect(
      service.load(operation.id).exports.every((e) => e.supersededSource),
    ).toBe(true);
  });
  it("rejects foreign operation profiles and unresolved selections", () => {
    expect(() =>
      project(operation, { ...card, operationId: randomUUID() }, starterConfig),
    ).toThrow(/another operation/);
    expect(() =>
      project(
        operation,
        { ...card, inclusion: { ...card.inclusion, netIds: [randomUUID()] } },
        starterConfig,
      ),
    ).toThrow(/missing net/);
  });
  it("escapes user-authored HTML and produces a script-free document", () => {
    operation.signal.nets[0].name = "<script>alert(1)</script>";
    const html = renderHtml(
      project(operation, card, starterConfig).view,
      "<unsafe>",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;unsafe&gt;");
  });
});
