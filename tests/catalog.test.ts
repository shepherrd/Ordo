import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { SqliteRepository } from "../src/persistence/repository";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { OrdoService } from "../src/application/service";
import { SymbologyService } from "../src/application/symbology-service";
import {
  CatalogService,
  catalogEditorDocument,
} from "../src/application/catalog-service";
import { catalogItemSchema, removeDoctrineStaff } from "../src/domain/catalog";
import { demoOperation } from "../src/demo/operation";
import { canonical } from "../src/export/projections/v1";
import { CatalogWorkspace } from "../src/application/catalog-workspace";
import { WorkspaceService } from "../src/application/workspace-service";
import { CatalogDeletion } from "../src/application/catalog-deletion";
import { newUnitProfile } from "../src/domain/unit-profiles";
import { createHash } from "node:crypto";
import { GraphicExportService } from "../src/application/graphic-export-service";
import {
  catalogGraphicCommand,
  catalogGraphicStaleness,
} from "../src/application/catalog-graphics";
import { renderSymbol } from "../src/rendering/symbol-renderer";
import { readSymbolTransfer } from "../src/renderer/src/symbol-transfer";
import {
  addCatalogOrbatRoot,
  editableOrbatSchema,
} from "../src/domain/catalog-orbat";
import {
  savedOrbatVersionSchema,
  type SavedOrbatVersion,
} from "../src/domain/orbat";
import { newSymbolDefinition } from "../src/domain/symbology";
import { validateWorkingDraft } from "../src/application/working-drafts";
let repo: SqliteRepository, catalog: CatalogService, legacy: SymbologyService;
const rt = { id, now: () => "2026-10-08T22:00:00.000Z", actor: "Catalog test" };
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  new OrdoService(repo, rt, (_n, c) => demoOperation(c, id, rt.now()));
  legacy = new SymbologyService(repo, rt);
  catalog = new CatalogService(repo, repo.catalog, rt);
});
afterEach(() => repo.close());
it("can create a new doctrine after every previous catalog doctrine has been deleted", () => {
  catalog.importLegacy();
  for (const e of repo.catalog.catalogList("DOCTRINE"))
    repo.catalog.catalogDelete(e.item.id, e.editToken);
  const next = catalog.execute({
    type: "create",
    kind: "DOCTRINE",
    name: "Fresh doctrine",
    empty: true,
  }).entry!;
  expect(
    next.item.kind === "DOCTRINE" &&
      next.item.content.config.doctrine.catalog?.nodes,
  ).toEqual([]);
  expect(catalog.importLegacy()).toBe(0);
  expect(repo.catalog.catalogList("DOCTRINE")).toHaveLength(1);
  repo.verifyAll();
});
it("resolves a dragged saved symbol by catalog identity instead of a consumption snapshot ID", async () => {
  const e = catalog.execute({
    type: "create",
    kind: "SYMBOL",
    name: "Drag source",
  }).entry!;
  const selected: string[] = [];
  const result = await readSymbolTransfer(
    JSON.stringify({ kind: "CATALOG", id: e.item.id }),
    {
      symbols: async (command: { id: string }) => {
        selected.push(command.id);
        return { pin: repo.resolveSymbolPin(catalog.snapshot(command.id)) };
      },
    } as never,
  );
  expect(selected).toEqual([e.item.id]);
  expect(result.source?.versionId).not.toBe(e.item.id);
  expect(result.definition).toEqual(
    e.item.kind === "SYMBOL" ? e.item.content.definition : null,
  );
});
it("imports every saved entry without modifying old records, and never resurrects deleted entries", () => {
  const a = legacy.execute({
    type: "new",
    kind: "SYMBOL",
    name: "Old saved symbol",
  }).symbol!;
  const b = legacy.execute({
    type: "publish",
    kind: "SYMBOL",
    id: a.versionId,
    expected: a.contentVersion,
  }).symbol!;
  const c = legacy.execute({
    type: "derive",
    kind: "SYMBOL",
    id: b.versionId,
    versionLabel: "2.0.0",
    newFamily: false,
  }).symbol!;
  const before = canonical([
    repo.getSymbol(b.versionId),
    repo.getSymbol(c.versionId),
  ]);
  expect(catalog.importLegacy()).toBe(4);
  expect(
    new Set(repo.catalog.catalogList("SYMBOL").map((e) => e.item.id)),
  ).toEqual(new Set([b.versionId, c.versionId]));
  expect(
    canonical([repo.getSymbol(b.versionId), repo.getSymbol(c.versionId)]),
  ).toBe(before);
  const e = repo.catalog.catalogGet(b.versionId);
  repo.catalog.catalogDelete(e.item.id, e.editToken);
  expect(catalog.importLegacy()).toBe(0);
  expect(repo.catalog.catalogList("SYMBOL")).toHaveLength(1);
});
it("saves in place with conflict protection and no lifecycle or stored versions", () => {
  let entry = catalog.execute({
    type: "create",
    kind: "SYMBOL",
    name: "Company",
  }).entry!;
  const initial = entry,
    item = structuredClone(entry.item);
  item.name = "Renamed company";
  entry = catalog.execute({
    type: "save",
    item,
    expectedToken: entry.editToken,
  }).entry!;
  expect(entry.item.id).toBe(initial.item.id);
  expect(entry.item.name).toBe("Renamed company");
  expect(entry.item).not.toHaveProperty("status");
  expect(entry.item).not.toHaveProperty("versionLabel");
  expect(
    repo.browseLibrary("SYMBOL", {
      search: "",
      status: "",
      offset: 0,
      limit: 100,
    }).total,
  ).toBe(0);
  expect(() =>
    catalog.execute({ type: "save", item, expectedToken: initial.editToken }),
  ).toThrow(/changed/);
  expect(() => catalog.execute({ type: "publish", id: item.id })).toThrow();
  expect(() =>
    catalogItemSchema.parse({ ...entry.item, status: "PUBLISHED" }),
  ).toThrow();
});
it("creates exact consumed snapshots only on use and keeps previous snapshots after editing", () => {
  let entry = catalog.execute({
    type: "create",
    kind: "SYMBOL",
    name: "Reference symbol",
  }).entry!;
  const first = catalog.snapshot(entry.item.id),
    before = canonical(repo.getSymbol(first));
  expect(catalog.snapshot(entry.item.id)).toBe(first);
  const item = structuredClone(entry.item);
  if (item.kind !== "SYMBOL") throw Error();
  item.content.definition.amplifiers.uniqueDesignation = "EDITED";
  entry = catalog.execute({
    type: "save",
    item,
    expectedToken: entry.editToken,
  }).entry!;
  const second = catalog.snapshot(entry.item.id);
  expect(second).not.toBe(first);
  expect(canonical(repo.getSymbol(first))).toBe(before);
  expect(repo.getSymbol(second).definition.amplifiers.uniqueDesignation).toBe(
    "EDITED",
  );
  expect(catalog.importLegacy()).toBe(2); // Only the two bundled doctrines, never hidden consumption snapshots.
  expect(repo.catalog.catalogList("SYMBOL")).toHaveLength(1);
  repo.verifyAll();
});
it("captures editable doctrines without changing any previously pinned configuration", () => {
  catalog.importLegacy();
  const initial = canonical(repo.getConfig());
  let entry = catalog.execute({
    type: "create",
    kind: "DOCTRINE",
    sourceId: armyConfig.doctrine.id,
    name: "My doctrine",
  }).entry!;
  const first = catalog.snapshot(entry.item.id),
    frozen = canonical(
      repo.listDoctrines().find((d) => d.doctrineVersionId === first),
    );
  const item = structuredClone(entry.item);
  if (item.kind !== "DOCTRINE") throw Error();
  item.content.config.doctrine.staff[0].name = "Planner-defined role";
  entry = catalog.execute({
    type: "save",
    item,
    expectedToken: entry.editToken,
  }).entry!;
  expect(catalog.snapshot(entry.item.id)).not.toBe(first);
  expect(
    canonical(repo.listDoctrines().find((d) => d.doctrineVersionId === first)),
  ).toBe(frozen);
  expect(canonical(repo.getConfig())).toBe(initial);
  repo.verifyAll();
});
it("removes a custom or original staff role together with its current assignment references", () => {
  catalog.importLegacy();
  const item = repo.catalog.catalogGet(armyConfig.doctrine.id).item;
  if (item.kind !== "DOCTRINE") throw Error();
  const next = removeDoctrineStaff(item, "ops");
  catalog.validate(next);
  expect(next.content.config.doctrine.staff.some((s) => s.id === "ops")).toBe(
    false,
  );
  expect(
    next.content.config.doctrine.catalog!.nodes.some((n) =>
      n.responsibleStaff.includes("ops"),
    ),
  ).toBe(false);
  expect(item.content.config.doctrine.staff.some((s) => s.id === "ops")).toBe(
    true,
  );
});
it("includes current child content in an organization snapshot key and rejects cycles", () => {
  const child = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "Child",
  }).entry!;
  let parent = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "Parent",
  }).entry!;
  const item = structuredClone(parent.item);
  if (item.kind !== "ORGANIZATION") throw Error();
  item.content.standingSubordinates = [
    {
      relationshipId: id(),
      unitProfileFamilyId: child.item.id,
      unitProfileVersionId: child.item.id,
    },
  ];
  parent = catalog.execute({
    type: "save",
    item,
    expectedToken: parent.editToken,
  }).entry!;
  const first = catalog.snapshot(parent.item.id),
    frozen = canonical(repo.getUnitProfile(first));
  const changed = structuredClone(child.item);
  if (changed.kind !== "ORGANIZATION") throw Error();
  changed.name = changed.content.identity.fullDesignation = "Renamed child";
  catalog.execute({
    type: "save",
    item: changed,
    expectedToken: child.editToken,
  });
  expect(catalog.snapshot(parent.item.id)).not.toBe(first);
  expect(canonical(repo.getUnitProfile(first))).toBe(frozen);
  const cycle = repo.catalog.catalogGet(child.item.id);
  if (cycle.item.kind !== "ORGANIZATION") throw Error();
  cycle.item.content.standingSubordinates = [
    {
      relationshipId: id(),
      unitProfileFamilyId: parent.item.id,
      unitProfileVersionId: parent.item.id,
    },
  ];
  expect(() =>
    catalog.execute({
      type: "save",
      item: cycle.item,
      expectedToken: cycle.editToken,
    }),
  ).toThrow(/cycle/);
  repo.verifyAll();
});
it("validates ORBAT structure even though content has no library lifecycle", () => {
  const entry = catalog.execute({
    type: "create",
    kind: "ORBAT",
    name: "Hierarchy",
  }).entry!;
  const item = structuredClone(entry.item);
  if (item.kind !== "ORBAT") throw Error();
  item.content.nodes = addCatalogOrbatRoot(
    catalogEditorDocument(entry.item) as SavedOrbatVersion,
    { definition: newSymbolDefinition(id), source: null },
    "Fictional root",
    id,
    rt.now(),
  ).nodes;
  item.content.nodes[0].parentNodeId = item.content.rootNodeId;
  expect(() =>
    catalog.execute({ type: "save", item, expectedToken: entry.editToken }),
  ).toThrow();
  expect(catalogEditorDocument(entry.item)).toHaveProperty("rootNodeId");
});
it("uses saved catalogs directly for symbol selection, organization and operation creation", () => {
  catalog.importLegacy();
  const ops = new OrdoService(repo, rt, (_n, c) =>
    demoOperation(c, id, rt.now()),
  );
  const app = new CatalogWorkspace(
    catalog,
    repo,
    ops,
    new WorkspaceService(repo, rt),
    legacy,
  );
  const symbol = app.symbolCommand({
    type: "new",
    kind: "SYMBOL",
    name: "Division",
  }).symbol!;
  symbol.definition.amplifiers.uniqueDesignation = "38 MID";
  app.symbolCommand({
    type: "save-symbol",
    value: symbol,
    expected: symbol.contentVersion,
  });
  const pin = app.symbolCommand({
    type: "symbol-pin",
    id: symbol.versionId,
  }).pin!;
  let p = app.workspaceCommand({
    type: "unit-profile-new",
    name: "38th Division",
  }).profile!;
  p = { ...p, schemaVersion: 2, defaultSymbol: pin };
  p.defaultDoctrine = {
    doctrineFamilyId: armyConfig.doctrine.id,
    doctrineVersionId: armyConfig.doctrine.id,
    profileVersion: 1,
    configuration: { id: armyConfig.doctrine.id, version: 1 },
  };
  p = app.workspaceCommand({
    type: "unit-profile-save",
    profile: p,
    expectedContentVersion: p.contentVersion,
  }).profile!;
  const state = app.execute({
    type: "create",
    name: "Catalog independence",
    demo: false,
    configuration: { id: armyConfig.doctrine.id, version: 1 },
    unitProfileVersionId: p.unitProfileVersionId,
    initializeTaskOrganization: true,
  });
  expect(state.operation!.units[0].name).toBe("38th Division");
  const before = canonical(repo.getOperation(state.operation!.id));
  p.identity.fullDesignation = "Renamed division";
  app.workspaceCommand({
    type: "unit-profile-save",
    profile: p,
    expectedContentVersion: p.contentVersion,
  });
  expect(canonical(repo.getOperation(state.operation!.id))).toBe(before);
  expect(
    app.symbolCommand({
      type: "browse",
      kind: "SYMBOL",
      query: { search: "", status: "", offset: 0, limit: 20 },
    }).page!.total,
  ).toBe(1);
  expect(() =>
    app.symbolCommand({
      type: "publish",
      kind: "SYMBOL",
      id: symbol.versionId,
      expected: 1,
    }),
  ).toThrow(/directly/);
  repo.verifyAll();
});
it("deletes current catalog records permanently while protecting current relationships", () => {
  catalog.importLegacy();
  const deletion = new CatalogDeletion(repo, repo.catalog);
  const child = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "Child",
  }).entry!;
  const parent = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "Parent",
  }).entry!;
  if (parent.item.kind !== "ORGANIZATION") throw Error();
  parent.item.content.standingSubordinates = [
    {
      relationshipId: id(),
      unitProfileFamilyId: child.item.id,
      unitProfileVersionId: child.item.id,
    },
  ];
  catalog.execute({
    type: "save",
    item: parent.item,
    expectedToken: parent.editToken,
  });
  expect(
    deletion.prepareDeletion({ kind: "unit-profile", id: child.item.id })
      .blockers,
  ).toHaveLength(1);
  const target = { kind: "unit-profile" as const, id: parent.item.id },
    preview = deletion.prepareDeletion(target);
  deletion.permanentlyDelete(target, preview.fingerprint);
  expect(repo.catalog.catalogFind(parent.item.id)).toBeNull();
  expect(catalog.importLegacy()).toBe(0);
  repo.verifyAll();
});
it("creates one attachment owner without accumulating a history on subsequent edits", () => {
  catalog.importLegacy();
  for (const kind of ["DOCTRINE", "ORGANIZATION"] as const) {
    const entry = catalog.execute({
      type: "create",
      kind,
      name: "Attachment owner",
      ...(kind === "DOCTRINE" ? { sourceId: armyConfig.doctrine.id } : {}),
    }).entry!;
    const owner = catalog.assetOwner(entry.item.id);
    expect(catalog.assetOwner(entry.item.id)).toBe(owner);
    expect(catalog.importLegacy()).toBe(0);
    expect(
      repo.catalog.catalogList(kind).filter((e) => e.item.id === owner),
    ).toHaveLength(0);
  }
  repo.verifyAll();
});
it("converts a matching recoverable library edit without saving or dropping the user's work", () => {
  const old = legacy.execute({
      type: "new",
      kind: "SYMBOL",
      name: "Original",
    }).symbol!,
    edited = structuredClone(old);
  edited.name = "Unsaved name";
  const key = { kind: "symbol" as const, id: old.versionId, scope: null };
  repo.putWorkingDraft(
    {
      ...key,
      schemaVersion: 1,
      label: "Recovery",
      source: canonical(old),
      value: canonical(edited),
      sequence: 1,
      updatedAt: rt.now(),
    },
    0,
  );
  catalog = new CatalogService(repo, repo.catalog, rt, repo);
  catalog.importLegacy();
  const recovered = repo.getWorkingDraft(key)!;
  expect(JSON.parse(recovered.value).name).toBe("Unsaved name");
  expect(JSON.parse(recovered.source)).toEqual(
    catalogEditorDocument(repo.catalog.catalogGet(old.versionId).item),
  );
  expect(repo.catalog.catalogGet(old.versionId).item.name).toBe("Original");
  expect(repo.getSymbol(old.versionId)).toEqual(old);
  repo.verifyAll();
});
it("preserves already pinned retired symbols when consuming or copying an old organization", () => {
  const s = legacy.execute({
    type: "new",
    kind: "SYMBOL",
    name: "Historical",
  }).symbol!;
  legacy.execute({
    type: "publish",
    kind: "SYMBOL",
    id: s.versionId,
    expected: s.contentVersion,
  });
  const p = {
    ...newUnitProfile("Existing organization", id, rt.now()),
    schemaVersion: 2 as const,
    defaultSymbol: repo.resolveSymbolPin(s.versionId),
  };
  repo.saveUnitProfile(p, null);
  legacy.execute({ type: "retire", kind: "SYMBOL", id: s.versionId });
  catalog.importLegacy();
  const copy = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "Copied organization",
    sourceId: p.unitProfileVersionId,
  }).entry!;
  for (const itemId of [p.unitProfileVersionId, copy.item.id]) {
    const consumed = repo.getUnitProfile(catalog.snapshot(itemId));
    expect(consumed.schemaVersion === 2 && consumed.defaultSymbol).toEqual(
      p.defaultSymbol,
    );
  }
  repo.verifyAll();
});
it("copies insignia bytes into a consumed snapshot and protects a current asset from deletion", () => {
  const e = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "With insignia",
  }).entry!;
  if (e.item.kind !== "ORGANIZATION") throw Error();
  const owner = catalog.assetOwner(e.item.id),
    assetId = id(),
    bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
  repo.modular.insertAsset(
    {
      assetId,
      operationId: null,
      doctrineVersionId: null,
      unitProfileVersionId: owner,
      originalFilename: "fictional.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      createdAt: rt.now(),
      storageReference: `asset:${assetId}`,
    },
    bytes,
  );
  e.item.content.insigniaAssetId = assetId;
  catalog.execute({ type: "save", item: e.item, expectedToken: e.editToken });
  const snapshot = repo.getUnitProfile(catalog.snapshot(e.item.id));
  expect(snapshot.insigniaAssetId).not.toBe(assetId);
  expect(repo.assetData(snapshot.insigniaAssetId!)).toBe(
    repo.assetData(assetId),
  );
  expect(
    new CatalogDeletion(repo, repo.catalog).prepareDeletion({
      kind: "asset",
      id: assetId,
    }).blockers.length,
  ).toBeGreaterThan(0);
  repo.verifyAll();
});
it("removes obsolete current staff assignments when deleting a doctrine role and retains old consumed copies", () => {
  catalog.importLegacy();
  const d = repo.catalog.catalogGet(armyConfig.doctrine.id),
    p = catalog.execute({
      type: "create",
      kind: "ORGANIZATION",
      name: "Staff organization",
    }).entry!;
  if (d.item.kind !== "DOCTRINE" || p.item.kind !== "ORGANIZATION")
    throw Error();
  const staffId = d.item.content.config.doctrine.staff[0].id;
  p.item.content.roleMappings = [
    {
      doctrineFamilyId: d.item.id,
      doctrineVersion: 1,
      staffId,
      functionalRole: "COMMAND",
    },
  ];
  catalog.execute({ type: "save", item: p.item, expectedToken: p.editToken });
  const snapshot = catalog.snapshot(p.item.id);
  catalog.execute({
    type: "save",
    item: removeDoctrineStaff(d.item, staffId),
    expectedToken: d.editToken,
  });
  const current = repo.catalog.catalogGet(p.item.id).item;
  expect(
    current.kind === "ORGANIZATION" && current.content.roleMappings,
  ).toEqual([]);
  expect(repo.getUnitProfile(snapshot).roleMappings).toHaveLength(1);
  repo.verifyAll();
});
it("rejects a structurally invalid catalog during backup/restore integrity verification", () => {
  const e = catalog.execute({
    type: "create",
    kind: "ORBAT",
    name: "Invalid graph",
  }).entry!;
  if (e.item.kind !== "ORBAT") throw Error();
  e.item.content.nodes = addCatalogOrbatRoot(
    catalogEditorDocument(e.item) as SavedOrbatVersion,
    { definition: newSymbolDefinition(id), source: null },
    "Fictional root",
    id,
    rt.now(),
  ).nodes;
  e.item.content.nodes[0].parentNodeId = e.item.content.rootNodeId;
  repo.catalog.catalogSave(e.item, e.editToken);
  expect(() => repo.verifyAll()).toThrow();
});
it("tracks only consumed current symbol fields for graphics and retains native exchange dependencies", async () => {
  let e = catalog.execute({
    type: "create",
    kind: "SYMBOL",
    name: "Editable graphic",
  }).entry!;
  const graphics = new GraphicExportService(
    repo,
    rt,
    {
      render: async (r) => {
        if (r.kind !== "SYMBOL") throw Error();
        return { kind: "SYMBOL", result: renderSymbol(r.input) };
      },
    },
    {
      rasterize: async () => {
        throw Error();
      },
    } as never,
  );
  const profile = {
    schemaVersion: 1 as const,
    id: id(),
    version: 1,
    name: "Catalog graphic",
    product: "SYMBOL" as const,
    format: "SVG" as const,
    scale: 1,
    background: "TRANSPARENT" as const,
    size: 100,
    foldPolicy: "AS_SHOWN" as const,
    ancestorPolicy: "BOUNDARY" as const,
    selectedUnitIds: null,
    renderProfile: { id: "ordo-symbol" as const, version: 1 },
  };
  const command = (format: "SVG" | "JSON", jsonMode?: "NATIVE_EXCHANGE") =>
    catalogGraphicCommand(
      {
        source: {
          kind: "SAVED_SYMBOL",
          versionId: e.item.id,
          expectedContentVersion: Date.parse(e.item.updatedAt),
        },
        profile: {
          ...profile,
          id: id(),
          format,
          ...(jsonMode ? { jsonMode } : {}),
        },
      },
      catalog,
    );
  const svg = await graphics.generate(command("SVG")),
    native = await graphics.generate(command("JSON", "NATIVE_EXCHANGE"));
  expect(catalogGraphicStaleness(svg, repo, catalog).outdated).toBe(false);
  e.item.name = "Renamed catalog entry";
  e = catalog.execute({
    type: "save",
    item: e.item,
    expectedToken: e.editToken,
  }).entry!;
  expect(catalogGraphicStaleness(svg, repo, catalog).outdated).toBe(false);
  expect(catalogGraphicStaleness(native, repo, catalog).outdated).toBe(true);
  if (e.item.kind !== "SYMBOL") throw Error();
  e.item.content.definition.amplifiers.uniqueDesignation =
    "Changed symbol label";
  catalog.execute({ type: "save", item: e.item, expectedToken: e.editToken });
  expect(catalogGraphicStaleness(svg, repo, catalog).outdated).toBe(true);
  repo.verifyAll();
});
it("saves an empty ORBAT without manufacturing a unit or a historical snapshot", () => {
  const entry = catalog.execute({
    type: "create",
    kind: "ORBAT",
    name: "Empty map",
  }).entry!;
  if (entry.item.kind !== "ORBAT") throw Error();
  expect(entry.item.content.nodes).toEqual([]);
  const source = catalogEditorDocument(entry.item) as SavedOrbatVersion;
  expect(editableOrbatSchema.safeParse(source).success).toBe(true);
  expect(savedOrbatVersionSchema.safeParse(source).success).toBe(false);
  expect(() => catalog.snapshot(entry.item.id)).toThrow(/Add a root unit/);
  expect(
    repo.browseLibrary("ORBAT", {
      search: "",
      status: "",
      offset: 0,
      limit: 100,
    }).total,
  ).toBe(0);
  const renamed = structuredClone(entry.item);
  renamed.name = "Empty renamed";
  const saved = catalog.execute({
    type: "save",
    item: renamed,
    expectedToken: entry.editToken,
  }).entry!;
  expect(saved.item.content).toEqual(entry.item.content);
  const bad = structuredClone(saved.item);
  if (bad.kind !== "ORBAT") throw Error();
  bad.content.layout.siblingOrder = [bad.content.rootNodeId];
  expect(() =>
    catalog.execute({
      type: "save",
      item: bad,
      expectedToken: saved.editToken,
    }),
  ).toThrow();
  repo.verifyAll();
});
it("adds the first dragged symbol as the only real root and retains exact independent symbol content", () => {
  const entry = catalog.execute({
    type: "create",
    kind: "ORBAT",
    name: "Map title is not a unit",
  }).entry!;
  const symbol = catalog.execute({
    type: "create",
    kind: "SYMBOL",
    name: "Fictional Division",
  }).entry!;
  const pin = repo.resolveSymbolPin(catalog.snapshot(symbol.item.id));
  const source = catalogEditorDocument(entry.item) as SavedOrbatVersion;
  const root = addCatalogOrbatRoot(
    source,
    {
      definition: pin.definition,
      source: {
        familyId: pin.familyId,
        versionId: pin.versionId,
        contentHash: pin.contentHash,
      },
    },
    symbol.item.name,
    id,
    rt.now(),
  );
  expect(source.nodes).toEqual([]);
  expect(root.nodes).toHaveLength(1);
  expect(root.nodes[0]).toMatchObject({
    nodeId: source.rootNodeId,
    parentNodeId: null,
    unit: {
      identity: { fullDesignation: "Fictional Division" },
      symbol: { definition: pin.definition },
    },
  });
  expect(() =>
    addCatalogOrbatRoot(
      root,
      { definition: pin.definition, source: null },
      "Duplicate",
      id,
      rt.now(),
    ),
  ).toThrow();
  validateWorkingDraft({
    schemaVersion: 1,
    kind: "orbat",
    id: entry.item.id,
    scope: null,
    label: entry.item.name,
    source: canonical(source),
    value: canonical(root),
    sequence: 1,
    updatedAt: rt.now(),
  });
  const app = new CatalogWorkspace(
    catalog,
    repo,
    new OrdoService(repo, rt, (_name, config) =>
      demoOperation(config, id, rt.now()),
    ),
    new WorkspaceService(repo, rt),
    legacy,
  );
  const saved = app.symbolCommand({
    type: "save-orbat",
    value: root,
    expected: source.contentVersion,
  }).orbat!;
  expect(saved.nodes).toEqual(root.nodes);
  expect(repo.getOrbat(catalog.snapshot(entry.item.id)).nodes).toEqual(
    root.nodes,
  );
  // Undoing the first addition can be saved as empty; retained consumed trees stay valid.
  const retained = catalog.snapshot(entry.item.id);
  const empty = { ...saved, nodes: [] };
  app.symbolCommand({
    type: "save-orbat",
    value: empty,
    expected: saved.contentVersion,
  });
  expect(
    app.symbolCommand({ type: "get", kind: "ORBAT", id: entry.item.id }).orbat!
      .nodes,
  ).toEqual([]);
  expect(repo.getOrbat(retained).nodes).toEqual(root.nodes);
  expect(() => catalog.snapshot(entry.item.id)).toThrow(/Add a root unit/);
  repo.verifyAll();
});
it("restores an empty catalog map and its unsaved first-root recovery copy from a database backup", async () => {
  const entry = catalog.execute({
    type: "create",
    kind: "ORBAT",
    name: "Empty backup map",
  }).entry!;
  const source = catalogEditorDocument(entry.item) as SavedOrbatVersion;
  const root = addCatalogOrbatRoot(
    source,
    { definition: newSymbolDefinition(id), source: null },
    "Fictional recovered root",
    id,
    rt.now(),
  );
  const key = { kind: "orbat" as const, id: entry.item.id, scope: null };
  repo.putWorkingDraft(
    {
      ...key,
      schemaVersion: 1,
      label: entry.item.name,
      source: canonical(source),
      value: canonical(root),
      sequence: 1,
      updatedAt: rt.now(),
    },
    0,
  );
  const file = resolve(".test-data", `empty-orbat-backup-${id()}.db`);
  mkdirSync(dirname(file), { recursive: true });
  await repo.backup(file);
  const restored = new SqliteRepository(file);
  try {
    restored.verifyAll();
    const item = restored.catalog.catalogGet(entry.item.id).item;
    expect(item.kind === "ORBAT" && item.content.nodes).toEqual([]);
    const recovery = restored.getWorkingDraft(key)!;
    validateWorkingDraft(recovery);
    expect(JSON.parse(recovery.value).nodes).toEqual(root.nodes);
    expect(
      restored.browseLibrary("ORBAT", {
        search: "",
        status: "",
        offset: 0,
        limit: 100,
      }).total,
    ).toBe(0);
  } finally {
    restored.close();
  }
});
