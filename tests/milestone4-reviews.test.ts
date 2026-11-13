import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { hashBytes } from "../src/persistence/modular-store";
import { reviewHash } from "../src/persistence/review-store";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { ReviewService } from "../src/application/review-service";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { endpointSelector } from "../src/persistence/review-store";
import {
  canonicalValue,
  type ComparisonEndpoint,
} from "../src/domain/diff/model";
import {
  reviewState,
  type ChangeReview,
  type ReviewAction,
} from "../src/domain/reviews";
import { renderReviewReport } from "../src/export/review-html";
import { restoreWorkspace } from "../src/persistence/restore";
import type { Operation } from "../src/domain/model";
let repo: SqliteRepository,
  service: OrdoService,
  reviews: ReviewService,
  op: Operation;
let tick = 0;
const runtime = {
  id: uid,
  now: () => new Date(Date.UTC(2026, 9, 3, 12, 0, tick++)).toISOString(),
  actor: "Fictional local reviewer",
};
function services() {
  service = new OrdoService(repo, runtime, (_name, config) =>
    demoOperation(config, uid, runtime.now()),
  );
  reviews = new ReviewService(repo, runtime);
}
beforeEach(() => {
  tick = 0;
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  services();
  op = service.execute({
    type: "create",
    name: "FICTIONAL M4",
    demo: true,
  }).operation!;
});
afterEach(() => {
  if (repo.sqlite.open) repo.close();
});
const save = (edit: (o: Operation) => void) => {
  edit(op);
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  return op;
};
const history = () =>
  reviews.execute({ type: "history", operationId: op.id }).history;
