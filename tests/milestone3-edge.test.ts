import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import {
  addOperationModule,
  resetModuleLayout,
  moduleFindings,
} from "../src/domain/module-authoring";
import { newModuleDefinition, type ManagedAsset } from "../src/domain/modules";
import { instantiateProduct, packageRows } from "../src/domain/authoring";
import { createExportProfile } from "../src/domain/factories";
import { renderModule } from "../src/export/module-render";
import { hashBytes } from "../src/persistence/modular-store";
import { canonical } from "../src/export/projection";
const now = "2026-10-03T12:00:00.000Z";
let repo: SqliteRepository, service: OrdoService;
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  service = new OrdoService(
    repo,
    { id: uid, now: () => now, actor: "Test" },
    (_name, config) => demoOperation(config, uid, now),
  );
});
afterEach(() => repo.close());
const create = () =>
  service.execute({
    type: "create",
    name: "Fictional module edge cases",
    demo: true,
    configuration: { id: armyConfig.organization.id, version: 1 },
  }).operation!;
it("keeps the original default configuration after installing a custom profile that sorts first", () => {
  const custom = structuredClone(armyConfig),
    id = "00000000-0000-4000-8000-000000000001";
  custom.doctrine.id = id;
  custom.echelon.id = id;
  custom.organization.id = id;
  custom.organization.doctrineRef.id = id;
  custom.organization.echelonRef.id = id;
  repo.seedConfig(custom);
  expect(repo.getConfig().doctrine.id).toBe(starterConfig.doctrine.id);
  expect(
    service.execute({ type: "create", name: "Default", demo: false }).operation!
      .doctrineRef.id,
  ).toBe(starterConfig.doctrine.id);
});
it("prevents creation against a retired doctrine even through a typed command", () => {
  let state = service.execute({
    type: "doctrine-create",
    sourceId: armyConfig.doctrine.id,
    name: "Fictional",
    versionLabel: "1.0.0",
    newFamily: true,
  });
  const id = state.selectedDoctrineId!,
    d = state.doctrines.find((v) => v.doctrineVersionId === id)!;
  service.execute({
    type: "doctrine-publish",
    id,
    expectedContentVersion: d.contentVersion,
  });
  service.execute({ type: "doctrine-retire", id });
  expect(() =>
    service.execute({
      type: "create",
      name: "Invalid pin",
      demo: false,
      configuration: { id: d.config.organization.id, version: 1 },
    }),
  ).toThrow(/non-retired/);
});
it("associates module content and findings with the correct package row", () => {
  const op = create(),
    node = armyConfig.doctrine.catalog!.nodes.find(
      (n) => n.stableKey === "C.1",
    )!,
    a = instantiateProduct(op, armyConfig, node.id, uid),
    m = addOperationModule(
      op,
      a.id,
      newModuleDefinition("CANONICAL_REFERENCES", uid()),
      uid,
      now,
    );
  if (m.content.type === "CANONICAL_REFERENCES")
    m.content.references = [{ kind: "unit", id: uid() }];
  const rows = packageRows(
      op,
      armyConfig,
      moduleFindings(op, armyConfig),
      "Has Issues",
    ),
    row = rows.find((r) => r.node.id === node.id)!;
  expect(row.hasContent).toBe(true);
  expect(row.findings.some((f) => f.entityId === m.moduleInstanceId)).toBe(
    true,
  );
});
it("preserves an unsaved table configuration when resetting inherited layout", () => {
  const op = create(),
    config = structuredClone(armyConfig),
    def = newModuleDefinition("TABLE", uid()),
    versionId = uid();
  config.doctrine.modules = {
    schemaVersion: 1,
    doctrineVersionId: versionId,
    layouts: [{ productId: null, definitions: [def] }],
    assets: [],
  };
  const m = addOperationModule(op, op.orderId, def, uid, now);
  m.origin = "DOCTRINE";
  m.moduleDefinitionId = def.moduleDefinitionId;
  delete m.localDefinition;
  const column = {
    id: uid(),
    stableKey: uid(),
    label: "Unsaved column",
    help: "",
    type: "SHORT_TEXT" as const,
    required: false,
    options: [],
  };
  m.configurationOverride = { columns: [column] };
  if (m.content.type === "TABLE")
    m.content.rows = [{ id: uid(), cells: { [column.id]: "Retained value" } }];
  resetModuleLayout(op, config, op.orderId, true, now);
  expect(m.recoveryConfiguration?.columns?.[0]).toEqual(column);
  expect(canonical(m.content)).toContain("Retained value");
});
it("honors unit audience scope in task-organization module exports", () => {
  const op = create(),
    m = addOperationModule(
      op,
      op.orderId,
      newModuleDefinition("TASK_ORGANIZATION", uid()),
      uid,
      now,
    ),
    profile = createExportProfile(op, "opord", uid());
  profile.inclusion.audienceUnitIds = [op.units[0].id];
  const html = renderModule(m, op, armyConfig, [], profile);
  expect(html).toContain(op.units[0].name);
  expect(html).not.toContain(op.units[1].name);
});
it("tracks canonical net ordering and excludes unrelated authored data from module dependencies", () => {
  const op = create(),
    m = addOperationModule(
      op,
      op.orderId,
      newModuleDefinition("SIGNAL_NET_MATRIX", uid()),
      uid,
      now,
    );
  const first: Parameters<typeof renderModule>[3] = [],
    next: typeof first = [];
  renderModule(m, op, armyConfig, first);
  op.name = "Unrelated to module facts";
  renderModule(m, op, armyConfig, next);
  expect(next).toEqual(first);
  op.signal.nets.reverse();
  const reordered: typeof first = [];
  renderModule(m, op, armyConfig, reordered);
  expect(reordered).not.toEqual(first);
});
it("rejects duplicate table row identities", () => {
  const op = create(),
    m = addOperationModule(
      op,
      op.orderId,
      newModuleDefinition("TABLE", uid()),
      uid,
      now,
    ),
    id = uid();
  if (m.content.type === "TABLE")
    m.content.rows = [
      { id, cells: {} },
      { id, cells: {} },
    ];
  expect(
    moduleFindings(op, armyConfig).some((f) =>
      f.message.includes("Duplicate module content"),
    ),
  ).toBe(true);
});
it("blocks approval and explains a missing managed asset instead of silently dropping it", () => {
  let op = create();
  op.modules = { schemaVersion: 1, instances: [], assets: [] };
  const bytes = Buffer.from("Fictional data"),
    id = uid();
  const a: ManagedAsset = {
    assetId: id,
    operationId: op.id,
    doctrineVersionId: null,
    originalFilename: "fixture.txt",
    mimeType: "text/plain",
    sizeBytes: bytes.length,
    sha256: hashBytes(bytes),
    createdAt: now,
    storageReference: `asset:${id}`,
  };
  repo.modular.insertAsset(a, bytes);
  op.modules.assets = [a];
  op.metadata.statusId = "approved";
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  repo.sqlite.exec("DROP TRIGGER immutable_managed_assets_DELETE");
  repo.sqlite.prepare("DELETE FROM managed_assets WHERE id=?").run(id);
  expect(
    service
      .load(op.id)
      .findings.some(
        (f) =>
          f.ruleId === "managed-asset" &&
          f.message.includes("Missing managed asset"),
      ),
  ).toBe(true);
  expect(() =>
    service.execute({
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "",
    }),
  ).toThrow(/Resolve validation/);
});
it("prevents reusing a saved module identity for a different module definition", () => {
  let op = create();
  const m = addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("PLAIN_TEXT", uid()),
    uid,
    now,
  );
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  op.modules!.instances.find(
    (i) => i.moduleInstanceId === m.moduleInstanceId,
  )!.localDefinition!.stableKey = "different-identity";
  expect(() =>
    service.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }),
  ).toThrow(/Module identity/);
});
