import { visualTestOutput } from "./visual-test-output";
import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID as uid, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { addOperationModule } from "../src/domain/module-authoring";
import { newModuleDefinition } from "../src/domain/modules";
import { newSymbolDefinition } from "../src/domain/symbology";
import { newOrbatLayout } from "../src/domain/orbat";
import { createExportProfile } from "../src/domain/factories";
import {
  canonical,
  exportStaleness,
  projectVersion,
  selectedProjectionVersion,
} from "../src/export/projection";
import { projectV5 } from "../src/export/projections/v5";
import { taskOrganizationGraphic } from "../src/export/task-organization-v5";
import { renderOrbat } from "../src/rendering/orbat-renderer";
import { verifyGraphicalExport } from "../src/application/verify-order-export";
import { restoreWorkspace } from "../src/persistence/restore";
import type { GraphicRenderPort } from "../src/application/render-contracts";
import type { Operation } from "../src/domain/model";
let repo: SqliteRepository, service: OrdoService, op: Operation;
const rt = {
  id: uid,
  now: () => "2026-10-03T12:00:00.000Z",
  actor: "Fictional planner",
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const renderer: GraphicRenderPort = {
  render: async (r) => {
    if (r.kind !== "ORBAT") throw Error("Unexpected request");
    return { kind: "ORBAT", result: renderOrbat(r.input) };
  },
};
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  service = new OrdoService(repo, rt, (_name, config) =>
    demoOperation(config, uid, rt.now()),
  );
  op = service.execute({
    type: "create",
    name: "FICTIONAL GRAPHICAL ORDER",
    demo: true,
  }).operation!;
  addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("TASK_ORGANIZATION", uid()),
    uid,
    rt.now(),
  );
  const m = op.modules!.instances[0];
  m.content = {
    type: "TASK_ORGANIZATION",
    presentation: {
      schemaVersion: 1,
      mode: "DIAGRAM",
      ancestorPolicy: "BOUNDARY",
      foldPolicy: "AS_SHOWN",
      symbolSize: 30,
    },
  };
  op.units[0].symbol = {
    schemaVersion: 1,
    base: { definition: newSymbolDefinition(uid), source: null },
    override: null,
    labels: {
      uniqueDesignation: { kind: "UNIT_NAME" },
      higherFormation: { kind: "DEFINITION" },
    },
  };
  op.orbatLayout = newOrbatLayout(uid);
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
});
afterEach(() => repo.close());
const profile = () => ({
  ...createExportProfile(op, "opord", uid()),
  inclusion: {
    ...createExportProfile(op, "opord", uid()).inclusion,
    paragraphIds: [],
    attachmentIds: [],
    packageScope: "selected" as const,
  },
});
const saveProfile = () => {
  const p = profile();
  repo.saveExportProfile(p);
  return p;
};
const command = (p = saveProfile()) => ({
  type: "generate" as const,
  operationId: op.id,
  expectedRevision: op.revision,
  profileRef: { id: p.id, version: p.version },
  publicationId: null,
});
it("selects v5 by consumed product, retaining v1-v4 and Signal behavior", () => {
  const p = profile(),
    card = createExportProfile(op, "communications-card", uid());
  expect(selectedProjectionVersion(op, p, starterConfig)).toBe(5);
  expect(selectedProjectionVersion(op, card, starterConfig)).toBe(4);
  const before = [1, 2, 3, 4].map((v) =>
    projectVersion(v, op, card, starterConfig),
  );
  op.orbatLayout!.mode = "SIMPLE";
  expect(
    [1, 2, 3, 4].map((v) => projectVersion(v, op, card, starterConfig)),
  ).toEqual(before);
  expect(
    projectV5(op, p, starterConfig).view.sections.some((s) => s.graphic),
  ).toBe(true);
});
it("pins the selected label profile in v5 artifacts and stales only its graphical consumers", async () => {
  const p = saveProfile();
  const before = structuredClone(op);
  const old = (await service.executeWithGraphics(command(p), renderer))
    .exports[0];
  if (old.schemaVersion !== 3) throw Error("Expected graphical export");
  const card = createExportProfile(op, "communications-card", uid());
  const signalBefore = projectVersion(4, op, card, starterConfig);
  op.units[0].symbol!.override = structuredClone(op.units[0].symbol!.base);
  op.units[0].symbol!.override!.definition.renderProfile.version = 2;
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  expect(exportStaleness(old, op).changedPaths).toContain(
    `graphics/${op.modules!.instances[0].moduleInstanceId}/units/${op.units[0].id}/symbol/renderProfile`,
  );
  expect(projectVersion(4, op, card, starterConfig)).toEqual(signalBefore);
  const generated = await service.executeWithGraphics(command(p), renderer);
  const current = generated.exports.find((r) => r.id !== old.id)!;
  if (current.schemaVersion !== 3) throw Error("Expected graphical export");
  expect(
    current.graphics[0].renderManifests.some(
      (m) => m.renderProfile.version === 2,
    ),
  ).toBe(true);
  verifyGraphicalExport(old, before, hash);
  verifyGraphicalExport(current, op, hash);
  expect(renderOrbat(old.graphics[0].request.input).svg).toBe(
    old.graphics[0].svg,
  );
  repo.verifyAll();
});
it("consumes canonical name bindings and layout but not source-only provenance or excluded units", () => {
  const p = profile();
  p.inclusion.audienceUnitIds = [op.units[0].id];
  const record = {
    operationId: op.id,
    projectionVersion: 5,
    profile: p,
    config: starterConfig,
    dependencies: projectV5(op, p, starterConfig).dependencies,
  };
  const source = structuredClone(op.units[0].symbol!.base);
  source.definition.definitionId = uid();
  source.definition.origin = {
    kind: "IMPORT",
    fileHash: "a".repeat(64),
    importerVersion: "fixture",
    originalCode: "original",
  };
  op.units[0].symbol!.override = source;
  expect(exportStaleness(record, op).outdated).toBe(false);
  op.units[0].symbol!.override!.definition.amplifiers.staffComments =
    "Not drawn in ORBAT context";
  op.units[0].symbol!.labels.higherFormation = { kind: "UNIT_NAME" };
  expect(exportStaleness(record, op).outdated).toBe(false);
  op.units[1].name = "EXCLUDED NAME";
  expect(exportStaleness(record, op).outdated).toBe(false);
  op.units[0].name = "RENAMED CANONICAL UNIT";
  expect(exportStaleness(record, op).changedPaths).toContain(
    `graphics/${op.modules!.instances[0].moduleInstanceId}/units/${op.units[0].id}/name`,
  );
  const next = {
    ...record,
    dependencies: projectV5(op, p, starterConfig).dependencies,
  };
  op.orbatLayout!.mode = "SIMPLE";
  expect(exportStaleness(next, op).outdated).toBe(true);
});
it("keeps anonymous ancestor boundaries and folded facts out of graphical inputs", () => {
  const parent = op.units[0],
    child = op.units[1];
  child.parentUnitId = parent.id;
  child.inTaskOrganization = true;
  const p = profile();
  p.inclusion.audienceUnitIds = [child.id];
  const m = op.modules!.instances[0];
  const boundary = taskOrganizationGraphic(op, m, p);
  expect(
    boundary.request.input.nodes.find((n) => n.id === parent.id),
  ).toMatchObject({ name: "", symbol: null, boundary: true });
  p.inclusion.audienceUnitIds = [];
  op.orbatLayout!.hints = [
    { nodeId: parent.id, folded: true, hqStaff: false, offset: null },
  ];
  const before = taskOrganizationGraphic(op, m, p);
  child.name = "UNCONSUMED HIDDEN FACT";
  child.symbol = structuredClone(parent.symbol);
  expect(taskOrganizationGraphic(op, m, p)).toEqual(before);
});
it("redacts parent-name bindings at an audience boundary but resolves explicitly included context", () => {
  const parent = op.units[0],
    child = op.units[1],
    p = profile(),
    m = op.modules!.instances[0];
  child.parentUnitId = parent.id;
  child.inTaskOrganization = true;
  child.symbol = structuredClone(parent.symbol);
  child.symbol!.labels.uniqueDesignation = { kind: "PARENT_UNIT_NAME" };
  p.inclusion.audienceUnitIds = [child.id];
  const before = taskOrganizationGraphic(op, m, p);
  expect(
    before.request.input.nodes.find((n) => n.id === child.id)!.symbol!
      .amplifiers.uniqueDesignation,
  ).toBe("");
  expect(canonical(before)).not.toContain(parent.name);
  parent.name = "PRIVATE PARENT RENAME";
  expect(taskOrganizationGraphic(op, m, p)).toEqual(before);
  if (m.content.type !== "TASK_ORGANIZATION") throw Error("fixture");
  m.content.presentation!.ancestorPolicy = "INCLUDE_CONTEXT";
  const context = taskOrganizationGraphic(op, m, p);
  expect(
    context.request.input.nodes.find((n) => n.id === child.id)!.symbol!
      .amplifiers.uniqueDesignation,
  ).toBe(parent.name);
  expect(
    context.dependencies.some((d) =>
      d.path.endsWith(`/units/${parent.id}/name`),
    ),
  ).toBe(true);
});
it("retains verified SVG and exact dependencies, rejects corrupted bytes and restores without rendering", async () => {
  const cmd = command();
  expect(() => service.execute(cmd)).toThrow(/asynchronous/);
  const state = await service.executeWithGraphics(cmd, renderer),
    record = state.exports[0];
  expect(record.schemaVersion).toBe(3);
  if (record.schemaVersion !== 3) throw Error("Expected graphical export");
  expect(record.graphics).toHaveLength(1);
  expect(record.graphics[0].renderManifests.length).toBeGreaterThan(0);
  verifyGraphicalExport(record, op, hash);
  repo.verifyAll();
  const corrupt = structuredClone(record);
  corrupt.graphics[0].svg += "changed";
  expect(() => verifyGraphicalExport(corrupt, op, hash)).toThrow(/mismatch/);
  const wrongManifest = structuredClone(record);
  wrongManifest.graphics[0].renderManifests[0].definitionHash = "0".repeat(64);
  expect(() => verifyGraphicalExport(wrongManifest, op, hash)).toThrow(
    /consumed render input/,
  );
  const omittedManifest = structuredClone(record);
  omittedManifest.graphics[0].renderManifests = [];
  expect(() => verifyGraphicalExport(omittedManifest, op, hash)).toThrow(
    /omits consumed/,
  );
  const missing = structuredClone(record);
  missing.graphics = [];
  expect(() => repo.insertExport(missing)).toThrow();
  const old = canonical(repo.listExports(op.id));
  op.units[0].name = "NEW PLANNING NAME";
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  expect(canonical(repo.listExports(op.id))).toBe(old);
  expect(exportStaleness(record, op).outdated).toBe(true);
});
it("commits nothing when rendering fails or the current revision changes", async () => {
  const cmd = command();
  await expect(
    service.executeWithGraphics(cmd, {
      render: async () => {
        throw Error("render unavailable");
      },
    }),
  ).rejects.toThrow(/unavailable/);
  expect(repo.listExports(op.id)).toEqual([]);
  await expect(
    service.executeWithGraphics(cmd, {
      render: async (r) => {
        op.name = "CHANGED WHILE RENDERING";
        op = service.execute({
          type: "save",
          operation: op,
          expectedRevision: op.revision,
        }).operation!;
        return renderer.render(r);
      },
    }),
  ).rejects.toThrow(/changed during rendering/);
  expect(repo.listExports(op.id)).toEqual([]);
});
it("freezes publication graphics independently of later planning layout and names", async () => {
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
    note: "Fictional exact revision",
  });
  const publication = service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  }).publications[0];
  const p = saveProfile();
  const first = (
    await service.executeWithGraphics(
      { ...command(p), publicationId: publication.id },
      renderer,
    )
  ).exports[0];
  op.units[0].name = "NEW PLANNING NAME";
  op.orbatLayout!.mode = "SIMPLE";
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  const next = (
    await service.executeWithGraphics(
      { ...command(p), publicationId: publication.id },
      renderer,
    )
  ).exports.at(-1)!;
  expect(first.schemaVersion).toBe(3);
  expect(next.schemaVersion).toBe(3);
  if (first.schemaVersion !== 3 || next.schemaVersion !== 3)
    throw Error("Expected v5");
  expect(next.graphics).toEqual(first.graphics);
  expect(next.sourceRevision).toBe(publication.sourceRevision);
  expect(repo.listPublications(op.id)[0]).toEqual(publication);
  repo.verifyAll();
});
it("backs up and restores retained graphical bytes and rejects removed envelope protection", async () => {
  await service.executeWithGraphics(command(), renderer);
  const record = repo.listExports(op.id)[0];
  mkdirSync(".test-data", { recursive: true });
  const path = `.test-data/m6-order-restore-${uid()}.db`,
    backup = `.test-data/m6-order-backup-${uid()}.db`;
  await repo.backup(path);
  await repo.backup(backup);
  let active = new SqliteRepository(path, true);
  try {
    await restoreWorkspace(active, path, backup, (next) => {
      active = next;
    });
    expect(active.listExports(op.id)[0]).toEqual(record);
    active.verifyAll();
    active.sqlite.exec("DROP TRIGGER export_requires_template");
    expect(() => active.verifyAll()).toThrow(/export-envelope protection/);
  } finally {
    if (active.sqlite.open) active.close();
  }
});
it("renders a whole grouped and folded graphical order with replacement flags and labels", async () => {
  const fixtureId = (n: number) =>
    `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const root = op.units[0];
  root.name = "FICTIONAL TASK FORCE / DEMONSTRATION";
  root.symbol!.base.definition.compatibility.flagId = "NATO";
  // Fixture-only baseline setup precedes the protected source assignment.
  op.units = [{ ...root, id: fixtureId(1), symbol: undefined }];
  const rootId = op.units[0].id;
  const symbol = structuredClone(root.symbol!);
  op.units[0].symbol = symbol;
  for (let i = 0; i < 14; i++) {
    const state = structuredClone(symbol);
    state.base.definition.definitionId = fixtureId(i + 100);
    state.base.definition.compatibility.flagId = [
      "US",
      "CA",
      "GB",
      "FR",
      "UA",
      "NATO",
      null,
    ][i % 7];
    op.units.push({
      ...root,
      id: fixtureId(i + 2),
      name: `FICTIONAL ${i + 1} / ${i === 5 ? "LONG DESIGNATION TEXT" : "UNIT"}`,
      parentUnitId: rootId,
      inTaskOrganization: true,
      symbol: state,
    });
  }
  for (let i = 0; i < 4; i++)
    op.units.push({
      ...op.units[1],
      id: fixtureId(i + 16),
      name: `FOLDED CHILD ${i + 1}`,
      parentUnitId: op.units[1].id,
    });
  // Keep references valid when replacing fixture units.
  op.tasks.forEach((t) => {
    t.unitId = rootId;
  });
  op.signal.nets.forEach((n) => {
    n.participantUnitIds = [rootId];
  });
  op.signal.pacePlans.forEach((p) => {
    p.unitIds = [rootId];
  });
  op.attachments.forEach((a) => {
    a.unitIds = [];
  });
  op.orbatLayout!.hints = [
    { nodeId: op.units[1].id, folded: true, hqStaff: false, offset: null },
  ];
  // This test exercises the pure/render/export composition at realistic visual size.
  const p = profile(),
    projected = projectV5(op, p, starterConfig);
  const { fulfillOrderGraphics } =
    await import("../src/application/order-graphics");
  const { renderGraphicalHtml } = await import("../src/export/graphical-html");
  const graphics = await fulfillOrderGraphics(projected.view, renderer, hash);
  const html = renderGraphicalHtml(
    projected.view,
    graphics.map((g) => ({ blockId: g.request.blockId, svg: g.svg })),
    "FICTIONAL VISUAL FIXTURE · projection v5 · not desktop acceptance",
  );
  expect(html).toContain("task-organization-graphic");
  expect(html).not.toContain("FOLDED CHILD");
  mkdirSync(visualTestOutput, { recursive: true });
  writeFileSync(`${visualTestOutput}/graphical-order.html`, html);
  // Expand from authoritative data, not from the folded product's redacted input.
  const original = taskOrganizationGraphic(
    { ...op, orbatLayout: { ...op.orbatLayout!, hints: [] } },
    op.modules!.instances[0],
    p,
  ).request.input;
  const cases = [
    "grouped-folded-flags",
    "simple-folded-flags",
    "expanded-flags",
    "root-fold",
    "hq-pairs",
    "long-label-marks",
  ].map((id) => {
    const input = structuredClone(original);
    input.layout.hints = structuredClone(op.orbatLayout!.hints);
    if (id === "simple-folded-flags") input.layout.mode = "SIMPLE";
    if (id === "expanded-flags") input.layout.hints = [];
    if (id === "root-fold")
      input.layout.hints = [
        { nodeId: rootId, folded: true, hqStaff: false, offset: null },
      ];
    if (id === "hq-pairs")
      input.layout.hints = [
        ...input.layout.hints,
        ...input.nodes.slice(2, 6).map((n) => ({
          nodeId: n.id,
          folded: false,
          hqStaff: true,
          offset: null,
        })),
      ];
    if (id === "long-label-marks")
      for (const [i, n] of input.nodes.entries())
        if (n.symbol) {
          n.symbol.amplifiers.uniqueDesignation = `FICTIONAL ${i} / Équipe démonstration`;
          n.symbol.amplifiers.additionalInformation =
            "Long supporting annotation";
          n.symbol.compatibility.signature = "!";
          n.symbol.compatibility.stack = 2;
          n.symbol.compatibility.generalStars = 3;
        }
    return { id, input, result: renderOrbat(input) };
  });
  writeFileSync(
    `${visualTestOutput}/ordo-composition-results.json`,
    JSON.stringify(cases),
  );
});
