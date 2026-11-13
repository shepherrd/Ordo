import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { SqliteRepository } from "../src/persistence/repository";
import {
  CatalogService,
  catalogEditorDocument,
} from "../src/application/catalog-service";
import {
  organizationCommand,
  organizationDocument,
} from "../src/application/organization-service";
import { CatalogWorkspace } from "../src/application/catalog-workspace";
import { CatalogDeletion } from "../src/application/catalog-deletion";
import { WorkspaceService } from "../src/application/workspace-service";
import { OrdoService } from "../src/application/service";
import { SymbologyService } from "../src/application/symbology-service";
import {
  WorkingDraftService,
  validateWorkingDraft,
} from "../src/application/working-drafts";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { newUnitProfile } from "../src/domain/unit-profiles";
import { newSymbolDefinition } from "../src/domain/symbology";
import { addCatalogOrbatRoot } from "../src/domain/catalog-orbat";
import { type SavedOrbatVersion, type OrbatNode } from "../src/domain/orbat";
import {
  organizationUnit,
  organizationDiagram,
  type OrganizationProfile,
} from "../src/domain/organization-orbat";
import { canonical } from "../src/export/projections/v1";
import { SearchService } from "../src/application/search-service";
import { SearchStore } from "../src/persistence/search-store";
import { searchRequestSchema } from "../src/domain/search";
import { catalogSearchDocuments } from "../src/domain/search-documents";

const rt = {
  id,
  now: () => "2026-10-13T12:00:00.000Z",
  actor: "Organization ORBAT test",
};
let repo: SqliteRepository, catalog: CatalogService, app: CatalogWorkspace;
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  const operations = new OrdoService(repo, rt, (_n, c) =>
    demoOperation(c, id, rt.now()),
  );
  catalog = new CatalogService(repo, repo.catalog, rt, repo);
  catalog.importLegacy();
  app = new CatalogWorkspace(
    catalog,
    repo,
    operations,
    new WorkspaceService(repo, rt),
    new SymbologyService(repo, rt),
  );
});
afterEach(() => repo.close());
const save = (profile: OrganizationProfile) =>
  organizationCommand(catalog, {
    type: "save",
    profile,
    expectedContentVersion: profile.contentVersion,
  });
