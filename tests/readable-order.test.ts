import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepository } from "../src/persistence/repository";
import { restoreWorkspace } from "../src/persistence/restore";
import migration12 from "../src/persistence/migrations/012.sql?raw";
import { armyConfig, starterConfig } from "../src/config/profiles";
import { OrdoService } from "../src/application/service";
import { generateNarrativeOrder } from "../src/application/narrative-export-service";
import { verifyReadableOrder } from "../src/application/verify-readable-order";
import { demoOperation } from "../src/demo/operation";
import { createExportProfile } from "../src/domain/factories";
import { catalogNodes, instantiateProduct } from "../src/domain/authoring";
import { addOperationModule } from "../src/domain/module-authoring";
import { newModuleDefinition } from "../src/domain/modules";
import { newSymbolDefinition } from "../src/domain/symbology";
import { writeNarrative } from "../src/domain/narrative";
import { exportRecordSchema, type Operation } from "../src/domain/model";
import { canonical, exportStaleness, project } from "../src/export/projection";
import { projectReadableOrder } from "../src/export/readable-order";
import { printHtmlV1 } from "../src/export/print-v1";
import { renderOrbat } from "../src/rendering/orbat-renderer";
import type { GraphicRenderPort } from "../src/application/render-contracts";

const rt = {
  id,
  now: () => "2026-10-09T15:00:00.000Z",
  actor: "Fictional planner",
};
const renderer: GraphicRenderPort = {
  render: async (r) => {
    if (r.kind !== "ORBAT") throw Error("Unexpected rendering request");
    return { kind: "ORBAT", result: renderOrbat(r.input) };
  },
};
let repo: SqliteRepository, service: OrdoService, op: Operation;
const makeService = () =>
  new OrdoService(repo, rt, (_name, config) =>
    demoOperation(config, id, rt.now()),
  );
const save = () => {
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
};
const command = () => {
  const profile = repo
    .listExportProfiles(op.id)
    .find((p) => p.product === "opord")!;
  return {
    type: "generate" as const,
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId: null as string | null,
  };
};
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  service = makeService();
  op = service.execute({
    type: "create",
    name: "Fictional relief",
    demo: true,
    configuration: {
      id: armyConfig.organization.id,
      version: armyConfig.organization.version,
    },
  }).operation!;
  const fields = armyConfig.doctrine.catalog!.baseFields;
  op.authoring!.fields[0].text =
    "Fictional relief teams deliver supplies to the island reception centre.";
  op.authoring!.fields.push(
    {
      fieldId: fields.find((f) => f.contentKind === "structured-fields")!.id,
      text: "",
      references: [],
      entries: [
        {
          id: id(),
          label: "Civilian services",
          value: "All fictional reception centres are supplied.",
          references: [{ kind: "objective", id: op.objectives[0].id }],
        },
      ],
    },
    {
      fieldId: fields.find((f) => f.contentKind === "task-collection")!.id,
      text: "",
      references: [{ kind: "task", id: op.tasks[0].id }],
    },
  );
  const annex = instantiateProduct(
    op,
    armyConfig,
    catalogNodes(armyConfig).find((n) => n.stableKey === "B")!.id,
    id,
  );
  annex.applicability = "INCLUDED";
  annex.content = {
    kind: "narrative",
    references: [{ kind: "unit", id: op.units[0].id }],
    sections: [
      {
        id: id(),
        title: "Relief assessment",
        text: "The fictional reception team confirms delivery needs each morning.",
      },
    ],
  };
  save();
});
afterEach(() => repo.close());

