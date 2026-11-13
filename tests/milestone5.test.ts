import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { readFileSync, copyFileSync, mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { WorkspaceService } from "../src/application/workspace-service";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import {
  unitProfileSchema,
  type UnitProfile,
} from "../src/domain/unit-profiles";
import { resolveResponsibleStaff } from "../src/domain/staff-resolution";
import { hashBytes } from "../src/persistence/modular-store";
import { canonical, project } from "../src/export/projection";
import { createExportProfile } from "../src/domain/factories";
let repo: SqliteRepository,
  service: OrdoService,
  workspace: WorkspaceService,
  tick = 0;
const runtime = {
  id: uid,
  now: () => new Date(Date.UTC(2026, 9, 4, 1, 0, tick++)).toISOString(),
  actor: "Fictional planner",
};
const q = {
  search: "",
  status: "",
  echelon: "",
  sort: "updated" as const,
  offset: 0,
  limit: 20,
};
beforeEach(() => {
  tick = 0;
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  service = new OrdoService(repo, runtime, (_n, c) =>
    demoOperation(c, uid, runtime.now()),
  );
  workspace = new WorkspaceService(repo, runtime);
});
afterEach(() => {
  if (repo.sqlite.open) repo.close();
});
const draft = (name = "FICTIONAL 25th LIB") =>
  workspace.execute({ type: "unit-profile-new", name }).profile!;
const save = (v: UnitProfile) =>
  workspace.execute({
    type: "unit-profile-save",
    profile: v,
    expectedContentVersion: v.contentVersion,
  }).profile!;
const publish = (v: UnitProfile) =>
  workspace.execute({
    type: "unit-profile-publish",
    id: v.unitProfileVersionId,
    expectedContentVersion: v.contentVersion,
  }).profile!;
function withStaff() {
  let v = draft();
  const sectionId = uid();
  v.staff.sections.push({ sectionId, name: "Operations", description: "" });
  v.staff.positions.push({
    positionId: uid(),
    sectionId,
    title: "Brigade S-3",
    shortTitle: "S-3",
    functionalRole: "OPERATIONS",
    defaultForRole: false,
    description: "",
    notes: "",
    rankGrade: "",
    incumbent: null,
  });
  return save(v);
}
const operation = (v?: UnitProfile) =>
  service.execute({
    type: "create",
    name: "FICTIONAL SILVER PINE",
    demo: false,
    ...(v ? { unitProfileVersionId: v.unitProfileVersionId } : {}),
    configuration: { id: armyConfig.organization.id, version: 1 },
  }).operation!;
describe("M5 profiles and staff", () => {
  it("creates independent UUID families and versions", () => {
    const a = draft(),
      b = draft();
    expect(a.unitProfileFamilyId).not.toBe(a.unitProfileVersionId);
    expect(a.unitProfileFamilyId).not.toBe(b.unitProfileFamilyId);
  });
  it("supports custom unit types and echelons", () => {
    const v = draft();
    v.identity.unitType = "Custom detachment";
    v.identity.echelon = "Other";
    expect(save(v).identity.echelon).toBe("Other");
  });
  it("rejects arbitrary profile JSON", () =>
    expect(() =>
      unitProfileSchema.parse({ ...draft(), arbitrary: {} }),
    ).toThrow());
  it("rejects stale Draft writes", () => {
    const v = draft();
    save(v);
    expect(() => save(v)).toThrow(/changed/);
  });
  it("publishes exact immutable content at service and SQL boundaries", () => {
    const v = publish(withStaff()),
      original = canonical(v);
    v.identity.fullDesignation = "Tamper";
    expect(() => save(v)).toThrow(/immutable/);
    expect(() =>
      repo.sqlite
        .prepare("UPDATE unit_profile_versions SET document=? WHERE id=?")
        .run(JSON.stringify(v), v.unitProfileVersionId),
    ).toThrow(/immutable/);
    expect(canonical(repo.getUnitProfile(v.unitProfileVersionId))).toBe(
      original,
    );
  });
  it("cannot publish through a Draft save", () => {
    const v = draft();
    v.status = "PUBLISHED";
    v.publishedAt = runtime.now();
    expect(() => save(v)).toThrow(/Publish/);
  });
  it("new version preserves section and position identities", () => {
    const a = publish(withStaff()),
      b = workspace.execute({
        type: "unit-profile-derive",
        id: a.unitProfileVersionId,
        versionLabel: "1.1.0",
        newFamily: false,
      }).profile!;
    expect(b.staff).toEqual(a.staff);
    expect(b.parentVersionId).toBe(a.unitProfileVersionId);
    expect(b.unitProfileVersionId).not.toBe(a.unitProfileVersionId);
    b.staff.positions[0].title = "Operations Officer";
    save(b);
    expect(
      repo.getUnitProfile(a.unitProfileVersionId).staff.positions[0].title,
    ).toBe("Brigade S-3");
  });
  it("new family remaps internal identities and retains source provenance", () => {
    const a = publish(withStaff()),
      b = workspace.execute({
        type: "unit-profile-derive",
        id: a.unitProfileVersionId,
        versionLabel: "1.0.0",
        newFamily: true,
      }).profile!;
    expect(b.unitProfileFamilyId).not.toBe(a.unitProfileFamilyId);
    expect(b.staff.positions[0].positionId).not.toBe(
      a.staff.positions[0].positionId,
    );
    expect(b.staff.positions[0].sectionId).toBe(b.staff.sections[0].sectionId);
    expect(b.duplicatedFrom?.unitProfileVersionId).toBe(a.unitProfileVersionId);
  });
  it("retirement retains exact published hash and content", () => {
    const a = publish(withStaff()),
      hash = repo.unitProfileHash(a.unitProfileVersionId);
    workspace.execute({
      type: "unit-profile-retire",
      id: a.unitProfileVersionId,
    });
    expect(repo.getUnitProfile(a.unitProfileVersionId).status).toBe("RETIRED");
    expect(repo.unitProfileHash(a.unitProfileVersionId)).toBe(hash);
    expect(() => operation(a)).toThrow(/retired/);
  });
  it("rejects duplicate version labels", () => {
    const a = publish(draft());
    expect(() =>
      workspace.execute({
        type: "unit-profile-derive",
        id: a.unitProfileVersionId,
        versionLabel: "1.0.0",
        newFamily: false,
      }),
    ).toThrow();
  });
  it("Dashboard uses the frozen full designation when no short designation exists", () => {
    const v = publish(draft("Fictional full designation")),
      op = operation(v);
    expect(
      repo.dashboard().recentOperations.find((o) => o.id === op.id)
        ?.organization,
    ).toBe(v.identity.fullDesignation);
  });
  it("retains retired subordinate pins across draft saves and derived versions", () => {
    const child = publish(draft("Child"));
    const parent = draft("Parent");
    parent.standingSubordinates.push({
      relationshipId: uid(),
      unitProfileFamilyId: child.unitProfileFamilyId,
      unitProfileVersionId: child.unitProfileVersionId,
    });
    const saved = save(parent),
      frozen = publish(saved);
    workspace.execute({
      type: "unit-profile-retire",
      id: child.unitProfileVersionId,
    });
    const derived = workspace.execute({
      type: "unit-profile-derive",
      id: frozen.unitProfileVersionId,
      newFamily: false,
      versionLabel: "1.1.0",
    }).profile!;
    derived.identity.description = "Independent edit";
    expect(save(derived).standingSubordinates).toEqual(
      frozen.standingSubordinates,
    );
    const other = draft("New selection");
    other.standingSubordinates = structuredClone(frozen.standingSubordinates);
    expect(() => save(other)).toThrow(/published subordinate/);
    repo.verifyAll();
  });
  it("rejects malformed retirement metadata during read", () => {
    const v = publish(draft());
    workspace.execute({
      type: "unit-profile-retire",
      id: v.unitProfileVersionId,
    });
    repo.sqlite.exec("DROP TRIGGER unit_retirement_update");
    repo.sqlite
      .prepare(
        "UPDATE unit_profile_retirements SET retired_at=? WHERE version_id=?",
      )
      .run("invalid date", v.unitProfileVersionId);
    expect(() => repo.getUnitProfile(v.unitProfileVersionId)).toThrow();
  });
  it("restore verification checks every default-doctrine pin field", () => {
    const v = draft(),
      d = repo
        .listDoctrines()
        .find((d) => d.config.doctrine.id === armyConfig.doctrine.id)!;
    v.defaultDoctrine = {
      doctrineFamilyId: d.doctrineFamilyId,
      doctrineVersionId: d.doctrineVersionId,
      profileVersion: d.config.doctrine.version + 1,
      configuration: {
        id: d.config.organization.id,
        version: d.config.organization.version,
      },
    };
    // Simulate an otherwise self-consistent but externally corrupted backup.
    repo.sqlite
      .prepare(
        "UPDATE unit_profile_versions SET document=?,content_hash=? WHERE id=?",
      )
      .run(JSON.stringify(v), hashBytes(canonical(v)), v.unitProfileVersionId);
    expect(() => repo.verifyAll()).toThrow(/default doctrine/);
  });
  it("incumbent changes preserve position identity", () => {
    const v = withStaff(),
      id = v.staff.positions[0].positionId;
    v.staff.positions[0].incumbent = {
      name: "Fictional Person",
      rank: "MAJ",
      contact: "Example",
      notes: "Informational",
    };
    expect(save(v).staff.positions[0].positionId).toBe(id);
  });
  it("supports moving and reordering staff without changing identity", () => {
    const v = withStaff(),
      id = v.staff.positions[0].positionId;
    v.staff.sections.push({
      sectionId: uid(),
      name: "Custom",
      description: "",
    });
    v.staff.sections.reverse();
    v.staff.positions[0].sectionId = v.staff.sections[0].sectionId;
    expect(save(v).staff.positions[0].positionId).toBe(id);
  });
  it("rejects missing sections and duplicate position identities", () => {
    const v = withStaff();
    v.staff.positions[0].sectionId = uid();
    expect(() => save(v)).toThrow(/section/);
    v.staff.positions[0].sectionId = v.staff.sections[0].sectionId;
    v.staff.positions.push({ ...v.staff.positions[0] });
    expect(() => save(v)).toThrow(/Duplicate/);
  });
  it("rejects multiple defaults for a role", () => {
    const v = withStaff();
    v.staff.positions[0].defaultForRole = true;
    v.staff.positions.push({ ...v.staff.positions[0], positionId: uid() });
    expect(() => save(v)).toThrow(/defaults/);
  });
});
describe("M5 standing hierarchy and instantiation", () => {
  it("pins exact subordinate versions without adopting a newer child", () => {
    const child = publish(draft("Battalion")),
      p = draft();
    p.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: child.unitProfileFamilyId,
        unitProfileVersionId: child.unitProfileVersionId,
      },
    ];
    const a = publish(save(p));
    const newer = workspace.execute({
      type: "unit-profile-derive",
      id: child.unitProfileVersionId,
      versionLabel: "2.0.0",
      newFamily: false,
    }).profile!;
    publish(newer);
    expect(
      repo.getUnitProfile(a.unitProfileVersionId).standingSubordinates[0]
        .unitProfileVersionId,
    ).toBe(child.unitProfileVersionId);
  });
  it("rejects self-parent and duplicate child", () => {
    const a = draft();
    a.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: a.unitProfileFamilyId,
        unitProfileVersionId: a.unitProfileVersionId,
      },
    ];
    expect(() => save(a)).toThrow(/own subordinate/);
    const c = publish(draft());
    a.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: c.unitProfileFamilyId,
        unitProfileVersionId: c.unitProfileVersionId,
      },
    ];
    a.standingSubordinates.push({
      ...a.standingSubordinates[0],
      relationshipId: uid(),
    });
    expect(() => save(a)).toThrow(/Duplicate/);
  });
  it("rejects transitive family cycles across versions", () => {
    const a = publish(draft("A")),
      b = draft("B");
    b.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: a.unitProfileFamilyId,
        unitProfileVersionId: a.unitProfileVersionId,
      },
    ];
    const pb = publish(save(b)),
      a2 = workspace.execute({
        type: "unit-profile-derive",
        id: a.unitProfileVersionId,
        versionLabel: "2.0.0",
        newFamily: false,
      }).profile!;
    a2.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: pb.unitProfileFamilyId,
        unitProfileVersionId: pb.unitProfileVersionId,
      },
    ];
    expect(() => save(a2)).toThrow(/cycle/);
  });
  it("rejects missing and Draft child versions", () => {
    const a = draft(),
      b = draft();
    a.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: b.unitProfileFamilyId,
        unitProfileVersionId: b.unitProfileVersionId,
      },
    ];
    expect(() => save(a)).toThrow(/published/);
    a.standingSubordinates[0].unitProfileVersionId = uid();
    expect(() => save(a)).toThrow(/not found/);
  });
  it("instantiates canonical units with independent UUIDs and source metadata", () => {
    const v = publish(draft()),
      op = operation();
    const next = workspace.execute({
      type: "unit-profile-instantiate",
      operation: op,
      unitProfileVersionId: v.unitProfileVersionId,
      subtree: false,
      confirmDuplicate: false,
      importId: uid(),
    }).operation!;
    expect(next.units).toHaveLength(1);
    expect(next.units[0].id).not.toBe(v.unitProfileVersionId);
    expect(next.units[0].sourceUnitProfile?.sourceUnitProfileFamilyId).toBe(
      v.unitProfileFamilyId,
    );
    next.units[0].name = "Independent";
    service.execute({
      type: "save",
      operation: next,
      expectedRevision: op.revision,
    });
    expect(
      repo.getUnitProfile(v.unitProfileVersionId).identity.fullDesignation,
    ).toBe(v.identity.fullDesignation);
  });
  it("warns on likely duplicate but permits deliberately independent reuse", () => {
    const v = publish(draft()),
      op = operation();
    const c = {
      type: "unit-profile-instantiate" as const,
      operation: op,
      unitProfileVersionId: v.unitProfileVersionId,
      subtree: false,
      confirmDuplicate: false,
      importId: uid(),
    };
    const a = workspace.execute(c).operation!;
    expect(
      workspace.execute({ ...c, operation: a }).operation!.units,
    ).toHaveLength(1);
    expect(() =>
      workspace.execute({ ...c, operation: a, importId: uid() }),
    ).toThrow(/Confirm duplicate/);
    const b = workspace.execute({
      ...c,
      operation: a,
      importId: uid(),
      confirmDuplicate: true,
    }).operation!;
    expect(new Set(b.units.map((u) => u.id)).size).toBe(2);
  });
  it("initializes an exact standing subtree once using operational parent IDs", () => {
    const child = publish(draft("Child")),
      p = draft("Parent");
    p.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: child.unitProfileFamilyId,
        unitProfileVersionId: child.unitProfileVersionId,
      },
    ];
    const parent = publish(save(p));
    const op = service.execute({
      type: "create",
      name: "Tree",
      demo: false,
      unitProfileVersionId: parent.unitProfileVersionId,
      initializeTaskOrganization: true,
    }).operation!;
    expect(op.units).toHaveLength(2);
    expect(op.units[1].parentUnitId).toBe(op.units[0].id);
    expect(op.units[1].parentUnitId).not.toBe(parent.unitProfileVersionId);
  });
});
describe("M5 operation organization and Responsible Staff", () => {
  it("supports legacy operation without introducing binding or schema defaults", () => {
    const op = operation();
    expect(Object.hasOwn(op, "operationOrganizationBinding")).toBe(false);
    expect(repo.getOperation(op.id)).toEqual(op);
  });
  it("retains the distinct legacy organizationRef", () => {
    const v = publish(withStaff()),
      op = operation(v);
    expect(op.organizationRef).toEqual({
      id: armyConfig.organization.id,
      version: 1,
    });
    expect(op.operationOrganizationBinding?.unitProfileFamilyId).toBe(
      v.unitProfileFamilyId,
    );
  });
  it("does not silently adopt a newer organization", () => {
    const v = publish(withStaff()),
      op = operation(v),
      before = canonical(op);
    const newer = workspace.execute({
      type: "unit-profile-derive",
      id: v.unitProfileVersionId,
      versionLabel: "1.1.0",
      newFamily: false,
    }).profile!;
    newer.staff.positions[0].title = "New officer";
    publish(save(newer));
    expect(canonical(repo.getOperation(op.id))).toBe(before);
  });
  it("resolves from self-contained operation state without global reads", () => {
    const v = publish(withStaff()),
      op = operation(v),
      node = armyConfig.doctrine.catalog!.nodes.find(
        (n) => n.code === "C" && n.nodeType === "ANNEX",
      )!;
    const spy = vi.spyOn(repo, "getUnitProfile").mockImplementation(() => {
      throw Error("Global access forbidden");
    });
    expect(resolveResponsibleStaff(op, armyConfig, node.id).label).toBe(
      "Brigade S-3",
    );
    expect(spy).not.toHaveBeenCalled();
  });
  it("reports missing roles without inventing a position", () => {
    const v = publish(draft()),
      op = operation(v),
      node = armyConfig.doctrine.catalog!.nodes.find(
        (n) => n.code === "C" && n.nodeType === "ANNEX",
      )!;
    expect(resolveResponsibleStaff(op, armyConfig, node.id).warning).toMatch(
      /No matching/,
    );
  });
  it("reports ambiguity rather than selecting first or matching title", () => {
    const v = withStaff();
    v.staff.positions.push({
      ...v.staff.positions[0],
      positionId: uid(),
      title: "Operations Officer",
    });
    const op = operation(publish(save(v))),
      node = armyConfig.doctrine.catalog!.nodes.find(
        (n) => n.code === "C" && n.nodeType === "ANNEX",
      )!;
    expect(
      resolveResponsibleStaff(op, armyConfig, node.id).position,
    ).toBeNull();
    expect(resolveResponsibleStaff(op, armyConfig, node.id).warning).toMatch(
      /Ambiguous/,
    );
  });
  it("uses explicit default role position", () => {
    const v = withStaff();
    v.staff.positions.push({
      ...v.staff.positions[0],
      positionId: uid(),
      title: "Designated",
      defaultForRole: true,
    });
    const op = operation(publish(save(v))),
      node = armyConfig.doctrine.catalog!.nodes.find(
        (n) => n.code === "C" && n.nodeType === "ANNEX",
      )!;
    expect(resolveResponsibleStaff(op, armyConfig, node.id).label).toBe(
      "Designated",
    );
  });
  it("a title alone never confers a functional role", () => {
    const v = withStaff();
    v.staff.positions[0].functionalRole = null;
    const op = operation(publish(save(v))),
      node = armyConfig.doctrine.catalog!.nodes.find(
        (n) => n.code === "C" && n.nodeType === "ANNEX",
      )!;
    expect(
      resolveResponsibleStaff(op, armyConfig, node.id).position,
    ).toBeNull();
  });
  it("rejects replacing an operation pin or spoofing its snapshot", () => {
    const v = publish(withStaff()),
      op = operation(v);
    op.operationOrganizationBinding!.identity.fullDesignation = "Spoof";
    expect(() =>
      service.execute({
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      }),
    ).toThrow(/pinned/);
    expect(() => repo.verifyOperationOrganization(op)).toThrow(/snapshot/);
  });
  it("keeps an operation resolvable after retirement", () => {
    const v = publish(withStaff()),
      op = operation(v);
    workspace.execute({
      type: "unit-profile-retire",
      id: v.unitProfileVersionId,
    });
    expect(() => repo.verifyOperationOrganization(op)).not.toThrow();
  });
  it("organization default doctrine is only a recommendation", () => {
    const v = draft(),
      d = repo
        .doctrineSummaries()
        .find((d) => d.familyId === armyConfig.doctrine.id)!;
    v.defaultDoctrine = {
      doctrineFamilyId: d.familyId,
      doctrineVersionId: d.id,
      profileVersion: d.profileVersion,
      configuration: d.configuration,
    };
    const p = publish(save(v)),
      op = service.execute({
        type: "create",
        name: "Different doctrine",
        demo: false,
        unitProfileVersionId: p.unitProfileVersionId,
      }).operation!;
    expect(op.doctrineRef.id).toBe(starterConfig.doctrine.id);
    expect(op.operationOrganizationBinding).not.toHaveProperty(
      "defaultDoctrine",
    );
  });
  it("does not add organization fields to historical OPORD projections", () => {
    const v = publish(withStaff()),
      op = operation(v),
      profile = createExportProfile(op, "opord", uid()),
      legacy = structuredClone(op);
    delete legacy.operationOrganizationBinding;
    expect(project(op, profile, armyConfig)).toEqual(
      project(legacy, profile, armyConfig),
    );
  });
});
describe("M5 global read boundaries and migrations", () => {
  it("does not select a most-recent operation on context-free load", () => {
    operation();
    expect(service.load().operation).toBeNull();
  });
  it("Dashboard uses summary reads, never document hydration or asset bytes", () => {
    const v = publish(withStaff());
    operation(v);
    for (const method of [
      "getOperation",
      "listReviews",
      "listDoctrines",
      "listAssets",
      "assetData",
      "listPublications",
      "listExports",
      "getUnitProfile",
    ] as const)
      vi.spyOn(repo, method).mockImplementation(() => {
        throw Error(`Forbidden ${method}`);
      });
    const d = workspace.execute({ type: "dashboard" }).dashboard!;
    expect(d.recentOperations).toHaveLength(1);
    expect(d.organizations).toHaveLength(1);
    expect(d.doctrines.length).toBeGreaterThan(0);
  });
  it("searches, filters, sorts and paginates organization summaries", () => {
    const a = draft("Zulu");
    a.identity.echelon = "Custom";
    save(a);
    publish(draft("Alpha"));
    expect(
      repo.browseUnitProfiles({ ...q, sort: "name", limit: 1 }).items[0].name,
    ).toBe("Alpha");
    expect(
      repo.browseUnitProfiles({ ...q, status: "DRAFT", echelon: "Custom" })
        .total,
    ).toBe(1);
    expect(repo.browseUnitProfiles({ ...q, search: "missing" }).total).toBe(0);
  });
  it("searches operation summaries without loading historical content", () => {
    operation();
    expect(repo.browseOperations({ ...q, search: "SILVER" }).total).toBe(1);
    expect(repo.browseOperations({ ...q, search: "none" }).total).toBe(0);
  });
  it("stores navigation and actor preferences outside planning history", () => {
    const op = operation(),
      before = canonical(op);
    workspace.execute({ type: "remember-operation", operationId: op.id });
    workspace.execute({
      type: "preferences",
      preferences: {
        ...repo.preferences(),
        localActor: "Another local planner",
      },
    });
    expect(repo.preferences().lastOpenedOperationId).toBe(op.id);
    expect(canonical(repo.getOperation(op.id))).toBe(before);
    expect(repo.revisionHistory(op.id)).toHaveLength(1);
  });
  it("preserves all frozen M1-M4 implementations", () => {
    const hashes = JSON.parse(
      readFileSync("tests/fixtures/milestone5-frozen-hashes.json", "utf8"),
    );
    for (const [file, hash] of Object.entries(hashes))
      expect(hashBytes(readFileSync(file))).toBe(hash);
  });
  it("upgrades real schema-005 and preserves every existing asset byte and owner", () => {
    mkdirSync(".test-data", { recursive: true });
    const path = `.test-data/m5-upgrade-${uid()}.db`;
    copyFileSync("tests/fixtures/milestone4-0.4.0.db", path);
    const db = new Database(path);
    expect(
      db.prepare("SELECT max(version) AS v FROM schema_migrations").get(),
    ).toEqual({ v: 5 });
    const before = db
      .prepare("SELECT * FROM managed_assets ORDER BY id")
      .all() as any[];
    expect(before.length).toBeGreaterThan(0);
    db.close();
    const upgraded = new SqliteRepository(path, true);
    try {
      expect(
        upgraded.sqlite
          .prepare("SELECT max(version) AS v FROM schema_migrations")
          .get(),
      ).toEqual({ v: 20 });
      const after = upgraded.sqlite
        .prepare("SELECT * FROM managed_assets ORDER BY id")
        .all() as any[];
      expect(after).toHaveLength(before.length);
      for (const [i, a] of before.entries()) {
        const b = after[i];
        expect(b.id).toBe(a.id);
        expect(b.operation_id).toBe(a.operation_id);
        expect(b.doctrine_version_id).toBe(a.doctrine_version_id);
        expect(b.document).toBe(a.document);
        expect(b.bytes.equals(a.bytes)).toBe(true);
        expect(b.bytes.length).toBe(a.bytes.length);
        expect(hashBytes(b.bytes)).toBe(hashBytes(a.bytes));
        expect(JSON.parse(b.document).mimeType).toBe(
          JSON.parse(a.document).mimeType,
        );
      }
      expect(() =>
        upgraded.sqlite.exec("UPDATE managed_assets SET bytes=x'00'"),
      ).toThrow(/immutable/);
      expect(() => upgraded.sqlite.exec("DELETE FROM managed_assets")).toThrow(
        /immutable/,
      );
      upgraded.verifyAll();
    } finally {
      upgraded.close();
    }
  });
});