function fixture() {
  const map = catalog.execute({
    type: "create",
    kind: "ORBAT",
    name: "Fictional shared formation",
  }).entry!;
  const empty = catalogEditorDocument(map.item) as SavedOrbatVersion;
  const tree = addCatalogOrbatRoot(
    empty,
    { definition: newSymbolDefinition(id), source: null },
    "Formation HQ",
    id,
    rt.now(),
  );
  const child: OrbatNode = {
    nodeId: id(),
    parentNodeId: tree.rootNodeId,
    unit: {
      kind: "INLINE_UNIT",
      identity: newUnitProfile("Fictional Relief Company", id, rt.now())
        .identity,
      symbol: { definition: newSymbolDefinition(id), source: null },
    },
    nameOverride: null,
    annotation: "",
    symbolOverride: null,
  };
  tree.nodes.push(child);
  const saved = app.symbolCommand({
    type: "save-orbat",
    value: tree,
    expected: empty.contentVersion,
  }).orbat!;
  const create = (name: string) => {
    const entry = catalog.execute({
      type: "create",
      kind: "ORGANIZATION",
      name,
    }).entry!;
    const p = organizationDocument(catalog, entry.item.id);
    p.orbatWorkspace = { orbatId: map.item.id, profiles: [] };
    return save(p);
  };
  return {
    tree: saved,
    child,
    a: create("Fictional North Division"),
    b: create("Fictional South Division"),
  };
}
function withPerson(
  p: OrganizationProfile,
  tree: SavedOrbatVersion,
  node: OrbatNode,
  name: string,
) {
  const next = structuredClone(p),
    unit = structuredClone(
      organizationUnit(next.orbatWorkspace, tree.versionId, node),
    ),
    sectionId = id();
  unit.staff = {
    sections: [{ sectionId, name: "Headquarters", description: "" }],
    positions: [
      {
        positionId: id(),
        sectionId,
        title: "Commander",
        shortTitle: "CO",
        functionalRole: "COMMAND",
        defaultForRole: true,
        description: "",
        notes: "",
        rankGrade: "Captain",
        incumbent: { name, rank: "Captain", contact: "", notes: "" },
      },
    ],
  };
  next.orbatWorkspace!.profiles = [unit];
  return next;
}
it("keeps profiles and personnel organization-owned while both organizations read the same saved tree", () => {
  const { tree, child, a, b } = fixture();
  const updated = save(withPerson(a, tree, child, "Alex North"));
  expect(
    organizationUnit(updated.orbatWorkspace, tree.versionId, child).staff
      .positions[0].incumbent?.name,
  ).toBe("Alex North");
  expect(
    organizationUnit(b.orbatWorkspace, tree.versionId, child).staff.positions,
  ).toEqual([]);
  const other = save(withPerson(b, tree, child, "Blair South"));
  expect(
    other.orbatWorkspace?.profiles[0].staff.positions[0].incumbent?.name,
  ).toBe("Blair South");
  expect(organizationDocument(catalog, a.unitProfileVersionId)).toEqual(
    updated,
  );
  expect(
    app.symbolCommand({ type: "get", kind: "ORBAT", id: tree.versionId }).orbat,
  ).toEqual(tree);
  repo.verifyAll();
});
it("previews the live assigned ORBAT count, including its root and nested units, without counting retained profiles or creating snapshots", () => {
  const { tree, child, a } = fixture();
  const p = save(withPerson(a, tree, child, "Alex North"));
  const preview = () =>
    app.workspaceCommand({
      type: "unit-profile-get",
      id: p.unitProfileVersionId,
    });
  expect(preview().profile?.standingSubordinates).toEqual([]);
  expect(preview().assignedOrbat).toEqual({
    name: tree.name,
    unitCount: 2,
  });
  const grandchild = {
    ...structuredClone(child),
    nodeId: id(),
    parentNodeId: child.nodeId,
  };
  let current = app.symbolCommand({
    type: "save-orbat",
    value: { ...tree, nodes: [...tree.nodes, grandchild] },
    expected: tree.contentVersion,
  }).orbat!;
  expect(preview().assignedOrbat?.unitCount).toBe(3);
  current = app.symbolCommand({
    type: "save-orbat",
    value: { ...current, nodes: [tree.nodes[0]] },
    expected: current.contentVersion,
  }).orbat!;
  expect(preview().assignedOrbat?.unitCount).toBe(1);
  expect(
    organizationDocument(catalog, p.unitProfileVersionId).orbatWorkspace
      ?.profiles,
  ).toHaveLength(1);
  app.symbolCommand({
    type: "save-orbat",
    value: { ...current, nodes: [] },
    expected: current.contentVersion,
  });
  expect(preview().assignedOrbat?.unitCount).toBe(0);
  expect(repo.catalog.catalogSnapshotCount(p.unitProfileVersionId)).toBe(0);
  expect(repo.catalog.catalogSnapshotCount(tree.versionId)).toBe(0);
  repo.verifyAll();
});
it("updates picker counts when an organization switches or unassigns its ORBAT, preserving legacy standing relationships", () => {
  const { tree, a, b } = fixture();
  const empty = catalogEditorDocument(
    catalog.execute({
      type: "create",
      kind: "ORBAT",
      name: "Alternate formation",
    }).entry!.item,
  ) as SavedOrbatVersion;
  const alternate = app.symbolCommand({
    type: "save-orbat",
    value: addCatalogOrbatRoot(
      empty,
      { definition: newSymbolDefinition(id), source: null },
      "Alternate unit",
      id,
      rt.now(),
    ),
    expected: empty.contentVersion,
  }).orbat!;
  a.standingSubordinates = [
    {
      relationshipId: id(),
      unitProfileFamilyId: b.unitProfileFamilyId,
      unitProfileVersionId: b.unitProfileVersionId,
    },
  ];
  a.orbatWorkspace!.orbatId = alternate.versionId;
  let current = save(a);
  const preview = () =>
    app.workspaceCommand({
      type: "unit-profile-get",
      id: current.unitProfileVersionId,
    });
  expect(preview().assignedOrbat).toEqual({
    name: "Alternate formation",
    unitCount: 1,
  });
  current.orbatWorkspace!.orbatId = null;
  current = save(current);
  expect(preview().assignedOrbat).toBeUndefined();
  expect(preview().profile?.standingSubordinates).toHaveLength(1);
  current.orbatWorkspace!.orbatId = tree.versionId;
  save(current);
  expect(preview().assignedOrbat?.unitCount).toBe(2);
});