it("omits implicit tables in base, structured entries and annex previews without altering source or dependencies", () => {
  const profile = createExportProfile(op, "opord", id()),
    before = canonical(op);
  const historical = project(op, profile, armyConfig),
    current = projectReadableOrder(op, profile, armyConfig);
  expect(historical.view.sections.some((s) => s.title === "Linked facts")).toBe(
    true,
  );
  expect(
    historical.view.sections.filter(
      (s) => s.title === "Authoritative references",
    ),
  ).toHaveLength(2);
  expect(
    current.view.sections.some((s) =>
      ["Linked facts", "Authoritative references"].includes(s.title),
    ),
  ).toBe(false);
  expect(current.dependencies).toEqual(historical.dependencies);
  expect(canonical(op)).toBe(before);
  for (const title of ["Key tasks", "Tasks and purposes", "Task organization"])
    expect(
      current.view.sections.find((s) => s.title === title)?.rows?.length,
    ).toBeGreaterThan(0);
  expect(canonical(current.view)).toContain(op.signal.nets[0].channel);
  expect(canonical(current.view)).toContain(
    "All fictional reception centres are supplied.",
  );
  const annex = op.attachments.find((a) => a.content)!;
  const preview = projectReadableOrder(
    op,
    profile,
    armyConfig,
    annex.doctrineNodeId!,
  );
  expect(canonical(preview.view)).toContain("confirms delivery needs");
  expect(
    preview.view.sections.some((s) => s.title === "Authoritative references"),
  ).toBe(false);
  const card = createExportProfile(op, "communications-card", id());
  expect(projectReadableOrder(op, card, armyConfig)).toEqual(
    project(op, card, armyConfig),
  );
});

it("preserves explicitly authored headings and reference modules even with the same table title", () => {
  const a = op.attachments.find((a) => a.content)!.content!;
  if (a.kind !== "narrative") throw Error("Fixture");
  a.sections.push({
    id: id(),
    title: "Linked facts",
    text: "This is a deliberately authored heading.",
  });
  const definition = newModuleDefinition("CANONICAL_REFERENCES", id());
  definition.title = "Linked facts";
  addOperationModule(op, op.orderId, definition, id, rt.now());
  op.modules!.instances.at(-1)!.content = {
    type: "CANONICAL_REFERENCES",
    references: [{ kind: "unit", id: op.units[0].id }],
  };
  save();
  const record = service.execute(command()).exports[0];
  expect(record.html).toContain("This is a deliberately authored heading.");
  expect(record.html).toContain(op.units[0].name);
  const view = projectReadableOrder(op, record.profile, record.config).view;
  expect(view.sections.filter((s) => s.title === "Linked facts")).toHaveLength(
    2,
  );
  expect(
    view.sections.some(
      (s) =>
        s.title === "Linked facts" &&
        "moduleHtml" in s &&
        typeof s.moduleHtml === "string" &&
        s.moduleHtml.includes("<table"),
    ),
  ).toBe(true);
  repo.verifyAll();
});

it("uses clean composition for synchronous and rich asynchronous exports and retains linked-fact staleness", async () => {
  const plain = service.execute(command()).exports[0];
  op.authoring!.fields[0].text = writeNarrative({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Fictional relief narrative",
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  });
  save();
  await service.executeWithGraphics(command(), renderer);
  const rich = repo.listExports(op.id).find((e) => e.id !== plain.id)!;
  for (const record of [plain, rich]) {
    expect(record.rendererVersion).toBe("html-v5");
    expect(record.html).not.toContain(">Linked facts</h2>");
    expect(record.html).not.toContain(">Authoritative references</h2>");
    expect(
      printHtmlV1(record, { paper: "A4", orientation: "portrait" }),
    ).not.toContain(">Linked facts</h2>");
    expect(record.dependencies).toEqual(
      project(
        repo.getOperation(op.id, record.sourceRevision),
        record.profile,
        record.config,
      ).dependencies,
    );
  }
  expect(rich.html).toContain("<strong>Fictional relief narrative</strong>");
  expect(exportStaleness(rich, op).outdated).toBe(false);
  op.events[0].name = "Updated linked event";
  expect(exportStaleness(rich, op).outdated).toBe(true);
  expect(
    repo.getOperation(op.id, rich.sourceRevision).authoring!.fields[0]
      .references.length,
  ).toBeGreaterThan(0);
  expect(
    exportRecordSchema.safeParse({ ...rich, rendererVersion: "html-v4" })
      .success,
  ).toBe(false);
  expect(
    exportRecordSchema.safeParse({ ...rich, projectionVersion: 5 }).success,
  ).toBe(false);
  expect(() =>
    repo.insertExport({ ...rich, id: id(), html: rich.html + "tampered" }),
  ).toThrow(/hash mismatch/);
  repo.verifyAll();
});