function pair(a?: ComparisonEndpoint, b?: ComparisonEndpoint) {
  const h = history();
  return {
    baseline: endpointSelector(a ?? h.at(-1)!.endpoint),
    target: endpointSelector(b ?? h[0].endpoint),
    engineVersion: "diff-engine-v1" as const,
  };
}
function create(extra: Record<string, unknown> = {}): ChangeReview {
  return reviews.execute({
    type: "create-review",
    ...pair(),
    title: "Fictional review",
    description: "Controlled review",
    expectedRevision: op.revision,
    parentReviewId: null,
    supersedesReviewId: null,
    ...extra,
  }).review!;
}
function act(r: ChangeReview, actions: ReviewAction[], confirmedBulk = false) {
  return reviews.execute({
    type: "review-actions",
    id: r.id,
    expectedSequence: r.events.length,
    actions,
    confirmedBulk,
  }).review!;
}
function publication() {
  save((o) => {
    o.units.forEach((u) => (u.inTaskOrganization = true));
    o.metadata.statusId = starterConfig.doctrine.publicationRequiredStatus;
  });
  service.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "Fictional approval",
  });
  return service.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  }).publications[0];
}
describe("M4 immutable endpoints and revision history", () => {
  it("assigns UUID sidecars without adding data to old snapshots", () => {
    save((o) => (o.name = "Second"));
    const h = history();
    expect(h).toHaveLength(2);
    expect(h[0].endpoint.revisionId).not.toBe(h[1].endpoint.revisionId);
    expect(h[0].current).toBe(true);
    expect(h[1].actor).toBe(runtime.actor);
    expect(repo.getOperation(op.id, 1)).not.toHaveProperty("revisionId");
  });
  it("compares two persisted revisions", () => {
    save((o) => (o.name = "New name"));
    const c = reviews.execute({ type: "compare", ...pair() }).comparison!;
    expect(c.changes).toHaveLength(1);
    expect(c.baseline.revisionNumber).toBe(1);
    expect(c.target.revisionNumber).toBe(2);
  });
  it("quick comparisons never create review rows", () => {
    save((o) => (o.name = "Edit"));
    reviews.execute({ type: "compare", ...pair() });
    expect(repo.listReviews(op.id)).toEqual([]);
  });
  it("publication endpoint freezes the source snapshot and configuration", () => {
    const pub = publication(),
      before = canonicalValue(pub);
    save((o) => (o.name = "After publication"));
    const a = repo.resolveEndpoint({
      kind: "PUBLICATION",
      operationId: op.id,
      publicationId: pub.id,
    });
    expect(a.operation).toEqual(pub.snapshot);
    expect(a.config).toEqual(pub.config);
    const c = reviews.execute({
      type: "compare",
      ...pair(a.endpoint),
    }).comparison!;
    expect(
      c.impacts.find((i) => i.kind === "PUBLICATION_DIVERGENCE")?.reason,
    ).toContain("remains unchanged");
    expect(canonicalValue(repo.listPublications(op.id)[0])).toBe(before);
  });
  it("can compare a saved revision to the later publication endpoint", () => {
    publication();
    const h = reviews.execute({ type: "history", operationId: op.id });
    const c = reviews.execute({
      type: "compare",
      ...pair(h.history.at(-1)!.endpoint, h.publicationEndpoints[0]),
    }).comparison!;
    expect(c.target.kind).toBe("PUBLICATION");
    expect(c.target.publicationId).toBe(
      h.publicationEndpoints[0].publicationId,
    );
  });
  it("rejects endpoint identity from another operation", () => {
    const id = op.id;
    const other = service.execute({
      type: "create",
      name: "Another",
      demo: true,
    }).operation!;
    const e = repo.revisionHistory(other.id)[0].endpoint;
    expect(() =>
      repo.resolveEndpoint({
        kind: "REVISION",
        operationId: id,
        revisionId: e.revisionId,
      }),
    ).toThrow(/not found/);
  });
  it("rejects stale expected planning revision and unknown engines", () => {
    save((o) => (o.name = "Edit"));
    expect(() => create({ expectedRevision: 1 })).toThrow(/changed/);
    expect(() =>
      reviews.execute({ type: "compare", ...pair(), engineVersion: "future" }),
    ).toThrow();
  });
  it("requires saved identities and rejects renderer supplied snapshots", () => {
    expect(() =>
      reviews.execute({ type: "create-review", ...pair(), operation: op }),
    ).toThrow();
  });
});
describe("M4 controlled review lifecycle", () => {
  it("persists exact semantic records and engine version", () => {
    save((o) => (o.name = "Edit"));
    const r = create();
    expect(repo.getReview(r.id)).toEqual(r);
    expect(r.comparison.diffEngineVersion).toBe("diff-engine-v1");
    expect(reviewState(r).counts.UNREVIEWED).toBe(1);
    repo.verifyAll();
  });
  it("rejects an altered semantic fingerprint at the repository boundary", () => {
    save((o) => (o.name = "Edit"));
    const r = create();
    const { events, ...header } = structuredClone(r);
    header.id = uid();
    header.comparison.changes[0].afterValue = "Tampered";
    expect(() => repo.insertReview(header)).toThrow(/fingerprint/);
  });
  it.each([
    "ACCEPTED",
    "REJECTED",
    "NEEDS_CHANGES",
    "NOTED",
    "UNREVIEWED",
  ] as const)(
    "records %s without altering operation, publication, export or profile",
    (disposition) => {
      save((o) => (o.name = "Edit"));
      const r = create();
      const before = [
        repo.getOperation(op.id),
        repo.listPublications(op.id),
        repo.listExports(op.id),
        repo.listExportProfiles(op.id),
      ];
      const next = act(r, [
        {
          type: "DECISION",
          changeId: r.comparison.changes[0].changeId,
          disposition,
          note: "Assessment",
        },
      ]);
      expect(
        reviewState(next).decisions[r.comparison.changes[0].changeId],
      ).toBe(disposition);
      expect([
        repo.getOperation(op.id),
        repo.listPublications(op.id),
        repo.listExports(op.id),
        repo.listExportProfiles(op.id),
      ]).toEqual(before);
    },
  );
  it("retains prior decisions and local actor/time", () => {
    save((o) => (o.name = "Edit"));
    let r = create();
    const changeId = r.comparison.changes[0].changeId;
    r = act(r, [
      {
        type: "DECISION",
        changeId,
        disposition: "REJECTED",
        note: "Earlier reason",
      },
    ]);
    r = act(r, [
      {
        type: "DECISION",
        changeId,
        disposition: "ACCEPTED",
        note: "Reconsidered",
      },
    ]);
    const s = reviewState(r);
    expect(s.decisionHistory).toHaveLength(2);
    expect(s.decisionHistory[0]).toMatchObject({
      actor: runtime.actor,
      action: { note: "Earlier reason" },
    });
    expect(Date.parse(s.decisionHistory[1].at)).toBeGreaterThan(
      Date.parse(s.decisionHistory[0].at),
    );
  });
  it("preserves separate review-level and change-level comments", () => {
    save((o) => (o.name = "Edit"));
    let r = create();
    r = act(r, [{ type: "COMMENT", changeId: null, text: "Review note" }]);
    r = act(r, [
      {
        type: "COMMENT",
        changeId: r.comparison.changes[0].changeId,
        text: "Change comment",
      },
    ]);
    expect(reviewState(r).comments.map((e) => e.action)).toEqual([
      { type: "COMMENT", changeId: null, text: "Review note" },
      {
        type: "COMMENT",
        changeId: r.comparison.changes[0].changeId,
        text: "Change comment",
      },
    ]);
  });
  it("rejects empty comments and cross-review decisions", () => {
    save((o) => (o.name = "Edit"));
    const r = create();
    expect(() =>
      act(r, [{ type: "COMMENT", changeId: null, text: "  " }]),
    ).toThrow();
    expect(() =>
      act(r, [
        { type: "DECISION", changeId: uid(), disposition: "NOTED", note: "" },
      ]),
    ).toThrow(/different/);
  });
  it("requires all dispositions and permits completion with NEEDS_CHANGES", () => {
    save((o) => (o.name = "Edit"));
    let r = create();
    expect(() => act(r, [{ type: "COMPLETE" }])).toThrow(/every change/);
    r = act(r, [
      {
        type: "DECISION",
        changeId: r.comparison.changes[0].changeId,
        disposition: "NEEDS_CHANGES",
        note: "Follow up",
      },
    ]);
    r = act(r, [{ type: "COMPLETE" }]);
    expect(reviewState(r)).toMatchObject({
      status: "COMPLETED",
      completedByLocalActor: runtime.actor,
    });
    expect(() =>
      act(r, [{ type: "COMMENT", changeId: null, text: "New" }]),
    ).toThrow(/read-only/);
  });
  it("requires explicit bulk confirmation and records each decision", () => {
    save((o) => {
      o.name = "Edit";
      o.tasks[0].purpose = "New purpose";
    });
    const r = create(),
      actions = r.comparison.changes.map((c) => ({
        type: "DECISION" as const,
        changeId: c.changeId,
        disposition: "NOTED" as const,
        note: "Bulk",
      }));
    expect(() => act(r, actions)).toThrow(/Confirm/);
    expect(act(r, actions, true).events).toHaveLength(actions.length);
  });
  it("rejects stale decision sequence and rolls failed batches back", () => {
    save((o) => (o.name = "Edit"));
    const r = create();
    act(r, [{ type: "COMMENT", changeId: null, text: "First" }]);
    expect(() =>
      act(r, [{ type: "COMMENT", changeId: null, text: "Stale" }]),
    ).toThrow(/changed/);
    const current = repo.getReview(r.id);
    expect(() =>
      act(
        current,
        [
          { type: "COMMENT", changeId: null, text: "Rollback" },
          { type: "COMPLETE" },
        ],
        true,
      ),
    ).toThrow();
    expect(repo.getReview(r.id)).toEqual(current);
  });
  it("title and description edits are events, leaving the frozen header intact", () => {
    save((o) => (o.name = "Edit"));
    const r = create(),
      next = act(r, [
        {
          type: "METADATA",
          title: "Renamed review",
          description: "Updated description",
        },
      ]);
    expect(next.title).toBe(r.title);
    expect(reviewState(next).title).toBe("Renamed review");
    expect(next.comparison).toEqual(r.comparison);
  });
  it("follow-on review remains separate from a completed historical target", () => {
    save((o) => (o.name = "Edit"));
    let r = create();
    r = act(r, [
      {
        type: "DECISION",
        changeId: r.comparison.changes[0].changeId,
        disposition: "NOTED",
        note: "",
      },
    ]);
    r = act(r, [{ type: "COMPLETE" }]);
    save((o) => (o.name = "Later edit"));
    const next = create({ parentReviewId: r.id });
    expect(next.parentReviewId).toBe(r.id);
    expect(next.comparison.target.revisionNumber).toBe(3);
    expect(repo.getReview(r.id)).toEqual(r);
    expect(r.comparison.target.revisionNumber).toBe(2);
  });
  it("supersession links atomically and archive retains every record", () => {
    save((o) => (o.name = "Edit"));
    const r = create(),
      next = create({ supersedesReviewId: r.id });
    expect(reviewState(repo.getReview(r.id))).toMatchObject({
      status: "SUPERSEDED",
      replacementReviewId: next.id,
    });
    const archived = act(next, [{ type: "ARCHIVE" }]);
    expect(reviewState(archived).status).toBe("ARCHIVED");
    expect(() => create({ supersedesReviewId: archived.id })).toThrow();
    expect(repo.listReviews(op.id)).toHaveLength(2);
    repo.verifyAll();
  });
  it("frozen endpoints, change set, events and revision IDs reject direct SQL mutation", () => {
    save((o) => (o.name = "Edit"));
    let r = create();
    r = act(r, [{ type: "COMMENT", changeId: null, text: "Immutable" }]);
    for (const table of [
      "change_reviews",
      "change_review_changes",
      "change_review_events",
      "revision_identities",
    ]) {
      expect(() => repo.sqlite.prepare(`DELETE FROM ${table}`).run()).toThrow(
        /immutable/i,
      );
      expect(() =>
        repo.sqlite
          .prepare(
            `UPDATE ${table} SET ${table === "change_review_changes" ? "fingerprint='x'" : table === "revision_identities" ? "revision=999" : "document='{}'"}`,
          )
          .run(),
      ).toThrow(/immutable/i);
    }
    expect(() =>
      repo.sqlite
        .prepare("INSERT INTO change_review_changes VALUES(?,?,?,?,?)")
        .run(r.id, uid(), "f".repeat(64), 1, "{}"),
    ).toThrow();
  });
  it("an exact review survives a file-backed restart without recomputing changes", () => {
    const folder = resolve(".test-data", uid());
    mkdirSync(folder, { recursive: true });
    repo.close();
    repo = new SqliteRepository(join(folder, "ordo.db"));
    repo.seedConfig(starterConfig);
    services();
    op = service.execute({
      type: "create",
      name: "Restart",
      demo: true,
    }).operation!;
    save((o) => (o.name = "Edit"));
    let r = create();
    r = act(r, [{ type: "COMMENT", changeId: null, text: "Retained" }]);
    repo.close();
    repo = new SqliteRepository(join(folder, "ordo.db"));
    services();
    expect(repo.getReview(r.id)).toEqual(r);
    repo.verifyAll();
  });
});
describe("M4 reporting, upgrades and restore", () => {
  it("replays the frozen v1 desktop review fixture and report exactly", () => {
    const manifest = JSON.parse(
      readFileSync("tests/fixtures/milestone4-review-v1.json", "utf8"),
    );
    for (const [file, hash] of Object.entries(manifest.semantics))
      expect(hashBytes(readFileSync(file))).toBe(hash);
    const folder = resolve(".test-data", uid());
    mkdirSync(folder, { recursive: true });
    const path = join(folder, "historical-review.db");
    copyFileSync("tests/fixtures/milestone4-review-v1.db", path);
    const historical = new SqliteRepository(path);
    try {
      historical.verifyAll();
      const r = historical.getReview(manifest.reviewId);
      expect(reviewHash(canonicalValue(r.comparison))).toBe(
        manifest.comparisonHash,
      );
      expect(reviewHash(canonicalValue(r.events))).toBe(manifest.eventsHash);
      expect(reviewHash(renderReviewReport(r))).toBe(manifest.reportHash);
      expect(r.comparison.changes).toHaveLength(manifest.changes);
      expect(r.events).toHaveLength(manifest.events);
      expect(reviewState(r).status).toBe("COMPLETED");
    } finally {
      historical.close();
    }
  });
  it("preserves unknown historical exports and explains unavailable impact semantics", () => {
    const load = repo.listExports.bind(repo);
    repo.listExports = () => [
      {
        id: uid(),
        profile: { name: "Historical artifact" },
        projectionVersion: 999,
      } as any,
    ];
    const c = reviews.execute({ type: "compare", ...pair() }).comparison!;
    expect(c.diagnostics).toMatchObject([{ code: "UNSUPPORTED_PROJECTION" }]);
    expect(c.impacts).toEqual([]);
    repo.listExports = load;
  });
  it("renders an escaped read-only report with frozen provenance and event sequence", () => {
    save((o) => (o.name = '<img src=x onerror="alert(1)">'));
    let r = create();
    r = act(r, [
      { type: "COMMENT", changeId: null, text: "<script>bad()</script>" },
    ]);
    const html = renderReviewReport(r);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain(r.comparison.baseline.stateHash);
    expect(html).toContain("Event sequence 1");
    expect(html).toContain("review-html-v1");
    expect(() => renderReviewReport(r, "unknown" as any)).toThrow();
  });
  it.each(["milestone2-0.2.0.db", "milestone3-0.3.0.db"])(
    "upgrades actual %s preserving historical rows exactly",
    (fixture) => {
      const folder = resolve(".test-data", uid());
      mkdirSync(folder, { recursive: true });
      const file = join(folder, "upgraded.db");
      copyFileSync(`tests/fixtures/${fixture}`, file);
      const raw = new Database(file);
      const tables = [
        "operation_revisions",
        "publications",
        "exports",
        "profile_versions",
      ];
      const before = tables.map((t) =>
        raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      );
      raw.close();
      const upgraded = new SqliteRepository(file);
      try {
        upgraded.verifyAll();
        expect(
          tables.map((t) =>
            upgraded.sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          ),
        ).toEqual(before);
        expect(
          upgraded.sqlite
            .prepare("SELECT MAX(version) AS v FROM schema_migrations")
            .get(),
        ).toEqual({ v: 20 });
        const ops = upgraded.listOperations();
        for (const op of ops) {
          const hs = upgraded.revisionHistory(op.id);
          expect(hs.length).toBeGreaterThan(0);
          const rev = new ReviewService(upgraded, runtime).execute({
            type: "compare",
            baseline: endpointSelector(hs.at(-1)!.endpoint),
            target: endpointSelector(hs[0].endpoint),
            engineVersion: "diff-engine-v1",
          });
          expect(rev.comparison!.baseline.operationId).toBe(op.id);
        }
      } finally {
        upgraded.close();
      }
    },
  );
  it("backup and restore reproduce exact reviews, decisions, comments and UUID endpoints", async () => {
    const folder = resolve(".test-data", uid());
    mkdirSync(folder, { recursive: true });
    repo.close();
    const path = join(folder, "ordo.db"),
      backup = join(folder, "backup.db");
    repo = new SqliteRepository(path);
    repo.seedConfig(starterConfig);
    services();
    op = service.execute({
      type: "create",
      name: "Restore",
      demo: true,
    }).operation!;
    save((o) => (o.name = "Baseline change"));
    let r = create();
    r = act(r, [
      {
        type: "DECISION",
        changeId: r.comparison.changes[0].changeId,
        disposition: "NOTED",
        note: "Reason",
      },
    ]);
    r = act(r, [{ type: "COMMENT", changeId: null, text: "Saved note" }]);
    const hs = history();
    await repo.backup(backup);
    save((o) => (o.name = "After backup"));
    act(r, [{ type: "COMMENT", changeId: null, text: "After backup note" }]);
    create();
    await restoreWorkspace(repo, path, backup, (next) => {
      repo = next;
      services();
    });
    op = repo.getOperation(op.id);
    expect(history()).toEqual(hs);
    expect(repo.listReviews(op.id)).toEqual([r]);
    repo.close();
    repo = new SqliteRepository(path);
    services();
    expect(repo.getReview(r.id)).toEqual(r);
    repo.verifyAll();
  });
  it("restore verification rejects tampered review source bindings and missing protection", () => {
    save((o) => (o.name = "Edit"));
    const r = create();
    repo.sqlite.exec("DROP TRIGGER review_header_update");
    expect(() => repo.verifyAll()).toThrow(/protection/);
    const row = repo.sqlite
      .prepare("SELECT document FROM change_reviews WHERE id=?")
      .get(r.id) as { document: string };
    const doc = JSON.parse(row.document);
    doc.comparison.baseline.stateHash = "a".repeat(64);
    repo.sqlite
      .prepare("UPDATE change_reviews SET document=? WHERE id=?")
      .run(JSON.stringify(doc), r.id);
    expect(() => repo.verifyAll()).toThrow(/hash|source/);
  });
});
