import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { SqliteRepository } from "../src/persistence/repository";
import { hashBytes } from "../src/persistence/modular-store";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import { type Operation, operationSchema } from "../src/domain/model";
import { type DoctrineVersion } from "../src/domain/doctrine-builder";
import {
  moduleTypes,
  newModuleDefinition,
  emptyModuleContent,
  moduleDefinitionSchema,
  richDocumentSchema,
  type ManagedAsset,
  type FieldDefinition,
} from "../src/domain/modules";
import {
  addOperationModule,
  resetModuleLayout,
  moduleFindings,
  fieldValueError,
} from "../src/domain/module-authoring";
import {
  canonical,
  project,
  projectVersion,
  exportStaleness,
  projectionVersionFor,
} from "../src/export/projection";
import { renderModularHtml } from "../src/export/modular-html";
import { renderModule, chartSvg } from "../src/export/module-render";
import { createExportProfile } from "../src/domain/factories";
import { assertOperation } from "../src/domain/invariants";
import { restoreWorkspace } from "../src/persistence/restore";
const now = "2026-10-03T12:00:00.000Z",
  uid = randomUUID;
let repo: SqliteRepository, service: OrdoService;
const makeService = (r: SqliteRepository) =>
  new OrdoService(
    r,
    { id: uid, now: () => now, actor: "Fictional test planner" },
    (_name, config) => demoOperation(config, uid, now),
  );
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  service = makeService(repo);
});
afterEach(() => repo.close());
const draft = () => {
  const s = service.execute({
    type: "doctrine-create",
    sourceId: armyConfig.doctrine.id,
    name: "FICTIONAL 25th LIB Orders",
    versionLabel: "1.0.0",
    newFamily: true,
  });
  return s.doctrines.find((v) => v.doctrineVersionId === s.selectedDoctrineId)!;
};
const saveDoctrine = (d: DoctrineVersion) => {
  const s = service.execute({
    type: "doctrine-save",
    doctrine: d,
    expectedContentVersion: d.contentVersion,
  });
  return s.doctrines.find((v) => v.doctrineVersionId === d.doctrineVersionId)!;
};
const publish = (d: DoctrineVersion) => {
  const s = service.execute({
    type: "doctrine-publish",
    id: d.doctrineVersionId,
    expectedContentVersion: d.contentVersion,
  });
  return s.doctrines.find((v) => v.doctrineVersionId === d.doctrineVersionId)!;
};
const fixture = () => {
  const d = publish(draft());
  const op = service.execute({
    type: "create",
    name: "FICTIONAL SILVER PINE",
    demo: true,
    configuration: {
      id: d.config.organization.id,
      version: d.config.organization.version,
    },
  }).operation!;
  return { d, op, config: d.config };
};
const saveOp = (op: Operation) =>
  service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
const add = (op: Operation, type: string) =>
  addOperationModule(
    op,
    op.orderId,
    newModuleDefinition(type, uid()),
    uid,
    now,
  );