it("renders graphical orders with exact retained symbols and validates their new envelope", async () => {
  addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("TASK_ORGANIZATION", id()),
    id,
    rt.now(),
  );
  op.modules!.instances.at(-1)!.content = {
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
    base: { definition: newSymbolDefinition(id), source: null },
    override: null,
    labels: {
      uniqueDesignation: { kind: "UNIT_NAME" },
      higherFormation: { kind: "DEFINITION" },
    },
  };
  save();
  await service.executeWithGraphics(command(), renderer);
  const record = repo.listExports(op.id)[0];
  if (record.schemaVersion !== 5) throw Error("Expected clean composition");
  expect(record.projectionVersion).toBe(5);
  expect(record.graphics).toHaveLength(1);
  expect(record.html).toContain(record.graphics[0].svg);
  expect(record.html).not.toContain(">Linked facts</h2>");
  verifyReadableOrder(record, op, (s) =>
    repo.hashBinary(new TextEncoder().encode(s)),
  );
  expect(() =>
    repo.insertExport({ ...record, id: id(), graphics: [] }),
  ).toThrow();
  repo.verifyAll();
});

it("uses the frozen publication when a current operation has different narrative and links", async () => {
  op.metadata.statusId = "approved";
  save();
  service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "Fictional review",
  });
  const published = service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  }).publications[0];
  const frozen = canonical(published);
  op.authoring!.fields[0].text = "Later planning text";
  op.authoring!.fields[0].references = [];
  save();
  const record = (
    await service.executeWithGraphics(
      { ...command(), publicationId: published.id },
      renderer,
    )
  ).exports[0];
  expect(record.sourceRevision).toBe(published.sourceRevision);
  expect(record.html).toContain(
    "deliver supplies to the island reception centre",
  );
  expect(record.html).not.toContain("Later planning text");
  expect(record.html).not.toContain(">Linked facts</h2>");
  expect(canonical(repo.listPublications(op.id)[0])).toBe(frozen);
  repo.verifyAll();
});

it("migrates a schema-12 workspace and restores old and new exports without rewriting either", async () => {
  op.sections[0].summary = writeNarrative({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Historical formatted narrative",
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  });
  save();
  await generateNarrativeOrder(repo, rt, command(), renderer);
  const historic = repo.listExports(op.id)[0];
  expect(historic.rendererVersion).toBe("html-v4");
  expect(historic.html).toContain(">Linked facts</h2>");
  const folder = mkdtempSync(".test-data/readable-order-"),
    oldPath = join(folder, "schema12.db"),
    livePath = join(folder, "live.db"),
    backup = join(folder, "backup.db");
  // Reconstruct the exact pre-013 guard/ledger; no data or export bytes change.
  repo.sqlite.exec(
    migration12.slice(
      migration12.indexOf("DROP TRIGGER export_requires_template;"),
    ),
  );
  repo.sqlite.exec(
    "DROP TABLE alternative_plans; DROP TABLE whiteboard_snapshot_assets; DROP TABLE whiteboard_snapshots; DROP TABLE office_exports; DROP TABLE briefing_exports",
  );
  repo.sqlite.prepare("DELETE FROM schema_migrations WHERE version>=13").run();
  // This fixture represents a workspace before the disposable search index existed.
  repo.sqlite.exec(
    "DROP TRIGGER search_operation_delete; DROP TRIGGER search_catalog_delete; DROP TRIGGER search_asset_delete; DROP TABLE search_fts; DROP TABLE search_documents; DROP TABLE search_owners;",
  );
  await repo.backup(oldPath);
  repo.close();
  repo = new SqliteRepository(oldPath);
  service = makeService();
  expect(repo.listExports(op.id)[0]).toEqual(historic);
  repo.verifyAll();
  await service.executeWithGraphics(command(), renderer);
  const fresh = repo.listExports(op.id).find((e) => e.id !== historic.id)!;
  expect(fresh.rendererVersion).toBe("html-v5");
  expect(fresh.html).not.toContain(">Linked facts</h2>");
  await repo.backup(backup);
  await repo.backup(livePath);
  repo.close();
  repo = new SqliteRepository(livePath);
  await restoreWorkspace(repo, livePath, backup, (replacement) => {
    repo = replacement;
  });
  expect(repo.listExports(op.id).find((e) => e.id === historic.id)).toEqual(
    historic,
  );
  expect(repo.listExports(op.id).find((e) => e.id === fresh.id)).toEqual(fresh);
  repo.verifyAll();
});