it("uses only active relationships for parent listings and cycle checks, including when unassigning an ORBAT", () => {
  const { a, b } = fixture();
  const relation = (p: OrganizationProfile) => ({
    relationshipId: id(),
    unitProfileFamilyId: p.unitProfileFamilyId,
    unitProfileVersionId: p.unitProfileVersionId,
  });
  a.standingSubordinates = [relation(b)];
  const current = save(a);
  b.orbatWorkspace!.orbatId = null;
  b.standingSubordinates = [relation(a)];
  save(b); // B -> A -> assigned ORBAT, not B -> A -> retained B.
  const rows = app.workspaceCommand({
    type: "browse-unit-profiles",
    query: {
      search: "",
      status: "",
      echelon: "",
      sort: "name",
      offset: 0,
      limit: 20,
    },
  }).organizations!.items;
  expect(
    rows.find((p) => p.unitProfileVersionId === a.unitProfileVersionId)
      ?.parentNames,
  ).toBe(b.identity.fullDesignation);
  expect(
    rows.find((p) => p.unitProfileVersionId === b.unitProfileVersionId)
      ?.parentNames,
  ).toBe("");
  const operation = app.execute({
    type: "create",
    name: "Mixed hierarchy",
    demo: false,
    unitProfileVersionId: b.unitProfileVersionId,
    initializeTaskOrganization: true,
  }).operation!;
  expect(operation.units.map((u) => u.name)).toEqual([
    b.identity.fullDesignation,
    a.identity.fullDesignation,
    "Formation HQ",
    "Fictional Relief Company",
  ]);
  expect(operation.units.map((u) => u.parentUnitId)).toEqual([
    null,
    operation.units[0].id,
    operation.units[1].id,
    operation.units[2].id,
  ]);
  current.orbatWorkspace!.orbatId = null;
  expect(() => save(current)).toThrow(/cycle/);
  expect(
    organizationDocument(catalog, a.unitProfileVersionId).orbatWorkspace
      ?.orbatId,
  ).toBe(a.orbatWorkspace!.orbatId);
  const invalid = organizationDocument(catalog, a.unitProfileVersionId);
  invalid.standingSubordinates[0].unitProfileVersionId = id();
  expect(() => save(invalid)).toThrow(/available organization/);
});

