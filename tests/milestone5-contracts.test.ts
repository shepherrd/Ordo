import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { mkdirSync, copyFileSync } from "node:fs";
import Database from "better-sqlite3";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { WorkspaceService } from "../src/application/workspace-service";
import { ReviewService } from "../src/application/review-service";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import {
  type UnitProfile,
  bindOrganization,
} from "../src/domain/unit-profiles";
import { resolveResponsibleStaff } from "../src/domain/staff-resolution";
import {
  startupLocation,
  enterOperation,
  leaveOperation,
  globalPages,
} from "../src/domain/workspace-navigation";
import { restoreWorkspace } from "../src/persistence/restore";
import { hashBytes } from "../src/persistence/modular-store";
import { canonical, exportStaleness } from "../src/export/projection";
import { renderReviewReport } from "../src/export/review-report";
import { endpointSelector } from "../src/persistence/review-store";
import { instantiateProduct } from "../src/domain/authoring";
import { reviewHeaderSchema } from "../src/domain/reviews";
import { semanticDiff } from "../src/domain/diff";
import { validate } from "../src/validation/engine";
let repo: SqliteRepository,
  service: OrdoService,
  ws: WorkspaceService,
  reviews: ReviewService,
  tick = 0;
const runtime = {
  id: uid,
  now: () => new Date(Date.UTC(2026, 9, 4, 2, 0, tick++)).toISOString(),
  actor: "Fictional tester",
};
function setup(r: SqliteRepository) {
  repo = r;
  service = new OrdoService(repo, runtime, (_n, c) =>
    demoOperation(c, uid, runtime.now()),
  );
  ws = new WorkspaceService(repo, runtime);
  reviews = new ReviewService(repo, runtime);
}
beforeEach(() => {
  tick = 0;
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  setup(repo);
});
afterEach(() => {
  if (repo.sqlite.open) repo.close();
});
function draft() {
  const v = ws.execute({
    type: "unit-profile-new",
    name: "Fictional contract brigade",
  }).profile!;
  const sectionId = uid();
  v.staff.sections = [{ sectionId, name: "Staff", description: "" }];
  v.staff.positions = [
    {
      positionId: uid(),
      sectionId,
      title: "Operations Officer",
      shortTitle: "",
      functionalRole: "OPERATIONS",
      defaultForRole: false,
      description: "",
      notes: "",
      rankGrade: "",
      incumbent: null,
    },
    {
      positionId: uid(),
      sectionId,
      title: "Commander",
      shortTitle: "",
      functionalRole: "COMMAND",
      defaultForRole: false,
      description: "",
      notes: "",
      rankGrade: "",
      incumbent: null,
    },
  ];
  return save(v);
}
const save = (v: UnitProfile) =>
  ws.execute({
    type: "unit-profile-save",
    profile: v,
    expectedContentVersion: v.contentVersion,
  }).profile!;
const publish = (v: UnitProfile) =>
  ws.execute({
    type: "unit-profile-publish",
    id: v.unitProfileVersionId,
    expectedContentVersion: v.contentVersion,
  }).profile!;
