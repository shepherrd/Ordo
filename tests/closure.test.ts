import { beforeEach, afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepository } from "../src/persistence/repository";
import { restoreWorkspace } from "../src/persistence/restore";
import migration1 from "../src/persistence/migrations/001.sql?raw";
import { OrdoService } from "../src/application/service";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import {
  approvalSchema,
  exportRecordSchema,
  renderTemplateSchema,
  type Operation,
  type ExportProfile,
} from "../src/domain/model";
import { eventTime } from "../src/domain/invariants";
import { createExportProfile } from "../src/domain/factories";
import {
  canonical,
  project,
  projectVersion,
  exportStaleness,
} from "../src/export/projection";
import { templateFor } from "../src/export/templates";
import { renderHtml } from "../src/export/html";
import { validate } from "../src/validation/engine";

let repo: SqliteRepository,
  service: OrdoService,
  op: Operation,
  card: ExportProfile;
let folder: string;
const makeService = (repository: SqliteRepository) =>
  new OrdoService(
    repository,
    {
      id: randomUUID,
      now: () => new Date().toISOString(),
      actor: "Closure test planner",
    },
    () => demoOperation(starterConfig, randomUUID, new Date().toISOString()),
  );
beforeEach(() => {
  folder = join(process.cwd(), ".test-data", `closure-${randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  repo = new SqliteRepository(join(folder, "active.db"));
  repo.seedConfig(starterConfig);
  service = makeService(repo);
  const state = service.execute({
    type: "create",
    name: "DEMO CLOSURE",
    demo: true,
  });
  op = state.operation!;
  card = state.profiles.find((p) => p.product === "communications-card")!;
});
afterEach(() => {
  if (repo.sqlite.open) repo.close();
});
const save = () => {
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
};
const approve = () => {
  op.units.forEach((u) => {
    u.inTaskOrganization = true;
  });
  op.metadata.statusId = "approved";
  save();
  return service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "DEMO exact revision reviewed",
  }).approvals[0];
};
const publish = () =>
  service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  }).publications[0];
const generate = (profile = card) => {
  service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    publicationId: null,
    profileRef: { id: profile.id, version: profile.version },
  });
  return repo
    .listExports(op.id)
    .find(
      (e) =>
        e.profile.id === profile.id && e.profile.version === profile.version,
    )!;
};
const persistProfile = () => {
  card = service
    .execute({ type: "save-profile", profile: card, isNew: false })
    .profiles.find((p) => p.id === card.id)!;
};
const counts = () =>
  [
    "operations",
    "operation_revisions",
    "audit_events",
    "revision_approvals",
    "publications",
    "exports",
  ].map((t) => repo.sqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get());

describe("same-operation integrity and atomicity", () => {
  const cases: [string, (a: Operation, b: Operation) => void][] = [
    [
      "task unit",
      (a, b) => {
        a.tasks[0].unitId = b.units[0].id;
      },
    ],
    [
      "task objective",
      (a, b) => {
        a.tasks[0].objectiveId = b.objectives[0].id;
      },
    ],
    [
      "task phase",
      (a, b) => {
        a.tasks[0].phaseId = b.phases[0].id;
      },
    ],
    [
      "event reference",
      (a, b) => {
        a.events[1].relativeToEventId = b.events[0].id;
      },
    ],
    [
      "event phase",
      (a, b) => {
        a.events[0].phaseId = b.phases[0].id;
      },
    ],
    [
      "unit parent",
      (a, b) => {
        a.units[0].parentUnitId = b.units[0].id;
      },
    ],
    [
      "net participant",
      (a, b) => {
        a.signal.nets[0].participantUnitIds = [b.units[0].id];
      },
    ],
    [
      "net phase",
      (a, b) => {
        a.signal.nets[0].phaseIds = [b.phases[0].id];
      },
    ],
    [
      "PACE audience",
      (a, b) => {
        a.signal.pacePlans[0].unitIds = [b.units[0].id];
      },
    ],
    [
      "PACE phase",
      (a, b) => {
        a.signal.pacePlans[0].phaseIds = [b.phases[0].id];
      },
    ],
    [
      "attachment parent",
      (a, b) => {
        a.attachments.find((x) => x.kind === "appendix")!.parentId =
          b.attachments[0].id;
      },
    ],
    [
      "annex order parent",
      (a, b) => {
        a.attachments[0].parentId = b.orderId;
      },
    ],
    [
      "attachment audience",
      (a, b) => {
        a.attachments[0].unitIds = [b.units[0].id];
      },
    ],
    [
      "attachment phase",
      (a, b) => {
        a.attachments[0].phaseIds = [b.phases[0].id];
      },
    ],
  ];
  it.each(cases)(
    "rejects foreign %s through repository without partial history",
    (_name, corrupt) => {
      const other = service.execute({
        type: "create",
        name: "DEMO OTHER",
        demo: true,
      }).operation!;
      const before = repo.getOperation(op.id),
        beforeOther = repo.getOperation(other.id),
        beforeCounts = counts();
      corrupt(op, other);
      op.name = "Must not persist";
      op.revision++;
      expect(() =>
        repo.saveOperation(op, before.revision, "Local test"),
      ).toThrow();
      expect(repo.getOperation(op.id)).toEqual(before);
      expect(repo.getOperation(other.id)).toEqual(beforeOther);
      expect(counts()).toEqual(beforeCounts);
      repo.verifyAll();
    },
  );
  it.each(["unit_id", "objective_id", "phase_id"])(
    "SQL composite FK rejects foreign task %s",
    (field) => {
      const b = service.execute({
        type: "create",
        name: "DEMO OTHER",
        demo: true,
      }).operation!;
      const foreign =
        field === "unit_id"
          ? b.units[0].id
          : field === "objective_id"
            ? b.objectives[0].id
            : b.phases[0].id;
      expect(() =>
        repo.transaction(() => {
          repo.sqlite
            .prepare("UPDATE operations SET revision=99 WHERE id=?")
            .run(op.id);
          repo.sqlite
            .prepare(`UPDATE tasks SET ${field}=? WHERE id=?`)
            .run(foreign, op.tasks[0].id);
        }),
      ).toThrow(/FOREIGN KEY/);
      expect(repo.getOperation(op.id).revision).toBe(1);
    },
  );
  it("SQL rejects foreign event, attachment parent, and net participant", () => {
    const b = service.execute({
      type: "create",
      name: "DEMO OTHER",
      demo: true,
    }).operation!;
    expect(() =>
      repo.sqlite
        .prepare("UPDATE events SET relative_to_id=? WHERE id=?")
        .run(b.events[0].id, op.events[1].id),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      repo.sqlite
        .prepare("UPDATE attachments SET parent_attachment_id=? WHERE id=?")
        .run(
          b.attachments[0].id,
          op.attachments.find((a) => a.kind === "appendix")!.id,
        ),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      repo.sqlite
        .prepare("INSERT INTO net_participants VALUES(?,?,?)")
        .run(op.id, op.signal.nets[0].id, b.units[0].id),
    ).toThrow(/FOREIGN KEY/);
    repo.verifyAll();
  });
  it("distinguishes unassigned drafts, invalid references, and missing purpose non-destructively", () => {
    op.tasks[0].unitId = null;
    op.tasks[0].purpose = "";
    const before = canonical(op),
      first = validate(op, starterConfig);
    expect(first.find((f) => f.ruleId === "task-unit")?.message).toContain(
      "incomplete draft",
    );
    expect(first.find((f) => f.ruleId === "task-purpose")?.severity).toBe(
      "warning",
    );
    expect(canonical(op)).toBe(before);
    op.tasks[0].unitId = randomUUID();
    expect(
      validate(op, starterConfig).find((f) => f.ruleId === "task-unit")
        ?.message,
    ).toContain("outside this operation");
    op.attachments[0].parentId = randomUUID();
    expect(
      validate(op, starterConfig).find(
        (f) => f.entityId === op.attachments[0].id,
      ),
    ).toMatchObject({ field: "parentId", severity: "error", revision: 1 });
  });
  it("rejects attachment cycles before they reach persistence", () => {
    op.attachments[0].parentId = op.attachments.find(
      (a) => a.kind === "exhibit",
    )!.id;
    expect(save).toThrow(/annex must belong to a order/);
    expect(repo.getOperation(op.id).revision).toBe(1);
  });
});

describe("revision-bound approvals and publication", () => {
  it("workflow status alone cannot publish and stale review cannot approve", () => {
    op.units.forEach((u) => {
      u.inTaskOrganization = true;
    });
    op.metadata.statusId = "approved";
    save();
    expect(publish).toThrow(/exact revision/);
    expect(() =>
      service.execute({
        type: "approve",
        operationId: op.id,
        expectedRevision: 1,
        note: "Old",
      }),
    ).toThrow(/changed/);
    expect(repo.listApprovals(op.id)).toEqual([]);
  });
  it("retains immutable attributed approval N, refuses N+1, and accepts new explicit approval", () => {
    const a = approve(),
      p = publish();
    expect(approvalSchema.parse(a)).toMatchObject({
      sourceRevision: op.revision,
      operationId: op.id,
      scope: "OPORD",
      origin: "explicit-approval",
    });
    expect(p.approvalId).toBe(a.id);
    expect(p.approval).toEqual({ actor: a.actor, at: a.at, note: a.note });
    expect(() =>
      service.execute({
        type: "approve",
        operationId: op.id,
        expectedRevision: op.revision,
        note: "Duplicate",
      }),
    ).toThrow();
    for (const sql of [
      "UPDATE revision_approvals SET document='{}'",
      "DELETE FROM revision_approvals",
      "DELETE FROM publication_approvals",
    ])
      expect(() => repo.sqlite.exec(sql)).toThrow(/immutable/);
    op.signal.nets[0].channel = "DEMO AFTER APPROVAL";
    save();
    expect(op.revision).toBe(a.sourceRevision + 1);
    expect(op.metadata.statusId).toBe("draft");
    expect(repo.listApprovals(op.id)).toEqual([a]);
    expect(repo.listPublications(op.id)).toEqual([p]);
    expect(publish).toThrow(/Approve/);
    op.metadata.statusId = "approved";
    save();
    expect(publish).toThrow(/exact revision/);
    const a2 = service.execute({
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "New review",
    }).approvals[0];
    expect(publish()).toMatchObject({
      approvalId: a2.id,
      supersedesId: p.id,
      version: 2,
    });
    repo.verifyAll();
  });
  it("cannot bind publication to another operation's approval even at SQL boundary", () => {
    approve();
    const p = publish();
    const other = service.execute({
      type: "create",
      name: "DEMO SECOND",
      demo: true,
    }).operation!;
    expect(() =>
      repo.sqlite.prepare("INSERT INTO publications VALUES(?,?,?,?,?,?)").run(
        randomUUID(),
        other.id,
        1,
        1,
        null,
        JSON.stringify({
          ...p,
          id: randomUUID(),
          operationId: other.id,
          sourceRevision: 1,
        }),
      ),
    ).toThrow(/exact revision approval/);
    expect(repo.listPublications(other.id)).toEqual([]);
  });
  it("canonical event updates live Timeline and OPORD but leaves the publication frozen", () => {
    approve();
    const p = publish();
    const full = createExportProfile(op, "opord", randomUUID()),
      oldTime = eventTime(op, op.events[1].id);
    op.events[0].at = "2026-10-01T18:00:00.000Z";
    save();
    const updated = eventTime(op, op.events[1].id);
    expect(updated).toBe("2026-10-01T19:00:00.000Z");
    expect(JSON.stringify(project(op, full, starterConfig).view)).toContain(
      updated,
    );
    expect(eventTime(p.snapshot, p.snapshot.events[1].id)).toBe(oldTime);
    expect(JSON.stringify(project(p.snapshot, full, p.config).view)).toContain(
      oldTime,
    );
  });
});

describe("versioned projection and render provenance", () => {
  it("records exact source/config/profile/template/implementation provenance", () => {
    const e = generate();
    expect(exportRecordSchema.parse(e)).toMatchObject({
      schemaVersion: 2,
      projectionVersion: 2,
      rendererVersion: "html-v1",
      sourceRevision: 1,
      sourcePublicationId: null,
      actor: "Closure test planner",
    });
    expect(e.profile).toEqual(card);
    expect(e.config).toEqual(starterConfig);
    expect(e.renderTemplateId).toBe(templateFor(card.product).id);
    expect(
      repo.getRenderTemplate(e.renderTemplateId!, e.renderTemplateVersion!),
    ).toEqual(templateFor(card.product));
    expect(() =>
      repo.sqlite.exec("UPDATE render_template_versions SET document='{}'"),
    ).toThrow(/immutable/);
    expect(() =>
      renderTemplateSchema.parse({ ...templateFor("opord"), arbitrary: true }),
    ).toThrow();
    expect(() =>
      exportRecordSchema.parse({ ...e, renderTemplateId: undefined }),
    ).toThrow();
  });
  it("retains projection v1 behavior when v2 inclusion semantics differ", () => {
    card.inclusion.includeNetName = false;
    persistProfile();
    const e = generate(),
      legacy = {
        ...e,
        projectionVersion: 1,
        dependencies: projectVersion(1, op, card, starterConfig).dependencies,
      };
    expect(e.html).not.toContain(op.signal.nets[0].name);
    expect(
      legacy.dependencies.some(
        (d) => d.path === `nets/${op.signal.nets[0].id}/name`,
      ),
    ).toBe(true);
    expect(exportStaleness(legacy, op).outdated).toBe(false);
    op.signal.nets[0].name = "DEMO RENAMED";
    expect(exportStaleness(e, op).outdated).toBe(false);
    expect(exportStaleness(legacy, op).outdated).toBe(true);
  });
  it("render-only changes cannot mark facts stale; unsupported projection reports compatibility separately", () => {
    const e = generate();
    expect(
      exportStaleness(
        { ...e, rendererVersion: "html-future", renderTemplateVersion: 99 },
        op,
      ),
    ).toMatchObject({ outdated: false, compatibility: "supported" });
    expect(exportStaleness({ ...e, projectionVersion: 999 }, op)).toEqual({
      outdated: null,
      compatibility: "unsupported-projection",
      changedPaths: [],
    });
    expect(exportStaleness({ ...e, projectionVersion: 1 }, op).outdated).toBe(
      false,
    );
  });
  it("detects dynamic matching membership under both UNIT A and PHASE I while ignoring nonmatches", () => {
    card.inclusion.audienceUnitIds = [op.units[0].id];
    card.inclusion.phaseIds = [op.phases[0].id];
    persistProfile();
    const e = generate();
    op.signal.nets.push({
      ...structuredClone(op.signal.nets[0]),
      id: randomUUID(),
      name: "DEMO NONMATCH",
      phaseIds: [op.phases[1].id],
    });
    expect(exportStaleness(e, op).outdated).toBe(false);
    op.signal.nets.at(-1)!.phaseIds = [op.phases[0].id];
    expect(exportStaleness(e, op).changedPaths).toContain(
      "selection/radio-nets",
    );
  });
  it("removing an unused attachment does not invalidate a card", () => {
    const e = generate();
    op.attachments = [];
    expect(exportStaleness(e, op).outdated).toBe(false);
  });
  it("template layout is actually consumed and all content remains escaped", () => {
    const t = {
      ...templateFor("communications-card"),
      accent: "#123456",
      name: "Renamed layout",
    };
    const html = renderHtml(
      project(op, card, starterConfig).view,
      "<script>alert(1)</script>",
      t,
    );
    expect(html).toContain('data-layout="signal-card"');
    expect(html).toContain("#123456");
    expect(html).not.toContain("<script>");
  });
});

describe("restore safety and migrations", () => {
  const restore = (path: string, opener?: (path: string) => SqliteRepository) =>
    restoreWorkspace(
      repo,
      join(folder, "active.db"),
      path,
      (r) => {
        repo = r;
        service = makeService(r);
      },
      opener,
    );
  it("restores history, approvals, profile versions, templates and preferences; retains recovery; reopens", async () => {
    approve();
    publish();
    card.inclusion.netFields = ["system"];
    persistProfile();
    generate();
    repo.preferences({
      schemaVersion: 1,
      timeDisplay: "local",
      pageSize: "a4",
    });
    const before = service.load(op.id),
      path = join(folder, "valid.db");
    await repo.backup(path);
    op.name = "DEMO AFTER BACKUP";
    save();
    const after = structuredClone(op);
    const result = await restore(path);
    expect(service.load(before.operation!.id)).toEqual(before);
    repo.verifyAll();
    const recovery = new SqliteRepository(result.recoveryPath, true);
    try {
      expect(recovery.getOperation(op.id)).toEqual(after);
      recovery.verifyAll();
    } finally {
      recovery.close();
    }
    repo.close();
    repo = new SqliteRepository(join(folder, "active.db"), true);
    service = makeService(repo);
    expect(service.load(op.id)).toEqual(before);
  });
  it.each([
    "corrupt",
    "unrelated",
    "newer",
    "lineage-gap",
    "checksum",
    "damaged-history",
    "missing-trigger",
    "profile-provenance",
    "approval-provenance",
  ])(
    "rejects %s candidate without replacing active workspace",
    async (kind) => {
      approve();
      publish();
      generate();
      const before = service.load(op.id),
        beforeCounts = counts(),
        path = join(folder, "candidate.db");
      if (kind === "corrupt") writeFileSync(path, "not sqlite");
      else if (kind === "unrelated") {
        const raw = new Database(path);
        raw.exec("CREATE TABLE unrelated (id INTEGER)");
        raw.close();
      } else {
        await repo.backup(path);
        const raw = new Database(path);
        if (kind === "newer")
          raw.exec("INSERT INTO schema_migrations VALUES(999,'future')");
        if (kind === "lineage-gap")
          raw.exec("DELETE FROM schema_migrations WHERE version=1");
        if (kind === "checksum")
          raw.exec(
            "UPDATE schema_migrations SET checksum='wrong' WHERE version=1",
          );
        if (kind === "damaged-history") {
          raw.exec(
            "DROP TRIGGER immutable_operation_revisions_UPDATE; UPDATE operation_revisions SET snapshot=json_set(snapshot,'$.name','Tampered') WHERE revision=1;",
          );
        }
        if (kind === "missing-trigger")
          raw.exec("DROP TRIGGER immutable_exports_DELETE");
        if (kind === "profile-provenance")
          raw.exec(
            "DROP TRIGGER immutable_exports_UPDATE; UPDATE exports SET document=json_set(document,'$.profile.name','Forged'); CREATE TRIGGER immutable_exports_UPDATE BEFORE UPDATE ON exports BEGIN SELECT RAISE(ABORT,'History is immutable'); END;",
          );
        if (kind === "approval-provenance")
          raw.exec(
            "DROP TRIGGER immutable_revision_approvals_UPDATE; UPDATE revision_approvals SET document=json_set(document,'$.note','Forged'); CREATE TRIGGER immutable_revision_approvals_UPDATE BEFORE UPDATE ON revision_approvals BEGIN SELECT RAISE(ABORT,'History is immutable'); END;",
          );
        raw.close();
      }
      await expect(restore(path)).rejects.toThrow();
      expect(repo.sqlite.open).toBe(true);
      expect(service.load(op.id)).toEqual(before);
      expect(counts()).toEqual(beforeCounts);
      repo.verifyAll();
    },
  );
  it("recovers the active workspace when replacement activation fails after the swap", async () => {
    const path = join(folder, "good.db");
    await repo.backup(path);
    op.name = "DEMO CURRENT";
    save();
    const before = service.load(op.id);
    await expect(
      restore(path, () => {
        throw Error("Injected activation failure");
      }),
    ).rejects.toThrow(/activation/);
    expect(service.load(op.id)).toEqual(before);
    repo.verifyAll();
  });
  it("upgrades schema 001 history additively and labels legacy approvals without fabricating explicit actions", async () => {
    approve();
    publish();
    generate();
    const path = join(folder, "legacy.db"),
      raw = new Database(path);
    raw.exec(migration1);
    raw.exec(
      "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL)",
    );
    raw
      .prepare("INSERT INTO schema_migrations VALUES(1,?)")
      .run(createHash("sha256").update(migration1).digest("hex"));
    raw.pragma("application_id = 1330791503");
    const legacyDocuments: Record<string, string> = {};
    for (const table of [
      "profile_versions",
      "operations",
      "operation_revisions",
      "units",
      "phases",
      "objectives",
      "tasks",
      "events",
      "attachments",
      "radio_nets",
      "net_participants",
      "pace_plans",
      "export_profile_versions",
      "publications",
      "exports",
      "audit_events",
      "preferences",
    ]) {
      for (const row of repo.sqlite
        .prepare(`SELECT * FROM ${table}`)
        .all() as Record<string, any>[]) {
        if (table === "publications" || table === "exports") {
          const doc = JSON.parse(row.document);
          doc.schemaVersion = 1;
          delete doc.approvalId;
          delete doc.renderTemplateId;
          delete doc.renderTemplateVersion;
          if (table === "exports") {
            doc.projectionVersion = 1;
            doc.dependencies = projectVersion(
              1,
              op,
              card,
              starterConfig,
            ).dependencies;
          }
          row.document = JSON.stringify(doc);
          legacyDocuments[table] = row.document;
        }
        if (table === "attachments") {
          // The schema-001 fixture must contain only columns that existed in 001.
          expect(row.doctrine_node_id).toBeNull();
          expect(row.applicability).toBeNull();
          delete row.doctrine_node_id;
          delete row.applicability;
        }
        const keys = Object.keys(row);
        raw
          .prepare(
            `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
          )
          .run(...Object.values(row));
      }
    }
    for (const t of [
      "profile_versions",
      "operation_revisions",
      "export_profile_versions",
      "publications",
      "exports",
      "audit_events",
    ])
      for (const action of ["UPDATE", "DELETE"])
        raw.exec(
          `CREATE TRIGGER immutable_${t}_${action} BEFORE ${action} ON ${t} BEGIN SELECT RAISE(ABORT,'History is immutable'); END;`,
        );
    raw.close();
    await restore(path);
    repo.verifyAll();
    expect(
      repo.sqlite
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
      { version: 17 },
      { version: 18 },
      { version: 19 },
      { version: 20 },
    ]);
    for (const t of ["publications", "exports"])
      expect(
        (
          repo.sqlite.prepare(`SELECT document FROM ${t}`).get() as {
            document: string;
          }
        ).document,
      ).toBe(legacyDocuments[t]);
    expect(repo.listApprovals(op.id)[0].origin).toBe("legacy-publication");
    expect(repo.listPublications(op.id)[0].approvalId).toBe(
      repo.listApprovals(op.id)[0].id,
    );
    expect(repo.listExports(op.id)[0].renderTemplateId).toBe(
      templateFor("communications-card").id,
    );
    expect(service.load(op.id).exports[0].staleness.outdated).toBe(false);
    const explicit = service
      .execute({
        type: "approve",
        operationId: op.id,
        expectedRevision: op.revision,
        note: "Actual action after upgrade",
      })
      .approvals.find((a) => a.origin === "explicit-approval");
    expect(explicit).toBeDefined();
  });
});