it("searches every assigned unit, refreshes dependent organizations atomically and invalidates old search hits", () => {
  const { tree, child, a, b } = fixture();
  const service = new SearchService(repo.search, "fixture");
  const query = (query: string) =>
    service.query(
      searchRequestSchema.parse({
        query,
        type: "organization",
        sequence: 1,
      }),
    ).hits;
  const initial = query("Fictional Relief Company");
  expect(initial.map((h) => h.owner).sort()).toEqual(
    [a, b].map((p) => "catalog:" + p.unitProfileVersionId).sort(),
  );
  expect(query("Formation HQ")).toHaveLength(2);
  const local = withPerson(a, tree, child, "Alex North");
  local.orbatWorkspace!.profiles[0].identity.fullDesignation =
    "Organization Rescue Company";
  save(local);
  tree.nodes[1].nameOverride = "Shared Medical Company";
  const changed = app.symbolCommand({
    type: "save-orbat",
    value: tree,
    expected: tree.contentVersion,
  }).orbat!;
  expect(query("Shared Medical Company").map((h) => h.owner)).toEqual([
    "catalog:" + b.unitProfileVersionId,
  ]);
  expect(query("Organization Rescue Company").map((h) => h.owner)).toEqual([
    "catalog:" + a.unitProfileVersionId,
  ]);
  expect(query("Alex North")).toHaveLength(1);
  expect(query("Fictional Relief Company")).toHaveLength(0);
  expect(() =>
    service.resolve({
      target: initial[1].target,
      sourceToken: initial[1].sourceToken,
      workspaceGeneration: "fixture",
    }),
  ).toThrow(/source changed/);
  const before = query("Shared Medical Company");
  expect(() =>
    repo.transaction(() => {
      changed.nodes[1].nameOverride = "Rolled back unit";
      app.symbolCommand({
        type: "save-orbat",
        value: changed,
        expected: changed.contentVersion,
      });
      throw Error("abort");
    }),
  ).toThrow("abort");
  expect(query("Shared Medical Company")).toEqual(before);
  expect(query("Rolled back unit")).toEqual([]);
  app.symbolCommand({
    type: "save-orbat",
    value: { ...changed, nodes: [changed.nodes[0]] },
    expected: changed.contentVersion,
  });
  expect(query("Shared Medical Company")).toEqual([]);
  expect(query("Organization Rescue Company")).toHaveLength(1); // Retained and still editable.
  expect(query("Alex North")).toHaveLength(1);
  expect(repo.catalog.catalogSnapshotCount(a.unitProfileVersionId)).toBe(0);
  repo.verifyAll();
});

it("rebuilds organization search from live ORBAT dependencies and resolves unsaved overrides without duplicate hits", () => {
  const { tree, child, a } = fixture();
  const item = repo.catalog.catalogGet(a.unitProfileVersionId).item;
  const prior = catalogSearchDocuments(item, "old");
  repo.search.replace("catalog:" + item.id, "old", prior);
  repo.sqlite.prepare("UPDATE search_owners SET format=3").run();
  const rebuilt = new SearchStore(
    repo.sqlite,
    (id) => repo.getOperation(id),
    (op) => repo.getConfig(op),
  );
  const replace = vi.spyOn(rebuilt, "replace");
  let complete = false;
  while (!complete) {
    const before = replace.mock.calls.length;
    complete = rebuilt.rebuildBatch(1);
    expect(replace.mock.calls.length - before).toBeLessThanOrEqual(1);
  }
  const hits = rebuilt.query(
    searchRequestSchema.parse({
      query: "Fictional Relief Company",
      type: "organization",
      sequence: 1,
    }),
  ).hits;
  expect(hits.some((h) => h.owner === "catalog:" + item.id)).toBe(true);
  const profile = withPerson(a, tree, child, "Unsaved Officer");
  profile.orbatWorkspace!.profiles[0].identity.fullDesignation =
    "Unsaved Company";
  if (item.kind !== "ORGANIZATION") throw Error("Expected organization");
  item.content.orbatWorkspace = profile.orbatWorkspace;
  const docs = catalogSearchDocuments(item, "working", {
    id: tree.versionId,
    nodes: tree.nodes,
  });
  expect(docs.filter((d) => d.title === "Formation HQ")).toHaveLength(1);
  expect(docs.filter((d) => d.title === "Unsaved Company")).toHaveLength(1);
  expect(docs.some((d) => d.text.includes("Unsaved Officer"))).toBe(true);
  expect(docs.some((d) => d.title === "Fictional Relief Company")).toBe(false);
  const switched = structuredClone(tree);
  switched.versionId = id();
  switched.nodes = [switched.nodes[0]];
  switched.nodes[0].nameOverride = "Alternate HQ";
  item.content.orbatWorkspace!.orbatId = switched.versionId;
  const switchedDocs = catalogSearchDocuments(item, "working", {
    id: switched.versionId,
    nodes: switched.nodes,
  });
  expect(switchedDocs.some((d) => d.title === "Alternate HQ")).toBe(true);
  expect(switchedDocs.some((d) => d.title === "Formation HQ")).toBe(false);
  expect(
    switchedDocs.filter((d) => d.title === "Unsaved Company"),
  ).toHaveLength(1);
});