const fixture = () => {
  const v = publish(draft()),
    op = service.execute({
      type: "create",
      name: "Fictional M5 contract",
      demo: true,
      unitProfileVersionId: v.unitProfileVersionId,
      configuration: { id: armyConfig.organization.id, version: 1 },
    }).operation!;
  instantiateProduct(op, armyConfig, cnode.id, uid);
  instantiateProduct(
    op,
    armyConfig,
    armyConfig.doctrine.catalog!.nodes.find((n) => n.stableKey === "H")!.id,
    uid,
  );
  return {
    v,
    op: service.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!,
  };
};
const cnode = armyConfig.doctrine.catalog!.nodes.find(
  (n) => n.stableKey === "C",
)!;
function changeOverride() {
  let { v, op } = fixture();
  const product = op.attachments.find((p) => p.doctrineNodeId === cnode.id)!;
  op.staffPositionOverrides = [
    {
      productId: product.id,
      unitProfileVersionId: v.unitProfileVersionId,
      sectionId: v.staff.sections[0].sectionId,
      positionId: v.staff.positions[1].positionId,
      functionalRole: "COMMAND",
    },
  ];
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  return { v, op, product };
}
function reviewFor(opId: string) {
  const h = repo.revisionHistory(opId);
  return reviews.execute({
    type: "create-review",
    baseline: endpointSelector(h.at(-1)!.endpoint),
    target: endpointSelector(h[0].endpoint),
    engineVersion: "diff-engine-v2",
    title: "Fictional organization review",
    description: "",
    expectedRevision: h[0].endpoint.revisionNumber,
    parentReviewId: null,
    supersedesReviewId: null,
  }).review!;
}
it("starts on Dashboard independently of last operation preference", () => {
  expect(startupLocation()).toEqual({ area: "global", page: "Dashboard" });
  expect(globalPages).toEqual([
    "Dashboard",
    "Operations",
    "Organizations",
    "Doctrines",
    "Military Symbols",
    "ORBATs",
    "Library",
    "Settings",
  ]);
});
it("explicitly enters and exits operation context", () => {
  expect(enterOperation("example", "history")).toEqual({
    area: "operation",
    operationId: "example",
    page: "history",
  });
  expect(leaveOperation()).toEqual(startupLocation());
  expect(leaveOperation("Organizations")).toEqual({
    area: "global",
    page: "Organizations",
  });
});
it("navigation transitions do not mutate unsaved draft objects", () => {
  const { op } = fixture();
  const draft = structuredClone(op);
  draft.name = "Unsaved";
  leaveOperation("Doctrines");
  enterOperation(op.id);
  expect(draft.name).toBe("Unsaved");
  expect(repo.getOperation(op.id)).toEqual(op);
});
it("records v2 fingerprints and verifies controlled review references", () => {
  const { op } = changeOverride(),
    r = reviewFor(op.id);
  expect(r.comparison.diffEngineVersion).toBe("diff-engine-v2");
  expect(r.comparison.impactEngineVersion).toBe("impact-v2");
  expect(r.reportRendererVersion).toBe("review-html-v2");
  expect(
    r.comparison.changes.some((c) =>
      c.fieldPath.startsWith("staffPositionOverrides/"),
    ),
  ).toBe(true);
  expect(repo.getReview(r.id)).toEqual(r);
  repo.verifyAll();
});
it("v2 reports frozen organization provenance and escapes position labels", () => {
  const { op } = changeOverride(),
    r = reviewFor(op.id);
  const html = renderReviewReport(r);
  expect(html).toContain("review-html-v2");
  expect(html).toContain(op.operationOrganizationBinding!.unitProfileVersionId);
  expect(html).toContain(op.operationOrganizationBinding!.contentHash);
  expect(renderReviewReport(repo.getReview(r.id))).toBe(html);
  const edited = structuredClone(r);
  edited.title = '<script>alert("x")</script>';
  expect(renderReviewReport(edited)).not.toContain("<script>");
});
it("does not allow incompatible diff/impact/report version combinations", () => {
  const { op } = changeOverride(),
    r = reviewFor(op.id);
  expect(() =>
    reviewHeaderSchema.parse({ ...r, reportRendererVersion: "review-html-v1" }),
  ).toThrow();
  expect(() =>
    reviewHeaderSchema.parse({
      ...r,
      comparison: { ...r.comparison, impactEngineVersion: "impact-v1" },
    }),
  ).toThrow();
});
it("v1 refuses new M5 state rather than silently omitting it", () => {
  const { op } = changeOverride(),
    h = repo.revisionHistory(op.id);
  expect(() =>
    reviews.execute({
      type: "compare",
      baseline: endpointSelector(h[1].endpoint),
      target: endpointSelector(h[0].endpoint),
      engineVersion: "diff-engine-v1",
    }),
  ).toThrow(/v2/);
});
it("rejects unsupported comparator versions", () => {
  const { op } = fixture(),
    e = repo.resolveEndpoint(
      endpointSelector(repo.revisionHistory(op.id)[0].endpoint),
    );
  expect(() => semanticDiff("unknown", e, e, hashBytes)).toThrow();
});
it("new profile versions do not affect operation comparisons or frozen reviews", () => {
  const { op, v } = changeOverride(),
    r = reviewFor(op.id),
    html = renderReviewReport(r);
  let next = ws.execute({
    type: "unit-profile-derive",
    id: v.unitProfileVersionId,
    versionLabel: "2.0.0",
    newFamily: false,
  }).profile!;
  next.staff.positions[0].title = "Completely different";
  publish(save(next));
  expect(repo.getOperation(op.id)).toEqual(op);
  expect(repo.getReview(r.id)).toEqual(r);
  expect(renderReviewReport(repo.getReview(r.id))).toBe(html);
});
it("typed staff override restores the deterministic default when removed", () => {
  let { op } = changeOverride();
  expect(resolveResponsibleStaff(op, armyConfig, cnode.id).label).toBe(
    "Commander",
  );
  op.staffPositionOverrides = [];
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  expect(resolveResponsibleStaff(op, armyConfig, cnode.id).label).toBe(
    "Operations Officer",
  );
});
it("rejects foreign position, section, role and organization references", () => {
  const { op } = changeOverride();
  for (const key of [
    "positionId",
    "sectionId",
    "unitProfileVersionId",
  ] as const) {
    const bad = structuredClone(op);
    bad.staffPositionOverrides![0][key] = uid();
    expect(() =>
      service.execute({
        type: "save",
        operation: bad,
        expectedRevision: bad.revision,
      }),
    ).toThrow(/override/);
  }
  const bad = structuredClone(op);
  bad.staffPositionOverrides![0].functionalRole = "SIGNAL";
  expect(() =>
    service.execute({
      type: "save",
      operation: bad,
      expectedRevision: bad.revision,
    }),
  ).toThrow(/override/);
});
it("inherited product resolves parent typed staff override", () => {
  const { op } = changeOverride();
  const child = armyConfig.doctrine.catalog!.nodes.find(
    (n) =>
      n.parentStableKey === cnode.stableKey &&
      n.ownerBehavior === "INHERIT_PARENT",
  )!;
  expect(child).toBeDefined();
  instantiateProduct(op, armyConfig, child.id, uid);
  expect(resolveResponsibleStaff(op, armyConfig, child.id).label).toBe(
    "Commander",
  );
  expect(resolveResponsibleStaff(op, armyConfig, child.id).inherited).toBe(
    true,
  );
});
it("unrelated simultaneous staff changes do not claim another product's impacts", () => {
  let { v, op } = fixture();
  const c = op.attachments.find((p) => p.doctrineNodeId === cnode.id)!,
    h = op.attachments.find(
      (p) =>
        p.doctrineNodeId ===
        armyConfig.doctrine.catalog!.nodes.find((n) => n.stableKey === "H")!.id,
    )!;
  op.staffPositionOverrides = [c, h].map((p, i) => ({
    productId: p.id,
    unitProfileVersionId: v.unitProfileVersionId,
    sectionId: v.staff.sections[0].sectionId,
    positionId: v.staff.positions[i].positionId,
    functionalRole: v.staff.positions[i].functionalRole,
  }));
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  const r = reviewFor(op.id);
  const hi = r.comparison.impacts.find(
    (x) => x.kind === "EFFECTIVE_OWNER" && x.productId === h.id,
  )!;
  expect(hi).toBeDefined();
  expect(
    hi.changeIds.every(
      (id) =>
        r.comparison.changes.find((c) => c.changeId === id)!.productId === h.id,
    ),
  ).toBe(true);
});
it("exposes unresolved organization role as a warning for included products", () => {
  const v = draft();
  v.staff.positions = [];
  const p = publish(save(v)),
    op = service.execute({
      type: "create",
      name: "Fictional missing role",
      demo: true,
      unitProfileVersionId: p.unitProfileVersionId,
      configuration: { id: armyConfig.organization.id, version: 1 },
    }).operation!;
  const c = instantiateProduct(op, armyConfig, cnode.id, uid);
  c.applicability = "INCLUDED";
  expect(
    validate(op, armyConfig).some(
      (f) =>
        f.ruleId === "organization-staff-resolution" &&
        f.severity === "warning",
    ),
  ).toBe(true);
});
it("unassigned doctrinal owner does not fabricate a missing-role warning", () => {
  const { op } = fixture();
  op.metadata.ownerId = null;
  expect(resolveResponsibleStaff(op, armyConfig, null).warning).toBe("");
});
it("custom doctrine roles require explicit mapping rather than title inference", () => {
  const v = draft();
  let d = service.execute({
    type: "doctrine-create",
    sourceId: armyConfig.doctrine.id,
    name: "Fictional custom doctrine",
    versionLabel: "1.0.0",
    newFamily: true,
  });
  let custom = d.doctrines.find(
    (v) => v.doctrineVersionId === d.selectedDoctrineId,
  )!;
  d = service.execute({
    type: "doctrine-publish",
    id: custom.doctrineVersionId,
    expectedContentVersion: custom.contentVersion,
  });
  custom = d.doctrines.find(
    (v) => v.doctrineVersionId === custom.doctrineVersionId,
  )!;
  expect(
    bindOrganization(v, custom.config, "a".repeat(64)).resolvedRoleMappings,
  ).toHaveLength(0);
  v.roleMappings = [
    {
      doctrineFamilyId: custom.doctrineFamilyId,
      doctrineVersion: custom.config.doctrine.version,
      staffId: "ops",
      functionalRole: "OPERATIONS",
    },
  ];
  const mapped = publish(save(v));
  expect(
    bindOrganization(
      mapped,
      custom.config,
      repo.unitProfileHash(mapped.unitProfileVersionId),
    ).resolvedRoleMappings,
  ).toEqual([{ staffId: "ops", functionalRole: "OPERATIONS" }]);
});
it("rejects nonexistent doctrine staff mapping references", () => {
  const v = draft();
  v.roleMappings = [
    {
      doctrineFamilyId: armyConfig.doctrine.id,
      doctrineVersion: 1,
      staffId: "missing",
      functionalRole: "CUSTOM",
    },
  ];
  expect(() => save(v)).toThrow(/staff ID/);
});
it("keeps OPORD publication organization state frozen after newer global versions", () => {
  let { op, v } = changeOverride();
  op.units.forEach((u) => (u.inTaskOrganization = true));
  op.metadata.statusId = armyConfig.doctrine.publicationRequiredStatus;
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "Fictional",
  });
  const p = service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  }).publications[0];
  expect(p.snapshot.operationOrganizationBinding).toEqual(
    op.operationOrganizationBinding,
  );
  let newer = ws.execute({
    type: "unit-profile-derive",
    id: v.unitProfileVersionId,
    versionLabel: "2.0.0",
    newFamily: false,
  }).profile!;
  newer.staff.positions[0].incumbent = {
    name: "Another fictional person",
    rank: "",
    contact: "",
    notes: "",
  };
  publish(save(newer));
  expect(repo.listPublications(op.id)[0]).toEqual(p);
  repo.verifyAll();
});
it("organization-only staff override does not stale exports that never consumed it", () => {
  let { op, v } = fixture();
  const profile = repo
    .listExportProfiles(op.id)
    .find((p) => p.product === "communications-card")!;
  const e = service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId: null,
  }).exports[0];
  const p = op.attachments.find((a) => a.doctrineNodeId === cnode.id)!;
  op.staffPositionOverrides = [
    {
      productId: p.id,
      unitProfileVersionId: v.unitProfileVersionId,
      sectionId: v.staff.sections[0].sectionId,
      positionId: v.staff.positions[1].positionId,
      functionalRole: "COMMAND",
    },
  ];
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  expect(exportStaleness(e, op).outdated).toBe(false);
});
it("organization imagery is stored once as managed bytes and copied into a new version with distinct ownership", () => {
  let v = draft();
  const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
    id = uid();
  repo.modular.insertAsset(
    {
      assetId: id,
      operationId: null,
      doctrineVersionId: null,
      unitProfileVersionId: v.unitProfileVersionId,
      originalFilename: "fictional.png",
      mimeType: "image/png",
      sizeBytes: bytes.length,
      sha256: hashBytes(bytes),
      createdAt: runtime.now(),
      storageReference: `asset:${id}`,
    },
    bytes,
  );
  v.insigniaAssetId = id;
  v = publish(save(v));
  expect(canonical(v)).not.toContain(bytes.toString("base64"));
  const next = ws.execute({
    type: "unit-profile-derive",
    id: v.unitProfileVersionId,
    versionLabel: "1.1.0",
    newFamily: false,
  }).profile!;
  expect(next.insigniaAssetId).not.toBe(id);
  expect(
    repo.modular.readAsset(next.insigniaAssetId!).bytes.equals(bytes),
  ).toBe(true);
  expect(
    repo.modular.readAsset(next.insigniaAssetId!).metadata.unitProfileVersionId,
  ).toBe(next.unitProfileVersionId);
  repo.verifyAll();
});
it("rejects imagery bindings owned by a different version", () => {
  let v = draft(),
    other = draft();
  const bytes = Buffer.from("hello"),
    id = uid();
  repo.modular.insertAsset(
    {
      assetId: id,
      operationId: null,
      doctrineVersionId: null,
      unitProfileVersionId: other.unitProfileVersionId,
      originalFilename: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      sha256: hashBytes(bytes),
      createdAt: runtime.now(),
      storageReference: `asset:${id}`,
    },
    bytes,
  );
  v.insigniaAssetId = id;
  expect(() => save(v)).toThrow(/owned/);
});
it("rolls back schema-006 migration on corrupt source asset bytes", () => {
  mkdirSync(".test-data", { recursive: true });
  const p = `.test-data/m5-corrupt-${uid()}.db`;
  copyFileSync("tests/fixtures/milestone4-0.4.0.db", p);
  const db = new Database(p);
  db.exec(
    "DROP TRIGGER immutable_managed_assets_UPDATE; UPDATE managed_assets SET bytes=x'00' WHERE id=(SELECT id FROM managed_assets LIMIT 1)",
  );
  db.close();
  expect(() => new SqliteRepository(p, true)).toThrow(/mismatch/);
  const check = new Database(p);
  expect(
    check.prepare("SELECT max(version) AS n FROM schema_migrations").get(),
  ).toEqual({ n: 5 });
  expect(
    check
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='unit_profile_versions'",
      )
      .get(),
  ).toBeUndefined();
  expect(check.prepare("PRAGMA table_info(managed_assets)").all()).toHaveLength(
    5,
  );
  check.close();
});
it("backup restore retains profiles, pins, review v2 and report bytes", async () => {
  mkdirSync(".test-data", { recursive: true });
  const p = `.test-data/m5-restore-${uid()}.db`;
  await repo.backup(p);
  repo.close();
  setup(new SqliteRepository(p, true));
  const { op, v } = changeOverride(),
    r = reviewFor(op.id),
    html = renderReviewReport(r),
    backup = `.test-data/m5-backup-${uid()}.db`;
  await repo.backup(backup);
  const extra = ws.execute({
    type: "unit-profile-new",
    name: "After backup",
  }).profile!;
  await restoreWorkspace(repo, p, backup, setup);
  expect(() => repo.getUnitProfile(extra.unitProfileVersionId)).toThrow();
  expect(repo.getUnitProfile(v.unitProfileVersionId)).toEqual(v);
  expect(repo.getOperation(op.id)).toEqual(op);
  expect(repo.getReview(r.id)).toEqual(r);
  expect(renderReviewReport(repo.getReview(r.id))).toBe(html);
  repo.verifyAll();
});
it("restore verification rejects tampered organization pin indexes", () => {
  fixture();
  const guard = repo.sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE name='unit_pin_delete'")
    .get() as { sql: string };
  repo.sqlite.exec(
    "DROP TRIGGER unit_pin_delete;DELETE FROM operation_unit_profile_pins",
  );
  repo.sqlite.exec(guard.sql);
  expect(() => repo.verifyAll()).toThrow(/pin index/);
});
it("Dashboard summary serializes no module, doctrine, review-change or asset payload", () => {
  const { op } = changeOverride();
  reviewFor(op.id);
  const serialized = JSON.stringify(repo.dashboard());
  for (const field of [
    '"modules"',
    '"changes"',
    '"snapshot"',
    '"catalog"',
    '"bytes"',
    '"staff"',
  ])
    expect(serialized).not.toContain(field);
  expect(serialized).toContain("Fictional organization review");
});
it("Dashboard open review count follows append-only lifecycle without loading changes", () => {
  const { op } = changeOverride(),
    r = reviewFor(op.id);
  expect(repo.dashboard().reviews.some((x) => x.id === r.id)).toBe(true);
  reviews.execute({
    type: "review-actions",
    id: r.id,
    expectedSequence: 0,
    actions: [
      ...r.comparison.changes.map((c) => ({
        type: "DECISION" as const,
        changeId: c.changeId,
        disposition: "NOTED" as const,
        note: "",
      })),
      { type: "COMPLETE" },
    ],
    confirmedBulk: true,
  });
  vi.spyOn(repo, "listReviews").mockImplementation(() => {
    throw Error("No full review hydration");
  });
  expect(repo.dashboard().reviews.some((x) => x.id === r.id)).toBe(false);
});
