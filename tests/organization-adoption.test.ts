import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { CatalogService } from "../src/application/catalog-service";
import { CatalogWorkspace } from "../src/application/catalog-workspace";
import { OrdoService } from "../src/application/service";
import { WorkspaceService } from "../src/application/workspace-service";
import { SymbologyService } from "../src/application/symbology-service";
import {
  organizationCommand,
  organizationDocument,
} from "../src/application/organization-service";
import { armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import type { OrganizationProfile } from "../src/domain/organization-orbat";
import type { StaffPosition } from "../src/domain/unit-profiles";
import { canonical } from "../src/export/projections/v1";
import { resolveResponsibleStaff } from "../src/domain/staff-resolution";

const rt = {
  id,
  now: () => "2026-10-20T19:00:00.000Z",
  actor: "Staff update test",
};
let repo: SqliteRepository, catalog: CatalogService, app: CatalogWorkspace;
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(armyConfig);
  const service = new OrdoService(repo, rt, (_name, c) =>
    demoOperation(c, id, rt.now()),
  );
  catalog = new CatalogService(repo, repo.catalog, rt, repo);
  catalog.importLegacy();
  app = new CatalogWorkspace(
    catalog,
    repo,
    service,
    new WorkspaceService(repo, rt),
    new SymbologyService(repo, rt),
  );
});
afterEach(() => repo.close());
const position = (
  sectionId: string,
  title: string,
  functionalRole: StaffPosition["functionalRole"] = null,
): StaffPosition => ({
  positionId: id(),
  sectionId,
  title,
  rankGrade: "",
  functionalRole,
  defaultForRole: false,
  description: "",
  notes: "",
  shortTitle: "",
  incumbent: null,
});
function save(profile: OrganizationProfile) {
  return organizationCommand(catalog, {
    type: "save",
    profile,
    expectedContentVersion: profile.contentVersion,
  });
}
function fixture() {
  const item = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    name: "Fictional division",
  }).entry!.item;
  const profile = organizationDocument(catalog, item.id);
  const sectionId = id();
  profile.staff.sections = [{ sectionId, name: "Personnel", description: "" }];
  profile.staff.positions = [
    position(sectionId, "Personnel Officer", "PERSONNEL"),
  ];
  save(profile);
  const state = app.execute({
    type: "create",
    name: "Fictional draft",
    demo: false,
    unitProfileVersionId: item.id,
    initializeTaskOrganization: true,
    configuration: { id: armyConfig.doctrine.id, version: 1 },
  });
  return {
    organizationId: item.id,
    op: state.operation!,
    config: state.config,
  };
}
function addCommandStaff(organizationId: string) {
  const profile = organizationDocument(catalog, organizationId);
  const sectionId = id();
  profile.staff.sections.unshift({
    sectionId,
    name: "Command Staff",
    description: "",
  });
  profile.staff.positions.push(
    position(sectionId, "Commanding General", "COMMAND"),
    position(sectionId, "Deputy Commanding General", "EXECUTIVE"),
  );
  return save(profile);
}
it("adds Command Staff and both roles to an existing draft, without replacing task organization or history", () => {
  const { organizationId, op } = fixture();
  const original = canonical(op);
  addCommandStaff(organizationId);
  const state = app.execute({ type: "load", operationId: op.id });
  expect(state.organizationUpdate?.state).toBe("updated");
  expect(
    state.operation!.operationOrganizationBinding!.staff.sections.map(
      (s) => s.name,
    ),
  ).toContain("Command Staff");
  expect(
    state.operation!.operationOrganizationBinding!.staff.positions.map(
      (p) => p.title,
    ),
  ).toEqual([
    "Personnel Officer",
    "Commanding General",
    "Deputy Commanding General",
  ]);
  expect(state.operation!.units).toEqual(op.units);
  expect(canonical(repo.getOperation(op.id, op.revision))).toBe(original);
  const repeat = app.execute({ type: "load", operationId: op.id });
  expect(repeat.organizationUpdate).toBeNull();
  expect(repeat.operation!.revision).toBe(state.operation!.revision);
  repo.verifyAll();
});
it("keeps assignments by position identity through renames and section moves; flags removed assigned positions", () => {
  const { organizationId, op } = fixture();
  const binding = op.operationOrganizationBinding!;
  const p = binding.staff.positions[0];
  op.staffPositionOverrides = [
    {
      productId: op.orderId,
      unitProfileVersionId: binding.unitProfileVersionId,
      sectionId: p.sectionId,
      positionId: p.positionId,
      functionalRole: p.functionalRole,
    },
  ];
  app.execute({ type: "save", operation: op, expectedRevision: op.revision });
  const profile = organizationDocument(catalog, organizationId);
  const sectionId = id();
  profile.staff.sections.push({
    sectionId,
    name: "Command Staff",
    description: "",
  });
  Object.assign(profile.staff.positions[0], {
    title: "Chief of Staff",
    sectionId,
    functionalRole: "COMMAND",
  });
  save(profile);
  const moved = app.execute({ type: "load", operationId: op.id }).operation!;
  expect(moved.staffPositionOverrides![0]).toMatchObject({
    positionId: p.positionId,
    sectionId,
    functionalRole: "COMMAND",
    unitProfileVersionId:
      moved.operationOrganizationBinding!.unitProfileVersionId,
  });
  const removed = organizationDocument(catalog, organizationId);
  // A matching title is a different position, never an implicit replacement.
  removed.staff.positions = [position(sectionId, "Chief of Staff", "COMMAND")];
  save(removed);
  const count = repo.catalog.catalogSnapshotCount(organizationId);
  const conflict = app.execute({ type: "load", operationId: op.id });
  expect(conflict.organizationUpdate?.state).toBe("conflict");
  expect(conflict.organizationUpdate?.messages[0]).toMatch(
    /Chief of Staff.*removed/,
  );
  expect(conflict.operation).toEqual(moved);
  expect(repo.catalog.catalogSnapshotCount(organizationId)).toBe(count);
  moved.staffPositionOverrides = [];
  const resolved = app.execute({
    type: "save",
    operation: moved,
    expectedRevision: moved.revision,
  });
  expect(resolved.organizationUpdate?.state).toBe("updated");
  repo.verifyAll();
});
it("updates doctrine role mappings, default positions and incumbents without repeated revisions", () => {
  const { organizationId, op, config } = fixture();
  const staffId = config.doctrine.staff[0].id;
  op.metadata.ownerId = staffId;
  app.execute({ type: "save", operation: op, expectedRevision: op.revision });
  const profile = organizationDocument(catalog, organizationId);
  profile.roleMappings = [
    {
      doctrineFamilyId: armyConfig.doctrine.id,
      doctrineVersion: 1,
      staffId,
      functionalRole: "PERSONNEL",
    },
  ];
  profile.staff.positions[0].defaultForRole = true;
  profile.staff.positions[0].incumbent = {
    name: "Fictional officer",
    rank: "",
    contact: "",
    notes: "",
  };
  save(profile);
  const updated = app.execute({ type: "load", operationId: op.id });
  expect(updated.organizationUpdate?.state).toBe("updated");
  const resolved = resolveResponsibleStaff(
    updated.operation!,
    updated.config,
    null,
  );
  expect(resolved.label).toBe("Personnel Officer");
  expect(resolved.position?.incumbent?.name).toBe("Fictional officer");
  expect(resolved.warning).toBe("");
  const again = app.execute({ type: "load", operationId: op.id });
  expect(again.organizationUpdate).toBeNull();
  expect(again.operation!.revision).toBe(updated.operation!.revision);
  repo.verifyAll();
});
it("does not follow a different organization with the same name", () => {
  const { organizationId, op } = fixture();
  const duplicate = catalog.execute({
    type: "create",
    kind: "ORGANIZATION",
    sourceId: organizationId,
    name: "Fictional division",
  }).entry!.item;
  addCommandStaff(duplicate.id);
  const loaded = app.execute({ type: "load", operationId: op.id });
  expect(loaded.organizationUpdate).toBeNull();
  expect(loaded.operation).toEqual(op);
});
it("keeps approved staff and retained exports exact, and updates when drafting resumes", () => {
  const { organizationId, op, config } = fixture();
  op.metadata.statusId = config.doctrine.publicationRequiredStatus;
  op.revision++;
  repo.saveOperation(op, op.revision - 1, rt.actor);
  app.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "Fictional approval",
  });
  const published = app.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  });
  const profile = published.profiles.find((p) => p.product === "opord")!;
  app.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId: published.publications[0].id,
  });
  const publications = canonical(repo.listPublications(op.id));
  const exports = canonical(repo.listExports(op.id));
  addCommandStaff(organizationId);
  expect(
    app.execute({ type: "load", operationId: op.id }).organizationUpdate?.state,
  ).toBe("deferred");
  op.sections[0].summary = "Drafting continues";
  const current = app.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  });
  expect(current.organizationUpdate?.state).toBe("updated");
  expect(
    repo.getOperation(op.id, op.revision).operationOrganizationBinding,
  ).toEqual(op.operationOrganizationBinding);
  expect(canonical(repo.listPublications(op.id))).toBe(publications);
  expect(canonical(repo.listExports(op.id))).toBe(exports);
  repo.verifyAll();
});
it("defers for recovery copies, retains unsaved writing on save and rejects stale saves", () => {
  const { organizationId, op } = fixture();
  const draft = structuredClone(op);
  draft.sections[0].summary = "Keep my recovered writing";
  repo.putWorkingDraft(
    {
      kind: "operation",
      id: op.id,
      scope: op.id,
      schemaVersion: 1,
      label: op.name,
      source: canonical(op),
      value: canonical(draft),
      sequence: 1,
      updatedAt: rt.now(),
    },
    0,
  );
  addCommandStaff(organizationId);
  expect(
    app.execute({ type: "load", operationId: op.id }).organizationUpdate?.state,
  ).toBe("deferred");
  const saved = app.execute({
    type: "save",
    operation: draft,
    expectedRevision: op.revision,
  });
  expect(saved.organizationUpdate?.state).toBe("updated");
  expect(saved.operation!.sections[0].summary).toBe(draft.sections[0].summary);
  expect(() =>
    app.execute({ type: "save", operation: op, expectedRevision: op.revision }),
  ).toThrow(/changed/);
  repo.verifyAll();
});