it("includes the master and all ORBAT units in existing-operation imports and ORBAT creation, with independent duplicated staff", () => {
  const { tree, child, a, b } = fixture();
  const p = save(withPerson(a, tree, child, "Alex North"));
  const operation = app.execute({
    type: "create",
    name: "Existing operation",
    demo: false,
  }).operation!;
  const imported = app.workspaceCommand({
    type: "unit-profile-instantiate",
    operation,
    unitProfileVersionId: p.unitProfileVersionId,
    subtree: true,
    confirmDuplicate: false,
    importId: id(),
  }).operation!;
  const names = [
    p.identity.fullDesignation,
    "Formation HQ",
    child.unit.identity.fullDesignation,
  ];
  expect(imported.units.map((u) => u.name)).toEqual(names);
  expect(imported.units.map((u) => u.parentUnitId)).toEqual([
    null,
    imported.units[0].id,
    imported.units[1].id,
  ]);
  const onlyMaster = app.workspaceCommand({
    type: "unit-profile-instantiate",
    operation,
    unitProfileVersionId: p.unitProfileVersionId,
    subtree: false,
    confirmDuplicate: false,
    importId: id(),
  }).operation!;
  expect(onlyMaster.units.map((u) => u.name)).toEqual([
    p.identity.fullDesignation,
  ]);
  const copied = app.symbolCommand({
    type: "orbat-from-profile",
    id: p.unitProfileVersionId,
    name: "Copied organization",
  }).orbat!;
  expect(copied.nodes.map((n) => n.unit.identity.fullDesignation)).toEqual(
    names,
  );
  expect(copied.nodes.map((n) => n.parentNodeId)).toEqual([
    null,
    copied.nodes[0].nodeId,
    copied.nodes[1].nodeId,
  ]);
  const node = copied.nodes[2];
  if (node.unit.kind !== "UNIT_PROFILE")
    throw Error("Expected pinned organization unit");
  expect(
    repo.getUnitProfile(node.unit.source.versionId).staff.positions[0].incumbent
      ?.name,
  ).toBe("Alex North");
  const copy = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "Copied master",
    sourceId: p.unitProfileVersionId,
  }).entry!.item;
  const duplicated = organizationDocument(catalog, copy.id);
  expect(duplicated.orbatWorkspace).toEqual(p.orbatWorkspace);
  save(withPerson(duplicated, tree, child, "Copied Officer"));
  expect(
    organizationDocument(catalog, p.unitProfileVersionId).orbatWorkspace
      ?.profiles[0].staff.positions[0].incumbent?.name,
  ).toBe("Alex North");
  expect(
    organizationUnit(b.orbatWorkspace, tree.versionId, child).staff.positions,
  ).toEqual([]);
  repo.verifyAll();
});
it("uses saved structural and layout changes live, retains removed personnel, and never links a replacement by matching name", () => {
  const { tree, child, a } = fixture();
  const p = save(withPerson(a, tree, child, "Alex North"));
  const replacement = { ...structuredClone(child), nodeId: id() };
  tree.nodes = [tree.nodes[0], replacement];
  tree.layout.commandLevels = 3;
  const source = app.symbolCommand({
    type: "save-orbat",
    value: tree,
    expected: tree.contentVersion,
  }).orbat!;
  const current = organizationDocument(catalog, p.unitProfileVersionId);
  expect(current.orbatWorkspace?.profiles[0].nodeId).toBe(child.nodeId);
  expect(
    organizationUnit(current.orbatWorkspace, source.versionId, replacement)
      .staff.positions,
  ).toEqual([]);
  expect(organizationDiagram(current, source).layout.commandLevels).toBe(3);
  expect(organizationDiagram(current, source).nodes.map((n) => n.id)).toEqual([
    tree.rootNodeId,
    replacement.nodeId,
  ]);
  const restored = { ...source, nodes: [source.nodes[0], child] };
  app.symbolCommand({
    type: "save-orbat",
    value: restored,
    expected: source.contentVersion,
  });
  expect(
    organizationUnit(current.orbatWorkspace, tree.versionId, child).staff
      .positions[0].incumbent?.name,
  ).toBe("Alex North");
  repo.verifyAll();
});
it("keeps every assigned ORBAT identity separate from the master organization without mutating the saved map", () => {
  const { tree, child, a } = fixture();
  const before = canonical(tree);
  const own = organizationUnit(undefined, tree.versionId, child);
  own.identity.fullDesignation = "Organization-owned relief unit";
  own.identity.shortDesignation = "Relief";
  const otherMap = structuredClone(own);
  otherMap.orbatId = id();
  otherMap.identity.shortDesignation = "Unrelated retained profile";
  const root = organizationUnit(undefined, tree.versionId, tree.nodes[0]);
  root.identity.shortDesignation = "Subordinate formation";
  a.orbatWorkspace!.profiles = [own, otherMap, root];
  a.identity.shortDesignation = "Organization HQ";
  const diagram = organizationDiagram(a, tree);
  expect(diagram.nodes.find((n) => n.id === child.nodeId)?.name).toBe("Relief");
  expect(
    diagram.nodes.find((n) => n.id === child.nodeId)?.symbol?.amplifiers
      .uniqueDesignation,
  ).toBe("Relief");
  expect(diagram.nodes.find((n) => n.id === tree.rootNodeId)?.name).toBe(
    "Subordinate formation",
  );
  expect(
    diagram.nodes.find((n) => n.id === tree.rootNodeId)?.parentId,
  ).toBeNull();
  expect(diagram.nodes.find((n) => n.id === child.nodeId)?.parentId).toBe(
    tree.rootNodeId,
  );
  expect(canonical(tree)).toBe(before);
});
it("unassigns without deleting profiles and protects assigned ORBAT deletion", () => {
  const { tree, child, a, b } = fixture();
  let p = save(withPerson(a, tree, child, "Alex North"));
  const deletion = new CatalogDeletion(repo, repo.catalog);
  const target = { kind: "orbat" as const, id: tree.versionId };
  expect(deletion.prepareDeletion(target).blockers).toHaveLength(2);
  p.orbatWorkspace!.orbatId = null;
  p = save(p);
  b.orbatWorkspace!.orbatId = null;
  save(b);
  expect(p.orbatWorkspace?.profiles[0].staff.positions).toHaveLength(1);
  const preview = deletion.prepareDeletion(target);
  expect(preview.blockers).toEqual([]);
  deletion.permanentlyDelete(target, preview.fingerprint);
  expect(
    organizationDocument(catalog, p.unitProfileVersionId).orbatWorkspace
      ?.profiles,
  ).toEqual(p.orbatWorkspace?.profiles);
  repo.verifyAll();
});
it("saves root edits through the compatibility editor without losing the ORBAT or subordinate profiles, and rejects stale saves", () => {
  const { tree, child, a } = fixture();
  const p = save(withPerson(a, tree, child, "Alex North"));
  const legacy = app.workspaceCommand({
    type: "unit-profile-get",
    id: p.unitProfileVersionId,
  }).profile!;
  legacy.identity.headquarters = "Fictional Harbor";
  app.workspaceCommand({
    type: "unit-profile-save",
    profile: legacy,
    expectedContentVersion: legacy.contentVersion,
  });
  const current = organizationDocument(catalog, p.unitProfileVersionId);
  expect(current.orbatWorkspace).toEqual(p.orbatWorkspace);
  expect(current.identity.headquarters).toBe("Fictional Harbor");
  expect(() => save(p)).toThrow(/changed/);
  const { orbatWorkspace: _link, ...oldEditor } = current;
  expect(save(oldEditor).orbatWorkspace).toEqual(p.orbatWorkspace);
});
it("rejects missing, wrong-kind and newly empty assignments, duplicate node profiles and invalid staff", () => {
  const { tree, child, a } = fixture();
  const empty = catalog.execute({
    type: "create",
    kind: "ORBAT",
    name: "Empty",
  }).entry!;
  for (const orbatId of [id(), a.unitProfileVersionId, empty.item.id])
    expect(() =>
      save({ ...a, orbatWorkspace: { orbatId, profiles: [] } }),
    ).toThrow();
  const p = withPerson(a, tree, child, "Alex North");
  p.orbatWorkspace!.profiles.push(
    structuredClone(p.orbatWorkspace!.profiles[0]),
  );
  expect(() => save(p)).toThrow(/only one/);
  const invalid = withPerson(a, tree, child, "Alex North");
  invalid.orbatWorkspace!.profiles[0].staff.positions[0].sectionId = id();
  expect(() => save(invalid)).toThrow(/section is missing/);
});
it("freezes the current hierarchy, symbols and personnel for consumption without rewriting old snapshots or exposing internal profiles as catalog entries", () => {
  const { tree, child, a } = fixture();
  const draft = withPerson(a, tree, child, "Alex North");
  const formation = withPerson(a, tree, tree.nodes[0], "Taylor Formation")
    .orbatWorkspace!.profiles[0];
  draft.orbatWorkspace!.profiles.push(formation);
  draft.staff = structuredClone(formation.staff);
  draft.staff.positions[0].incumbent!.name = "Morgan Master";
  const p = save(draft);
  const first = catalog.snapshot(p.unitProfileVersionId);
  const root = repo.getUnitProfile(first);
  const frozenFormation = repo.getUnitProfile(
    root.standingSubordinates[0].unitProfileVersionId,
  );
  const frozenChild = repo.getUnitProfile(
    frozenFormation.standingSubordinates[0].unitProfileVersionId,
  );
  expect(root.identity.fullDesignation).toBe("Fictional North Division");
  expect(root.staff.positions[0].incumbent?.name).toBe("Morgan Master");
  expect(root.schemaVersion === 2 && root.defaultSymbol).toBeNull();
  expect(frozenFormation.identity.fullDesignation).toBe("Formation HQ");
  expect(frozenFormation.staff.positions[0].incumbent?.name).toBe(
    "Taylor Formation",
  );
  expect(frozenFormation.unitProfileFamilyId).not.toBe(
    root.unitProfileFamilyId,
  );
  expect(frozenChild.staff.positions[0].incumbent?.name).toBe("Alex North");
  expect(
    frozenChild.schemaVersion === 2 && frozenChild.defaultSymbol,
  ).toBeTruthy();
  expect(catalog.snapshot(p.unitProfileVersionId)).toBe(first);
  const oldHash = repo.unitProfileHash(first),
    childHash = repo.unitProfileHash(frozenChild.unitProfileVersionId);
  const operation = app.execute({
    type: "create",
    name: "Fictional linked organization operation",
    demo: false,
    unitProfileVersionId: p.unitProfileVersionId,
    initializeTaskOrganization: true,
  }).operation!;
  expect(operation.units).toHaveLength(3);
  expect(operation.units[1].parentUnitId).toBe(operation.units[0].id);
  expect(operation.units[2].parentUnitId).toBe(operation.units[1].id);
  expect(operation.units[1].sourceUnitProfile?.sourceUnitProfileVersionId).toBe(
    frozenFormation.unitProfileVersionId,
  );
  expect(operation.units[2].sourceUnitProfile?.sourceUnitProfileVersionId).toBe(
    frozenChild.unitProfileVersionId,
  );
  const retainedOperation = canonical(operation);
  const fresh = save(withPerson(p, tree, child, "Casey New"));
  const next = catalog.snapshot(fresh.unitProfileVersionId);
  expect(next).not.toBe(first);
  expect(repo.unitProfileHash(first)).toBe(oldHash);
  expect(repo.unitProfileHash(frozenChild.unitProfileVersionId)).toBe(
    childHash,
  );
  tree.nodes = [tree.nodes[0]];
  app.symbolCommand({
    type: "save-orbat",
    value: tree,
    expected: tree.contentVersion,
  });
  const changed = catalog.snapshot(fresh.unitProfileVersionId);
  const remaining = repo.getUnitProfile(
    repo.getUnitProfile(changed).standingSubordinates[0].unitProfileVersionId,
  );
  expect(remaining.standingSubordinates).toEqual([]);
  expect(remaining.unitProfileFamilyId).toBe(
    frozenFormation.unitProfileFamilyId,
  );
  expect(repo.getUnitProfile(first).standingSubordinates).toHaveLength(1);
  expect(canonical(repo.getOperation(operation.id))).toBe(retainedOperation);
  expect(catalog.importLegacy()).toBe(0);
  expect(repo.catalog.catalogList("ORGANIZATION")).toHaveLength(2);
  repo.verifyAll();
});
it("does not reuse cached snapshots that merged the ORBAT root into its master organization", () => {
  const { tree, a } = fixture();
  const legacy = newUnitProfile(a.identity.fullDesignation, id, rt.now());
  repo.saveUnitProfile(legacy, null);
  legacy.status = "PUBLISHED";
  legacy.publishedAt = rt.now();
  legacy.contentVersion = 2;
  repo.saveUnitProfile(legacy, 1);
  const item = repo.catalog.catalogGet(a.unitProfileVersionId).item;
  const orbat = repo.catalog.catalogGet(tree.versionId).item;
  const oldKey = repo.hash(
    canonical({
      kind: item.kind,
      name: item.name,
      content: item.content,
      children: [],
      assignedOrbat: repo.hash(
        canonical({
          kind: orbat.kind,
          name: orbat.name,
          content: orbat.content,
          children: [],
          mappings: [],
          doctrine: null,
        }),
      ),
      mappings: [],
      doctrine: null,
    }),
  );
  repo.catalog.catalogRememberSnapshot(
    item.id,
    oldKey,
    legacy.unitProfileVersionId,
  );
  const oldHash = repo.unitProfileHash(legacy.unitProfileVersionId);
  const current = catalog.snapshot(item.id);
  expect(current).not.toBe(legacy.unitProfileVersionId);
  expect(repo.getUnitProfile(current).standingSubordinates).toHaveLength(1);
  expect(repo.unitProfileHash(legacy.unitProfileVersionId)).toBe(oldHash);
  expect(
    repo.getUnitProfile(legacy.unitProfileVersionId).standingSubordinates,
  ).toEqual([]);
  expect(catalog.snapshot(item.id)).toBe(current);
});
it("backs up organization-owned data and recovers unfinished staff edits with the existing working-copy protection", async () => {
  const { tree, child, a } = fixture();
  const p = withPerson(a, tree, child, "Alex Unsaved");
  const draft = {
    schemaVersion: 1 as const,
    kind: "unit-profile" as const,
    id: a.unitProfileVersionId,
    scope: null,
    label: a.identity.fullDesignation,
    source: canonical(a),
    value: canonical(p),
    sequence: 1,
    updatedAt: rt.now(),
  };
  validateWorkingDraft(draft);
  repo.putWorkingDraft(draft, 0);
  const recovery = new WorkingDraftService(repo, rt, id(), (key) =>
    organizationDocument(catalog, key),
  );
  expect(recovery.execute({ type: "list" }).drafts?.[0].compatible).toBe(true);
  const file = resolve(".test-data", `organization-orbat-backup-${id()}.db`);
  mkdirSync(dirname(file), { recursive: true });
  await repo.backup(file);
  const restored = new SqliteRepository(file);
  try {
    restored.verifyAll();
    const services = new CatalogService(
      restored,
      restored.catalog,
      rt,
      restored,
    );
    expect(organizationDocument(services, a.unitProfileVersionId)).toEqual(a);
    expect(restored.getWorkingDraft(draft)?.value).toBe(canonical(p));
  } finally {
    restored.close();
  }
});
