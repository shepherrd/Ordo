import {
  operationSchema,
  type Operation,
  type ResolvedConfig,
  type ExportProfile,
} from "./model";
import { authoringFindings } from "./authoring";
import { moduleFindings } from "./module-authoring";
import { assertOrganizationState } from "./unit-profiles";
import { assertLayout } from "./orbat";
import { assertPlanningSchedule, resolveSchedule } from "./planning-schedule";

export function assertOperation(
  input: unknown,
  config: ResolvedConfig,
): Operation {
  const op = operationSchema.parse(input);
  assertOrganizationState(op);
  assertPlanningSchedule(op);
  if (op.orbatLayout)
    assertLayout(op.orbatLayout, new Set(op.units.map((u) => u.id)));
  if ((op.schemaVersion === 2) !== (config.doctrine.schemaVersion === 2))
    throw Error(
      "Operation authoring schema must match its pinned doctrine schema",
    );
  for (const [ref, profile] of [
    [op.doctrineRef, config.doctrine],
    [op.organizationRef, config.organization],
    [op.echelonRef, config.echelon],
  ] as const) {
    if (ref.id !== profile.id || ref.version !== profile.version)
      throw Error("Configuration version mismatch");
  }
  const all = [
    op.id,
    op.orderId,
    op.signal.id,
    ...[
      op.units,
      op.tasks,
      op.phases,
      op.objectives,
      op.events,
      op.attachments,
      op.signal.nets,
      op.signal.pacePlans,
    ].flatMap((list) => list.map((v) => v.id)),
  ];
  if (new Set(all).size !== all.length)
    throw Error("Stable IDs must be unique within the operation");
  if (
    new Set(op.sections.map((x) => x.id)).size !== op.sections.length ||
    op.sections.length !== config.doctrine.paragraphs.length ||
    op.sections.some(
      (s) => !config.doctrine.paragraphs.some((p) => p.id === s.id),
    )
  )
    throw Error("Paragraphs must match the pinned doctrine version");
  const has = (list: { id: string }[], id: string | null, what: string) => {
    if (id && !list.some((x) => x.id === id))
      throw Error(`Unknown ${what}: ${id}`);
  };
  const checkMetadata = (m: Operation["metadata"]) => {
    if (!config.doctrine.statuses.some((s) => s.id === m.statusId))
      throw Error("Unknown workflow status");
    if (m.ownerId && !config.doctrine.staff.some((s) => s.id === m.ownerId))
      throw Error("Unknown staff owner");
  };
  checkMetadata(op.metadata);
  for (const list of [
    op.units,
    op.tasks,
    op.phases,
    op.objectives,
    op.events,
    op.attachments,
    op.signal.nets,
    op.signal.pacePlans,
  ])
    for (const item of list) checkMetadata(item.metadata);
  for (const t of op.tasks) {
    has(op.units, t.unitId, "task unit");
    has(op.phases, t.phaseId, "task phase");
    has(op.objectives, t.objectiveId, "task objective");
  }
  for (const unit of op.units) {
    has(op.units, unit.parentUnitId, "parent unit");
    const seen = new Set([unit.id]);
    let parent = unit.parentUnitId;
    while (parent) {
      if (seen.has(parent))
        throw Error("Unit relationships cannot contain a cycle");
      seen.add(parent);
      parent = op.units.find((u) => u.id === parent)!.parentUnitId;
    }
  }
  for (const e of op.events) {
    has(op.phases, e.phaseId, "event phase");
    has(op.events, e.relativeToEventId, "relative event");
    if (e.at && e.relativeToEventId)
      throw Error("An event cannot have both absolute and relative time");
    const seen = new Set([e.id]);
    let parent = e.relativeToEventId;
    while (parent) {
      if (seen.has(parent))
        throw Error("Timeline events cannot contain a cycle");
      seen.add(parent);
      parent = op.events.find((v) => v.id === parent)!.relativeToEventId;
    }
  }
  for (const a of op.attachments) {
    const expected = {
      annex: "order",
      appendix: "annex",
      tab: "appendix",
      exhibit: "tab",
    }[a.kind];
    const parentKind =
      a.parentId === op.orderId
        ? "order"
        : op.attachments.find((p) => p.id === a.parentId)?.kind;
    if (parentKind !== expected)
      throw Error(`A ${a.kind} must belong to a ${expected}`);
    if (a.catalogId) {
      if (a.kind !== "annex")
        throw Error("Only annexes bind to catalog entries");
      has(config.doctrine.annexCatalog, a.catalogId, "catalog entry");
    }
    if (
      op.attachments.some((b) => {
        if (b.id === a.id || b.parentId !== a.parentId || b.code !== a.code)
          return false;
        const nodes = config.doctrine.catalog?.nodes ?? [];
        const one = nodes.find((n) => n.id === a.doctrineNodeId),
          two = nodes.find((n) => n.id === b.doctrineNodeId);
        return !(
          one &&
          two &&
          (one.alternativeToStableKey === two.stableKey ||
            two.alternativeToStableKey === one.stableKey)
        );
      })
    )
      throw Error("Attachment codes must be unique among siblings");
  }
  for (const a of [...op.attachments, ...op.signal.pacePlans]) {
    a.unitIds.forEach((id) => has(op.units, id, "audience unit"));
    a.phaseIds.forEach((id) => has(op.phases, id, "phase"));
  }
  for (const n of op.signal.nets) {
    n.participantUnitIds.forEach((id) => has(op.units, id, "net participant"));
    n.phaseIds.forEach((id) => has(op.phases, id, "net phase"));
  }
  const authoringError = authoringFindings(op, config).find(
    (f) => f.severity === "error",
  );
  if (authoringError) throw Error(authoringError.message);
  const moduleError = moduleFindings(op, config).find(
    (f) =>
      f.severity === "error" &&
      [
        "binding",
        "definition",
        "content",
        "owner",
        "instances",
        "configuration",
      ].includes(f.field),
  );
  if (moduleError) throw Error(moduleError.message);
  return op;
}

export function assertExportScope(op: Operation, profile: ExportProfile) {
  if (profile.operationId !== op.id)
    throw Error("Export profile belongs to another operation");
  const pairs: [{ id: string }[], string[], string][] = [
    [op.units, profile.inclusion.audienceUnitIds, "audience"],
    [op.phases, profile.inclusion.phaseIds, "phase"],
    [op.signal.nets, profile.inclusion.netIds, "net"],
    [op.attachments, profile.inclusion.attachmentIds, "attachment"],
    [op.sections, profile.inclusion.paragraphIds, "paragraph"],
  ];
  for (const [records, selected, label] of pairs)
    if (selected.some((id) => !records.some((v) => v.id === id)))
      throw Error(`Export profile references a missing ${label}`);
}

export function eventTime(
  op: Operation,
  id: string,
  visited = new Set<string>(),
): string | null {
  // Versioned schedule metadata is absent in historical snapshots. Keep their
  // original resolution path and output exactly as recorded.
  if (op.events.some((event) => event.schedule?.relativeAnchor === "END")) {
    const start = resolveSchedule(op).get(id)?.start;
    return start == null ? null : new Date(start).toISOString();
  }
  if (visited.has(id)) return null;
  visited.add(id);
  const e = op.events.find((x) => x.id === id);
  if (!e) return null;
  if (e.at) return e.at;
  const base =
    e.relativeToEventId && eventTime(op, e.relativeToEventId, visited);
  return base
    ? new Date(Date.parse(base) + e.offsetMinutes * 60000).toISOString()
    : null;
}
