import { expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { createOperation } from "../src/domain/factories";
import { metadata, operationSchema, type Operation } from "../src/domain/model";
import { assertOperation, eventTime } from "../src/domain/invariants";
import {
  canLinkEvent,
  eventLinkOptions,
  newEventSchedule,
  resolveSchedule,
} from "../src/domain/planning-schedule";
import {
  planningProducts,
  refreshPlanningReadiness,
  setProductProgress,
} from "../src/domain/planning-progress";
import { instantiateProduct } from "../src/domain/authoring";
import { addOperationModule } from "../src/domain/module-authoring";
import { newModuleDefinition } from "../src/domain/modules";
import { planningReferences } from "../src/domain/planning-usage";
import { resolvePlanningCard } from "../src/domain/planning-card-resolution";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { DocumentLayoutReviewService } from "../src/application/document-layout-review";
import { renderReviewReport } from "../src/export/narrative-review-report";
import { documentStaleness } from "../src/application/verify-document-layout";
import { canonical } from "../src/export/projection";
import { demoOperation } from "../src/demo/operation";
import {
  alternativeIdentities,
  remapPlan,
} from "../src/domain/alternative-plan";
import { scheduleChanges } from "../src/application/planning-schedule-review";
import { calendarAxis } from "../src/renderer/src/timeline-calendar";
import {
  moduleCalendarEvent,
  editTimelineEvent,
} from "../src/domain/module-timeline";
import { projectConnectedPreview } from "../src/export/planning-cards";
import { createExportProfile } from "../src/domain/factories";
const now = "2026-10-15T12:00:00.000Z",
  rt = { id, now: () => now, actor: "Fictional planner" };
const fresh = (config = starterConfig) =>
  createOperation("Fictional schedule", config, id, now);
function events(op: Operation) {
  const first = {
    id: id(),
    name: "Assembly",
    metadata: metadata(),
    phaseId: null,
    at: now,
    relativeToEventId: null,
    offsetMinutes: 0,
    schedule: { ...newEventSchedule(), durationMinutes: 60 },
  };
  const second = {
    ...structuredClone(first),
    id: id(),
    name: "Departure",
    at: null,
    relativeToEventId: first.id,
    offsetMinutes: 15,
    schedule: { ...newEventSchedule(), relativeAnchor: "END" as const },
  };
  op.events = [first, second];
  return { first, second };
}
it("moves finish-linked descendants with time and duration, preserving start-linked offsets", () => {
  const op = fresh(),
    { first, second } = events(op);
  expect(eventTime(op, second.id)).toBe("2026-10-15T13:15:00.000Z");
  first.schedule.durationMinutes = 90;
  expect(eventTime(op, second.id)).toBe("2026-10-15T13:45:00.000Z");
  second.schedule.relativeAnchor = "START" as "END";
  expect(eventTime(op, second.id)).toBe("2026-10-15T12:15:00.000Z");
  first.at = "2026-10-16T00:00:00.000Z";
  second.offsetMinutes = -15;
  expect(eventTime(op, second.id)).toBe("2026-10-15T23:45:00.000Z");
  expect(assertOperation(op, starterConfig)).toEqual(op);
});
it("preserves legacy shapes and identical start-to-start resolution", () => {
  const op = fresh();
  events(op);
  op.events.forEach((e) => delete e.schedule);
  const json = canonical(op);
  expect(canonical(operationSchema.parse(op))).toBe(json);
  expect(eventTime(op, op.events[1].id)).toBe("2026-10-15T12:15:00.000Z");
  expect(planningProducts(op, starterConfig)[0].state).toBe("Not started");
  expect(canonical(op)).toBe(json);
});
it("keeps a custom calendar lane and its assignments together in an alternative plan", () => {
  const op = fresh();
  events(op);
  const before = structuredClone(op);
  const lane = { id: id(), name: "Lift windows", color: "amber" as const };
  op.timeline = { dDay: "2026-10-15", lanes: [lane] };
  op.events[0].schedule!.laneId = lane.id;
  const mapped = remapPlan(
    op,
    starterConfig,
    alternativeIdentities(op, starterConfig, id),
  );
  expect(mapped.timeline!.lanes![0].id).not.toBe(lane.id);
  expect(mapped.events[0].schedule!.laneId).toBe(mapped.timeline!.lanes![0].id);
  expect(assertOperation(mapped, starterConfig)).toEqual(mapped);
  expect(scheduleChanges(before, op).changes.map((c) => c.field)).toEqual(
    expect.arrayContaining(["D-Day", "Lane", "Timeline lane"]),
  );
  op.timeline.lanes = [];
  expect(() => assertOperation(op, starterConfig)).toThrow(
    "Unknown timeline lane",
  );
});
it("resolves an annex chain into exported UTC times without copying its events into the operation", () => {
  const op = fresh();
  events(op);
  const module = addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("TIMELINE", id()),
    id,
    now,
  );
  if (module.content.type !== "TIMELINE") throw Error("Expected a timeline");
  const first = {
    id: id(),
    title: "Annex window",
    description: "",
    phaseId: null,
    timing: {
      mode: "RELATIVE" as const,
      referenceEventId: op.events[0].id,
      offsetMinutes: 15,
    },
  };
  const next = {
    id: id(),
    title: "Annex check",
    description: "",
    phaseId: null,
    timing: {
      mode: "RELATIVE" as const,
      referenceEventId: first.id,
      withinModule: true as const,
      offsetMinutes: 10,
    },
    schedule: { ...newEventSchedule(), relativeAnchor: "END" as const },
  };
  module.content.items = [first, next];
  editTimelineEvent(
    op,
    moduleCalendarEvent(module.moduleInstanceId, first),
    (e) => {
      e.schedule = {
        ...newEventSchedule(),
        durationMinutes: 90,
        relativeAnchor: "END",
      };
    },
  );
  const profile = createExportProfile(op, "opord", id());
  const project = () => projectConnectedPreview(op, profile, starterConfig);
  const before = project();
  expect(JSON.stringify(before.view)).toContain("2026-10-15T14:55:00.000Z");
  op.events[0].schedule!.durationMinutes += 30;
  const after = project();
  expect(JSON.stringify(after.view)).toContain("2026-10-15T15:25:00.000Z");
  expect(after.dependencies).not.toEqual(before.dependencies);
  expect(op.events.some((e) => e.name === "Annex check")).toBe(false);
  expect(assertOperation(op, starterConfig)).toEqual(op);
});
it("aligns calendar months and relative days at UTC midnight across leap day", () => {
  const first = Date.parse("2028-02-28T23:59Z"),
    zero = Date.parse("2028-02-29T00:00Z");
  const axis = calendarAxis(
    first,
    Date.parse("2028-03-01T17:00Z"),
    600,
    "fit",
    zero,
  );
  expect(axis.bands).toEqual([
    { label: "Feb 2028", left: 0, width: 400 },
    { label: "Mar 2028", left: 400, width: 200 },
  ]);
  expect(axis.ticks.map((t) => t.relative)).toEqual(["D−1", "D", "D+1"]);
  expect(axis.zero).toBe(200);
});
it("rejects cycles, broken unit and product references, and invalid durations", () => {
  const op = fresh(),
    { first, second } = events(op);
  expect(canLinkEvent(op, first.id, second.id)).toBe(false);
  expect(canLinkEvent(op, second.id, first.id)).toBe(true);
  expect(eventLinkOptions(op, first.id)).toEqual([]);
  expect(eventLinkOptions(op, second.id).map((e) => e.id)).toEqual([first.id]);
  first.at = null as unknown as string;
  first.relativeToEventId = second.id as unknown as null;
  expect(resolveSchedule(op).get(second.id)?.issue).toMatch(/cycle/);
  expect(() => assertOperation(op, starterConfig)).toThrow(/cycle/);
  first.at = now;
  first.relativeToEventId = null;
  first.schedule.unitId = id() as unknown as null;
  expect(() => assertOperation(op, starterConfig)).toThrow(/timeline unit/);
  first.schedule.unitId = null;
  first.schedule.durationMinutes = -1;
  expect(operationSchema.safeParse(op).success).toBe(false);
  first.schedule.durationMinutes = 0;
  op.planningProgress = {
    schemaVersion: 1,
    products: [{ productId: id(), dueAt: now, readyAt: null }],
  };
  expect(() => assertOperation(op, starterConfig)).toThrow(/missing product/);
});
it("keeps missing or unscheduled predecessors visible and bounds long chains without recursion", () => {
  const op = fresh(),
    { first, second } = events(op);
  first.at = null as unknown as string;
  expect(resolveSchedule(op).get(second.id)).toMatchObject({
    start: null,
    issue: "Linked event is unscheduled",
  });
  op.events.shift();
  expect(resolveSchedule(op).get(second.id)?.issue).toMatch(/missing/);
  op.events = [];
  for (let i = 0; i < 5000; i++)
    op.events.push({
      id: id(),
      name: `Event ${i}`,
      metadata: metadata(),
      phaseId: null,
      at: i ? null : now,
      relativeToEventId: i ? op.events[i - 1].id : null,
      offsetMinutes: 1,
      schedule: newEventSchedule(),
    });
  op.events.reverse();
  expect(resolveSchedule(op).get(op.events[0].id)?.start).toBe(
    Date.parse(now) + 4999 * 60000,
  );
});
it("counts structured writing and modules without marking products ready automatically", () => {
  const op = fresh(armyConfig),
    field = armyConfig.doctrine.catalog!.baseFields.find(
      (f) => f.contentKind === "narrative",
    )!;
  op.authoring!.fields.push({
    fieldId: field.id,
    text: "Fictional briefing",
    references: [],
  });
  expect(planningProducts(op, armyConfig)[0].state).toBe("In progress");
  op.authoring!.fields = [];
  const module = addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("PLAIN_TEXT", id()),
    id,
    now,
  );
  if (module.content.type === "PLAIN_TEXT")
    module.content.text = "Written in a module";
  expect(planningProducts(op, armyConfig)[0].state).toBe("In progress");
  setProductProgress(op, op.orderId, { dueAt: "2026-10-14T12:00:00.000Z" });
  expect(planningProducts(op, armyConfig, Date.parse(now))[0].overdue).toBe(
    true,
  );
  setProductProgress(op, op.orderId, { readyAt: now });
  expect(planningProducts(op, armyConfig, Date.parse(now))[0]).toMatchObject({
    state: "Ready",
    overdue: false,
  });
  expect(op.metadata.statusId).toBe(armyConfig.doctrine.editingStatus);
});
it("lists only actual products, resolves staff and respects omitted parents", () => {
  const op = fresh(armyConfig),
    node = armyConfig.doctrine.catalog!.nodes.find(
      (n) => n.nodeType === "ANNEX" && n.status !== "SPARE",
    )!;
  expect(planningProducts(op, armyConfig)).toHaveLength(1);
  const a = instantiateProduct(op, armyConfig, node.id, id);
  a.metadata.ownerId = armyConfig.doctrine.staff[0].id;
  expect(planningProducts(op, armyConfig)[1]).toMatchObject({
    included: false,
    staff: armyConfig.doctrine.staff[0].name,
  });
  a.applicability = "INCLUDED";
  expect(planningProducts(op, armyConfig)[1].included).toBe(true);
});
it("reopens ready products after writing and shared-fact edits but preserves due-date and approval-only edits", () => {
  const before = fresh();
  before.sections[0].summary = "Draft";
  setProductProgress(before, before.orderId, { readyAt: now, dueAt: now });
  let after = structuredClone(before);
  after.sections[0].summary = "Updated";
  expect(
    refreshPlanningReadiness(before, after).planningProgress!.products[0]
      .readyAt,
  ).toBeNull();
  after = structuredClone(before);
  setProductProgress(after, after.orderId, {
    dueAt: "2026-11-01T00:00:00.000Z",
  });
  after.metadata.statusId = "approved";
  expect(
    refreshPlanningReadiness(before, after).planningProgress!.products[0]
      .readyAt,
  ).toBe(now);
  events(after);
  expect(
    refreshPlanningReadiness(before, after).planningProgress!.products[0]
      .readyAt,
  ).toBeNull();
  expect(before.planningProgress!.products[0].readyAt).toBe(now);
});
it("exposes duration, finish and assigned-unit values to explicit linked cards and usage", () => {
  const op = fresh(),
    { first, second } = events(op);
  const unit = {
    id: id(),
    name: "Fictional support company",
    metadata: metadata(),
    inTaskOrganization: true,
    parentUnitId: null,
  };
  op.units.push(unit);
  second.schedule.unitId = unit.id;
  const card = {
    id: id(),
    title: "Departure",
    mode: "linked" as const,
    source: {
      kind: "entity" as const,
      entityKind: "event" as const,
      entityId: second.id,
    },
    fields: ["name", "time", "finish", "duration", "unit"] as const,
  };
  const resolved = resolvePlanningCard(op, starterConfig, {
    ...card,
    fields: [...card.fields],
  });
  expect(resolved.values.find((v) => v.key === "time")?.value).toBe(
    "2026-10-15T13:15:00.000Z",
  );
  expect(resolved.values.find((v) => v.key === "unit")?.value).toBe(unit.name);
  expect(resolved.upstream).toContain(first.id);
  expect(
    planningReferences(op).filter((r) => r.label.includes("Scheduled unit")),
  ).toHaveLength(1);
});
it("retains schedule/progress through revision saves, export verification, reviews, and backup reopen", async () => {
  const folder = mkdtempSync(resolve(".test-data/planning-schedule-")),
    repo = new SqliteRepository(join(folder, "workspace.db"));
  try {
    repo.seedConfig(starterConfig);
    const service = new OrdoService(repo, rt, (_name, c) =>
      demoOperation(c, id, now),
    );
    let op = service.execute({
      type: "create",
      name: "Fictional schedule",
      demo: true,
    }).operation!;
    const { first, second } = events(op);
    const block = addOperationModule(
        op,
        op.orderId,
        newModuleDefinition("PLANNING_CARDS", id()),
        id,
        now,
      ),
      cardId = id();
    op.planningCards = {
      schemaVersion: 1,
      definitions: [
        {
          id: cardId,
          title: "Departure",
          mode: "linked",
          source: { kind: "entity", entityKind: "event", entityId: second.id },
          fields: ["time", "finish", "duration"],
        },
      ],
    };
    if (block.content.type === "PLANNING_CARDS")
      block.content.placements.push({ id: id(), cardId, layout: "detailed" });
    setProductProgress(op, op.orderId, { readyAt: now, dueAt: now });
    op = service.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    const baselineRevision = op.revision;
    const profile = repo
      .listExportProfiles(op.id)
      .find((p) => p.product === "opord")!;
    service.execute({
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: profile.id, version: profile.version },
      publicationId: null,
    });
    const output = repo.listExports(op.id)[0];
    expect(output.html).toContain("2026-10-15T13:15:00.000Z");
    op.events.find((e) => e.id === first.id)!.schedule!.durationMinutes = 120;
    op = service.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!;
    expect(op.planningProgress!.products[0].readyAt).toBeNull();
    expect(documentStaleness(output, op).outdated).toBe(true);
    expect(repo.listExports(op.id)[0].html).toBe(output.html);
    const history = repo.revisionHistory(op.id).map((r) => r.endpoint),
      baseline = history.find((r) => r.revisionNumber === baselineRevision)!,
      target = history.find((r) => r.revisionNumber === op.revision)!;
    const review = new DocumentLayoutReviewService(repo, rt).execute({
      type: "create-review",
      engineVersion: "diff-engine-v3",
      baseline: {
        kind: "REVISION",
        operationId: op.id,
        revisionId: baseline.revisionId,
      },
      target: {
        kind: "REVISION",
        operationId: op.id,
        revisionId: target.revisionId,
      },
      title: "Schedule review",
      description: "",
      expectedRevision: op.revision,
      parentReviewId: null,
      supersedesReviewId: null,
    }).review!;
    expect(review.reportRendererVersion).toBe("review-html-v7");
    expect(
      review.comparison.planningSchedule!.changes.some(
        (c) => c.label === "Departure" && c.field === "Resolved start",
      ),
    ).toBe(true);
    expect(renderReviewReport(review)).toContain(
      "Timeline and writing progress",
    );
    repo.verifyAll();
    await repo.backup(join(folder, "backup.db"));
    const reopened = new SqliteRepository(join(folder, "backup.db"));
    try {
      reopened.verifyAll();
      expect(reopened.getOperation(op.id)).toEqual(op);
      expect(reopened.getReview(review.id).comparison.planningSchedule).toEqual(
        review.comparison.planningSchedule,
      );
    } finally {
      reopened.close();
    }
  } finally {
    repo.close();
  }
});