const field = (
  label: string,
  type: FieldDefinition["type"] = "SHORT_TEXT",
): FieldDefinition => ({
  id: uid(),
  stableKey: uid(),
  label,
  help: "",
  type,
  required: false,
  options: [],
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const asset = (
  owner: { operationId: string | null; doctrineVersionId: string | null },
  bytes = png,
): ManagedAsset => {
  const id = uid();
  return {
    assetId: id,
    ...owner,
    originalFilename: "fictional.png",
    mimeType: "image/png",
    sizeBytes: bytes.length,
    sha256: hashBytes(bytes),
    createdAt: now,
    storageReference: `asset:${id}`,
  };
};
describe("doctrine lifecycle and identity", () => {
  it("preserves all frozen M1/M2 files byte-for-byte", () => {
    const hashes = JSON.parse(
      readFileSync("tests/fixtures/milestone3-frozen-hashes.json", "utf8"),
    );
    for (const [path, hash] of Object.entries(hashes))
      expect(hashBytes(readFileSync(path))).toBe(hash);
  });
  it("lists bundled versions and rejects service and SQL mutation", () => {
    const v = repo
      .listDoctrines()
      .find((v) => v.doctrineFamilyId === armyConfig.doctrine.id)!;
    expect(v.sourceKind).toBe("BUNDLED");
    expect(() =>
      service.execute({
        type: "doctrine-save",
        doctrine: v,
        expectedContentVersion: v.contentVersion,
      }),
    ).toThrow(/immutable/);
    expect(() =>
      repo.sqlite
        .prepare("UPDATE doctrine_versions SET document='{}' WHERE id=?")
        .run(v.doctrineVersionId),
    ).toThrow(/immutable/);
  });
  it("duplicates into a new stable family and preserves citations", () => {
    const d = draft();
    expect(d.status).toBe("DRAFT");
    expect(d.doctrineFamilyId).not.toBe(armyConfig.doctrine.id);
    expect(d.config.doctrine.catalog).toEqual(armyConfig.doctrine.catalog);
    expect(d.duplicatedFromVersionId).toBe(armyConfig.doctrine.id);
  });
  it("rejects stale draft edits and identity changes", () => {
    let d = draft(),
      stale = structuredClone(d);
    d.description = "Versioned description";
    d = saveDoctrine(d);
    expect(() => saveDoctrine(stale)).toThrow(/changed/);
    d.stableKey = "changed";
    expect(() => saveDoctrine(d)).toThrow(/identity/);
  });
  it("freezes published content and derives an independent new draft", () => {
    const d = publish(draft());
    const s = service.execute({
      type: "doctrine-create",
      sourceId: d.doctrineVersionId,
      name: d.displayName,
      versionLabel: "1.1.0",
      newFamily: false,
    });
    const next = s.doctrines.find(
      (v) => v.doctrineVersionId === s.selectedDoctrineId,
    )!;
    next.description = "Only next";
    saveDoctrine(next);
    expect(
      repo
        .listDoctrines()
        .find((v) => v.doctrineVersionId === d.doctrineVersionId),
    ).toEqual(d);
    expect(next.parentVersionId).toBe(d.doctrineVersionId);
    expect(next.config.doctrine.version).toBe(2);
  });
  it("prevents duplicate version labels within a family", () => {
    const d = publish(draft());
    expect(() =>
      service.execute({
        type: "doctrine-create",
        sourceId: d.doctrineVersionId,
        name: d.displayName,
        versionLabel: "1.0.0",
        newFamily: false,
      }),
    ).toThrow(/already used/);
  });
  it("retirement removes creation availability and preserves pinned operations", () => {
    const { d, op } = fixture();
    service.execute({ type: "doctrine-retire", id: d.doctrineVersionId });
    expect(service.load(op.id).operation).toEqual(op);
    expect(
      service
        .load()
        .configurations.some((c) => c.doctrine.id === d.doctrineFamilyId),
    ).toBe(false);
    expect(repo.getConfig(op)).toEqual(d.config);
  });
  it("operation remains pinned when another doctrine version is published", () => {
    const { d, op } = fixture();
    const s = service.execute({
      type: "doctrine-create",
      sourceId: d.doctrineVersionId,
      name: d.displayName,
      versionLabel: "1.1.0",
      newFamily: false,
    });
    publish(
      s.doctrines.find((v) => v.doctrineVersionId === s.selectedDoctrineId)!,
    );
    expect(repo.getOperation(op.id).doctrineRef).toEqual(op.doctrineRef);
    expect(repo.getConfig(op)).toEqual(d.config);
  });
});
describe("typed modules and operation layouts", () => {
  it.each(moduleTypes)(
    "round-trips %s content without UI implementation data",
    (type) => {
      const { op, config } = fixture();
      const m = add(op, type);
      expect(moduleDefinitionSchema.parse(m.localDefinition).moduleType).toBe(
        type,
      );
      expect(
        operationSchema.parse(op).modules!.instances.at(-1)!.content,
      ).toEqual(emptyModuleContent(m.localDefinition!));
      expect(assertOperation(op, config).id).toBe(op.id);
      expect(renderModule(m, op, config, [])).toBeTypeOf("string");
    },
  );
  it("rejects unsupported required modules but retains explainable optional ones", () => {
    const def = newModuleDefinition("FUTURE_MODULE", uid());
    expect(moduleDefinitionSchema.parse(def)).toEqual(def);
    def.required = true;
    expect(() => moduleDefinitionSchema.parse(def)).toThrow(
      /Unsupported required/,
    );
  });
  it("separates doctrine configuration, operation content, and reset recovery", () => {
    let d = draft();
    const def = newModuleDefinition("RICH_TEXT", uid());
    d.config.doctrine.modules!.layouts = [
      { productId: null, definitions: [def] },
    ];
    d = publish(saveDoctrine(d));
    let op = service.execute({
      type: "create",
      name: "Fictional",
      demo: false,
      configuration: { id: d.config.organization.id, version: 1 },
    }).operation!;
    const m = op.modules!.instances[0];
    if (m.content.type === "RICH_TEXT")
      m.content.document = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Retain this" }],
          },
        ],
      };
    m.layoutState = "REMOVED_BY_OPERATION_OVERRIDE";
    const local = add(op, "PLAIN_TEXT");
    if (local.content.type === "PLAIN_TEXT")
      local.content.text = "Local retained";
    expect(() =>
      resetModuleLayout(op, d.config, op.orderId, false, now),
    ).toThrow(/Confirm reset/);
    resetModuleLayout(op, d.config, op.orderId, true, now);
    expect(m.layoutState).toBe("ACTIVE");
    expect(local.layoutState).toBe("REMOVED_BY_OPERATION_OVERRIDE");
    op = saveOp(op);
    expect(JSON.stringify(op)).toContain("Retain this");
    expect(JSON.stringify(op)).toContain("Local retained");
    expect(repo.getConfig(op)).toEqual(d.config);
  });
  it("rejects wrong operation/product/definition bindings", () => {
    const { op, config } = fixture(),
      m = add(op, "PLAIN_TEXT");
    m.operationId = uid();
    expect(() => assertOperation(op, config)).toThrow(/another operation/);
    m.operationId = op.id;
    m.productInstanceId = uid();
    expect(() => assertOperation(op, config)).toThrow(/another operation/);
  });
  it("detects duplicate module IDs", () => {
    const { op, config } = fixture(),
      m = add(op, "PLAIN_TEXT");
    op.modules!.instances.push(structuredClone(m));
    expect(() => assertOperation(op, config)).toThrow(/Duplicate module/);
  });
  it("reports broken canonical, timeline, and chart references without rewriting content", () => {
    const { op, config } = fixture(),
      refs = add(op, "CANONICAL_REFERENCES"),
      timeline = add(op, "TIMELINE"),
      chart = add(op, "CHART");
    if (refs.content.type === "CANONICAL_REFERENCES")
      refs.content.references = [{ kind: "unit", id: uid() }];
    if (timeline.content.type === "TIMELINE")
      timeline.content.items = [
        {
          id: uid(),
          title: "Fictional H-30",
          description: "",
          phaseId: null,
          timing: {
            mode: "RELATIVE",
            referenceEventId: uid(),
            offsetMinutes: -30,
          },
        },
      ];
    if (chart.content.type === "CHART")
      chart.content.source = {
        mode: "TABLE",
        moduleInstanceId: uid(),
        categoryColumnId: uid(),
        valueColumnIds: [uid()],
      };
    const before = canonical(op);
    expect(
      moduleFindings(op, config).filter((f) => f.severity === "error").length,
    ).toBeGreaterThanOrEqual(3);
    expect(canonical(op)).toBe(before);
    expect(saveOp(op).revision).toBe(2);
  });
  it("validates typed fields and select options", () => {
    const { op, config } = fixture();
    expect(
      fieldValueError({ ...field("Integer", "INTEGER"), required: true }, null),
    ).toMatch(/Required/);
    expect(fieldValueError(field("Integer", "INTEGER"), 1.2)).toMatch(/number/);
    expect(fieldValueError(field("Boolean", "BOOLEAN"), "true")).toMatch(
      /boolean/,
    );
    expect(
      fieldValueError(
        {
          ...field("Select", "SINGLE_SELECT"),
          options: [{ id: "a", label: "A" }],
        },
        "missing",
      ),
    ).toMatch(/selection/);
    expect(
      fieldValueError(field("Unit", "UNIT_REFERENCE"), uid(), op, config),
    ).toMatch(/reference/);
  });
});
describe("rich text and linked projections", () => {
  it.each(["javascript:alert(1)", "file:///secret", "data:text/html,<script>"])(
    "rejects unsafe rich text link %s",
    (href) => {
      expect(() =>
        richDocumentSchema.parse({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "link",
                  marks: [{ type: "link", attrs: { href } }],
                },
              ],
            },
          ],
        }),
      ).toThrow();
    },
  );
  it("rejects scripts, event handlers, raw HTML, external image paths, and illegal nesting", () => {
    for (const node of [
      { type: "script", text: "bad" },
      { type: "image", attrs: { src: "https://example.com/x.png" } },
      { type: "paragraph", onclick: "bad" },
      { type: "text", text: "bad" },
    ])
      expect(() =>
        richDocumentSchema.parse({ type: "doc", content: [node] }),
      ).toThrow();
  });
  it("sanitizes and preserves rich formatting through save/restart projection", () => {
    const { op, config } = fixture(),
      m = add(op, "RICH_TEXT");
    if (m.content.type === "RICH_TEXT")
      m.content.document = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [
              {
                type: "text",
                text: "<script>fictional</script>",
                marks: [{ type: "bold" }],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "List item" }],
                  },
                ],
              },
            ],
          },
        ],
      };
    const saved = saveOp(op);
    const view = project(
      saved,
      createExportProfile(saved, "opord", uid()),
      config,
    ).view;
    const html = renderModularHtml(view, "test");
    expect(html).toContain("<strong>&lt;script&gt;");
    expect(html).toContain("<ul>");
    expect(html).not.toContain("<script>");
    expect(repo.getOperation(op.id).modules).toEqual(saved.modules);
  });
  it("keeps linked chart facts in the source table and follows stable column IDs", () => {
    const { op, config } = fixture(),
      table = add(op, "TABLE"),
      chart = add(op, "CHART"),
      category = field("Category"),
      amount = field("Amount", "DECIMAL");
    table.localDefinition!.configuration.columns = [category, amount];
    if (table.content.type === "TABLE")
      table.content.rows = [
        {
          id: uid(),
          cells: { [category.id]: "Fictional sample", [amount.id]: 10 },
        },
      ];
    if (chart.content.type === "CHART")
      chart.content.source = {
        mode: "TABLE",
        moduleInstanceId: table.moduleInstanceId,
        categoryColumnId: category.id,
        valueColumnIds: [amount.id],
      };
    expect(renderModule(chart, op, config, [])).toContain("10");
    amount.label = "Renamed amount";
    expect(moduleFindings(op, config)).toEqual([]);
    if (table.content.type === "TABLE")
      table.content.rows[0].cells[amount.id] = 25;
    expect(renderModule(chart, op, config, [])).toContain("25");
    expect(JSON.stringify(chart.content)).not.toContain("Fictional sample");
    table.localDefinition!.configuration.columns = [category];
    expect(
      moduleFindings(op, config).some((f) =>
        f.message.includes("source column"),
      ),
    ).toBe(true);
  });
  it.each(["BAR", "LINE", "PIE", "SCATTER"])(
    "renders %s as a deterministic static SVG with accessible data",
    (type) => {
      const svg = chartSvg(type, [
        { label: "Fictional A", x: 1, value: 5, series: "Value" },
        { label: "Fictional B", x: 2, value: 10, series: "Value" },
      ]);
      expect(svg).toContain("<svg");
      expect(svg).toContain("<table>");
      expect(svg).not.toContain("<script");
    },
  );
  it("resolves H, H-30 and H+45 from the canonical event", () => {
    const { op, config } = fixture(),
      m = add(op, "TIMELINE"),
      event = op.events.find((e) => e.at)!;
    event.at = "2026-10-03T12:00:00.000Z";
    if (m.content.type === "TIMELINE")
      m.content.items = [0, -30, 45].map((offsetMinutes) => ({
        id: uid(),
        title: `Offset ${offsetMinutes}`,
        description: "",
        phaseId: null,
        timing: { mode: "RELATIVE", referenceEventId: event.id, offsetMinutes },
      }));
    let html = renderModule(m, op, config, []);
    expect(html).toContain("11:30:00");
    expect(html).toContain("12:45:00");
    event.at = "2026-10-03T14:00:00.000Z";
    html = renderModule(m, op, config, []);
    expect(html).toContain("13:30:00");
    expect(html).toContain("14:45:00");
  });
  it("dispatches legacy projections and preserves dependency-aware card staleness", () => {
    const { op, config } = fixture(),
      profile = createExportProfile(op, "communications-card", uid());
    const card = project(op, profile, config);
    add(op, "PLAIN_TEXT");
    expect(project(op, profile, config).dependencies).toEqual(
      card.dependencies,
    );
    expect(projectVersion(2, op, profile, config).dependencies).toEqual(
      projectVersion(3, op, profile, config).dependencies,
    );
    expect(projectionVersionFor(op)).toBe(4);
  });
  it("renames operation in a new revision without changing frozen publication/export names", () => {
    let { op, config } = fixture();
    const m = add(op, "PLAIN_TEXT");
    if (m.content.type === "PLAIN_TEXT")
      m.content.text = "Frozen original content";
    op.metadata.statusId = "approved";
    op = saveOp(op);
    service.execute({
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "Fictional test",
    });
    const pub = service.execute({
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    }).publications[0];
    const profile = repo
      .listExportProfiles(op.id)
      .find((p) => p.product === "opord")!;
    const exp = service.execute({
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: profile.id, version: profile.version },
      publicationId: pub.id,
    }).exports[0];
    op.name = "FICTIONAL NEW NAME";
    if (op.modules!.instances.at(-1)!.content.type === "PLAIN_TEXT")
      (
        op.modules!.instances.at(-1)!.content as {
          type: "PLAIN_TEXT";
          text: string;
        }
      ).text = "Live changed";
    op = saveOp(op);
    expect(op.id).toBe(pub.operationId);
    expect(op.revision).toBe(pub.sourceRevision + 1);
    expect(repo.listPublications(op.id)[0].snapshot.name).toBe(
      "FICTIONAL SILVER PINE",
    );
    expect(repo.listExports(op.id)[0].html).toBe(exp.html);
    expect(exp.projectionVersion).toBe(4);
    expect(exp.rendererVersion).toBe("html-v5");
    expect(exportStaleness(exp, op).outdated).toBe(true);
    expect(project(op, profile, config).view.operationName).toBe(op.name);
    repo.verifyAll();
  });
});
describe("assets, packages and recovery", () => {
  it("validates bytes/hash/MIME and stable ownership", () => {
    const { op } = fixture(),
      a = asset({ operationId: op.id, doctrineVersionId: null });
    repo.modular.insertAsset(a, png);
    expect(repo.assetData(a.assetId)).toContain("data:image/png;base64,");
    expect(() =>
      repo.modular.insertAsset(
        { ...a, assetId: uid(), sha256: "0".repeat(64) },
        png,
      ),
    ).toThrow();
    expect(() =>
      repo.sqlite
        .prepare("UPDATE managed_assets SET bytes=?")
        .run(Buffer.from("bad")),
    ).toThrow(/immutable/);
  });
  it("exports only doctrine-owned assets and installs atomically into a clean workspace", () => {
    let d = draft();
    const a = asset({
      operationId: null,
      doctrineVersionId: d.doctrineVersionId,
    });
    repo.modular.insertAsset(a, png);
    d.config.doctrine.modules!.assets.push(a);
    const def = newModuleDefinition("IMAGE", uid());
    def.configuration.defaultAssetIds = [a.assetId];
    d.config.doctrine.modules!.layouts = [
      { productId: null, definitions: [def] },
    ];
    d = publish(saveDoctrine(d));
    const op = service.execute({
      type: "create",
      name: "Fictional",
      demo: false,
      configuration: { id: d.config.organization.id, version: 1 },
    }).operation!;
    const privateAsset = asset({ operationId: op.id, doctrineVersionId: null });
    repo.modular.insertAsset(privateAsset, png);
    const pkg = repo.exportDoctrinePackage(d.doctrineVersionId);
    expect(JSON.stringify(pkg)).not.toContain(privateAsset.assetId);
    const clean = new SqliteRepository(":memory:");
    try {
      const imported = clean.importDoctrinePackage(pkg);
      expect(imported.sourceKind).toBe("IMPORTED");
      expect(imported.config).toEqual(d.config);
      expect(clean.assetData(a.assetId)).toBe(repo.assetData(a.assetId));
      expect(clean.importDoctrinePackage(pkg)).toEqual(imported);
      clean.verifyAll();
    } finally {
      clean.close();
    }
  });
  it("rejects hash mismatch, traversal, scripts, extra operation data and collision", () => {
    const d = publish(draft()),
      pkg = repo.exportDoctrinePackage(d.doctrineVersionId);
    const mismatch = structuredClone(pkg);
    mismatch.doctrine.description = "Mismatch";
    expect(() => repo.importDoctrinePackage(mismatch)).toThrow(/hash mismatch/);
    mismatch.contentHash = hashBytes(
      canonical({ doctrine: mismatch.doctrine, assets: mismatch.assets }),
    );
    expect(() => repo.importDoctrinePackage(mismatch)).toThrow(/collision/);
    expect(() =>
      repo.importDoctrinePackage({ ...pkg, operations: [] }),
    ).toThrow();
    const a = asset({
      operationId: null,
      doctrineVersionId: d.doctrineVersionId,
    });
    expect(() =>
      repo.modular.insertAsset(
        { ...a, originalFilename: "../escape.png" },
        png,
      ),
    ).toThrow();
    expect(() =>
      repo.modular.insertAsset({ ...a, originalFilename: "script.js" }, png),
    ).toThrow(/Executable/);
  });
  it("copies doctrine assets into the new version without changing the source", () => {
    let d = draft();
    const a = asset({
      operationId: null,
      doctrineVersionId: d.doctrineVersionId,
    });
    repo.modular.insertAsset(a, png);
    d.config.doctrine.modules!.assets = [a];
    const def = newModuleDefinition("IMAGE", uid());
    def.configuration.defaultAssetIds = [a.assetId];
    d.config.doctrine.modules!.layouts = [
      { productId: null, definitions: [def] },
    ];
    d = publish(saveDoctrine(d));
    const s = service.execute({
        type: "doctrine-create",
        sourceId: d.doctrineVersionId,
        name: d.displayName,
        versionLabel: "1.1.0",
        newFamily: false,
      }),
      next = s.doctrines.find(
        (v) => v.doctrineVersionId === s.selectedDoctrineId,
      )!;
    expect(next.config.doctrine.modules!.assets[0].assetId).not.toBe(a.assetId);
    expect(next.config.doctrine.modules!.assets[0].sha256).toBe(a.sha256);
    expect(
      next.config.doctrine.modules!.layouts[0].definitions[0].configuration
        .defaultAssetIds,
    ).toEqual([next.config.doctrine.modules!.assets[0].assetId]);
  });
  it("restores assets, doctrine versions, module content and hashes together", async () => {
    const folder = join(".test-data", `m3-recovery-${uid()}`);
    mkdirSync(folder, { recursive: true });
    const db = join(folder, "ordo.db"),
      backup = join(folder, "backup.db");
    await repo.backup(db);
    let current = new SqliteRepository(db);
    const s = makeService(current);
    const d = s.execute({
      type: "doctrine-create",
      sourceId: armyConfig.doctrine.id,
      name: "Fictional",
      versionLabel: "1.0.0",
      newFamily: true,
    });
    const version = d.doctrines.find(
      (v) => v.doctrineVersionId === d.selectedDoctrineId,
    )!;
    s.execute({
      type: "doctrine-publish",
      id: version.doctrineVersionId,
      expectedContentVersion: version.contentVersion,
    });
    let op = s.execute({
      type: "create",
      name: "Fictional recovery",
      demo: false,
      configuration: { id: version.config.organization.id, version: 1 },
    }).operation!;
    const a = asset({ operationId: op.id, doctrineVersionId: null });
    current.modular.insertAsset(a, png);
    op.modules!.assets.push(a);
    const m = add(op, "RICH_TEXT");
    if (m.content.type === "RICH_TEXT")
      m.content.document = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "image",
                attrs: { assetId: a.assetId, alt: "Fictional" },
              },
            ],
          },
        ],
      };
    op = s.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    await current.backup(backup);
    const after = asset({ operationId: op.id, doctrineVersionId: null });
    current.modular.insertAsset(after, png);
    await restoreWorkspace(current, db, backup, (next) => (current = next));
    current.close();
    current = new SqliteRepository(db, true);
    try {
      current.verifyAll();
      expect(current.getOperation(op.id)).toEqual(op);
      expect(current.assetData(a.assetId)).toContain(png.toString("base64"));
      expect(() => current.assetData(after.assetId)).toThrow(/Missing/);
    } finally {
      current.close();
    }
  });
  it("upgrades an actual 0.2.0 database without rewriting history", () => {
    const source = "tests/fixtures/milestone2-0.2.0.db",
      folder = join(".test-data", `m3-upgrade-${uid()}`);
    mkdirSync(folder, { recursive: true });
    const target = join(folder, "ordo.db");
    copyFileSync(source, target);
    const raw = new Database(target);
    const snapshot = () =>
      Object.fromEntries(
        [
          "operation_revisions",
          "profile_versions",
          "publications",
          "exports",
        ].map((t) => [t, raw.prepare(`SELECT * FROM ${t}`).all()]),
      );
    const before = snapshot();
    expect(
      raw
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .get(),
    ).toEqual({ version: 3 });
    raw.close();
    const upgraded = new SqliteRepository(target, true);
    try {
      upgraded.verifyAll();
      for (const [table, rows] of Object.entries(before))
        expect(upgraded.sqlite.prepare(`SELECT * FROM ${table}`).all()).toEqual(
          rows,
        );
      expect(
        upgraded.sqlite
          .prepare("SELECT MAX(version) AS version FROM schema_migrations")
          .get(),
      ).toEqual({ version: 20 });
    } finally {
      upgraded.close();
    }
  });
});
