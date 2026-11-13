import type { Operation, ResolvedConfig } from "./model";
import { moduleConfiguration } from "./module-authoring";
import type {
  OperationSearchTarget,
  PlanningTarget,
  SearchTarget,
} from "./planning-target";
import { targetKey } from "./planning-target";
import type { ModuleReference } from "./modules";
export type PlanningReference = {
  kind: "Current reference" | "Independent copy" | "Catalog origin";
  label: string;
  from: SearchTarget;
  to: SearchTarget;
};
/** Copy origins are scoped to the operation where their values were captured. */
export function cardSourceTargets(
  op: Operation,
  cardIds: string[],
  origins: Record<string, string> = {},
): SearchTarget[] {
  const ids = new Set(cardIds);
  return (op.planningCards?.definitions ?? [])
    .filter((c) => ids.has(c.id))
    .map((c) => ({
      area: "operation",
      operationId:
        c.mode === "linked"
          ? op.id
          : (c.origin.operationId ?? origins[c.id] ?? op.id),
      target: c.mode === "linked" ? c.source : c.origin.target,
    }));
}
export function referenceMatches(
  reference: SearchTarget,
  source: SearchTarget,
) {
  if (reference.area !== source.area) return false;
  if (reference.area === "operation" && source.area === "operation")
    return (
      reference.operationId === source.operationId &&
      targetKey(reference.target) === targetKey(source.target)
    );
  if (reference.area === "catalog" && source.area === "catalog")
    return (
      reference.catalogId === source.catalogId &&
      (!source.nodeId || reference.nodeId === source.nodeId) &&
      (!source.positionId || reference.positionId === source.positionId)
    );
  return (
    reference.area === "file" &&
    source.area === "file" &&
    reference.assetId === source.assetId
  );
}
/** Relationships are explicit typed fields. Prose is deliberately not inferred. */
export function planningReferences(
  op: Operation,
  config?: ResolvedConfig,
  cardOrigins: Record<string, string> = {},
): PlanningReference[] {
  const refs: PlanningReference[] = [];
  const target = (t: OperationSearchTarget): SearchTarget => ({
    area: "operation",
    operationId: op.id,
    target: t,
  });
  const add = (
    from: OperationSearchTarget,
    to: OperationSearchTarget,
    label: string,
    kind: PlanningReference["kind"] = "Current reference",
  ) => refs.push({ kind, label, from: target(from), to: target(to) });
  const entity = (
    entityKind: "unit" | "task" | "objective" | "phase" | "event",
    entityId: string,
  ): PlanningTarget => ({ kind: "entity", entityKind, entityId });
  const fact = (
    from: OperationSearchTarget,
    r: ModuleReference,
    label: string,
  ) => {
    if (["unit", "task", "objective", "phase", "event"].includes(r.kind))
      add(from, entity(r.kind as "unit", r.id), label);
    else if (r.kind === "net" || r.kind === "pace")
      add(from, { kind: r.kind, entityId: r.id }, label);
    else if (r.kind === "product")
      add(
        from,
        r.id === op.orderId
          ? { kind: "operation" }
          : { kind: "product", attachmentId: r.id },
        label,
      );
  };
  for (const u of op.units) {
    const from = entity("unit", u.id);
    if (u.parentUnitId)
      add(from, entity("unit", u.parentUnitId), u.name + " — Parent unit");
    if (u.sourceUnitProfile)
      refs.push({
        kind: "Catalog origin",
        label: u.name + " — Organization snapshot",
        from: target(from),
        to: {
          area: "catalog",
          catalogKind: "ORGANIZATION",
          catalogId: u.sourceUnitProfile.sourceUnitProfileVersionId,
        },
      });
    if (u.sourceOrbat)
      refs.push({
        kind: "Catalog origin",
        label: u.name + " — ORBAT import",
        from: target(from),
        to: {
          area: "catalog",
          catalogKind: "ORBAT",
          catalogId: u.sourceOrbat.source.versionId,
          nodeId: u.sourceOrbat.nodeId,
        },
      });
    for (const symbol of [u.symbol?.base, u.symbol?.override])
      if (symbol?.source)
        refs.push({
          kind: "Catalog origin",
          label: u.name + " — Symbol snapshot",
          from: target(from),
          to: {
            area: "catalog",
            catalogKind: "SYMBOL",
            catalogId: symbol.source.versionId,
          },
        });
  }
  if (op.operationOrganizationBinding)
    refs.push({
      kind: "Catalog origin",
      label: op.name + " — Responsible staff snapshot",
      from: target({ kind: "operation" }),
      to: {
        area: "catalog",
        catalogKind: "ORGANIZATION",
        catalogId: op.operationOrganizationBinding.unitProfileVersionId,
      },
    });
  for (const task of op.tasks)
    for (const [field, kind] of [
      ["unitId", "unit"],
      ["objectiveId", "objective"],
      ["phaseId", "phase"],
    ] as const)
      if (task[field])
        add(
          entity("task", task.id),
          entity(kind, task[field]!),
          task.name + " — " + kind,
        );
  for (const event of op.events) {
    if (event.schedule?.unitId)
      add(
        entity("event", event.id),
        entity("unit", event.schedule.unitId),
        event.name + " — Scheduled unit",
      );
    if (event.relativeToEventId)
      add(
        entity("event", event.id),
        entity("event", event.relativeToEventId),
        event.name + " — Relative time",
      );
    if (event.phaseId)
      add(
        entity("event", event.id),
        entity("phase", event.phaseId),
        event.name + " — Phase",
      );
  }
  for (const net of op.signal.nets) {
    for (const id of net.participantUnitIds)
      add(
        { kind: "net", entityId: net.id },
        entity("unit", id),
        net.name + " — Participant",
      );
    for (const id of net.phaseIds)
      add(
        { kind: "net", entityId: net.id },
        entity("phase", id),
        net.name + " — Phase",
      );
  }
  for (const value of [...op.attachments, ...op.signal.pacePlans]) {
    const from: OperationSearchTarget =
      "kind" in value
        ? { kind: "product", attachmentId: value.id }
        : { kind: "pace", entityId: value.id };
    for (const id of value.unitIds)
      add(from, entity("unit", id), value.name + " — Audience");
    for (const id of value.phaseIds)
      add(from, entity("phase", id), value.name + " — Phase");
    if ("content" in value)
      for (const r of value.content?.references ?? [])
        fact(from, r, value.name + " — Linked fact");
  }
  for (const f of op.authoring?.fields ?? []) {
    for (const r of f.references)
      fact(
        { kind: "base-field", fieldId: f.fieldId },
        r,
        "Base order reference",
      );
    for (const e of f.entries ?? [])
      for (const r of e.references)
        fact(
          { kind: "base-field", fieldId: f.fieldId, entryId: e.id },
          r,
          e.label + " — Reference",
        );
  }
  for (const m of op.modules?.instances ?? []) {
    const c = m.content,
      from: OperationSearchTarget = {
        kind: "module",
        moduleId: m.moduleInstanceId,
      };
    if (c.type === "CANONICAL_REFERENCES")
      for (const r of c.references) fact(from, r, "Module reference");
    if (c.type === "REPORT_CATALOG" || c.type === "DISTRIBUTION_LIST")
      for (const r of c.data.references) fact(from, r, "Module reference");
    if (c.type === "CHECKLIST")
      for (const i of c.items) {
        if (i.unitId)
          add({ ...from, itemId: i.id }, entity("unit", i.unitId), i.text);
        if (i.eventId)
          add({ ...from, itemId: i.id }, entity("event", i.eventId), i.text);
      }
    if (c.type === "TIMELINE")
      for (const i of c.items) {
        if (i.phaseId)
          add({ ...from, itemId: i.id }, entity("phase", i.phaseId), i.title);
        if (i.schedule?.unitId)
          add(
            { ...from, itemId: i.id },
            entity("unit", i.schedule.unitId),
            i.title,
          );
        if (i.timing.mode === "RELATIVE")
          add(
            { ...from, itemId: i.id },
            i.timing.withinModule
              ? { ...from, itemId: i.timing.referenceEventId }
              : entity("event", i.timing.referenceEventId),
            i.title,
          );
      }
    if (c.type === "CHART" && c.source.mode === "TABLE")
      add(
        from,
        { kind: "module", moduleId: c.source.moduleInstanceId },
        "Chart table source",
      );
    if (c.type === "PLANNING_CARDS")
      for (const p of c.placements)
        add(from, { kind: "card", cardId: p.cardId }, "Card placement");
    if (
      config &&
      (c.type === "KEY_VALUE" || c.type === "TABLE" || c.type === "MATRIX")
    ) {
      const cfg = moduleConfiguration(m, config),
        fields =
          c.type === "KEY_VALUE" ? (cfg.fields ?? []) : (cfg.columns ?? []);
      for (const row of c.type === "KEY_VALUE"
        ? [{ id: undefined, cells: c.values }]
        : c.rows)
        for (const f of fields)
          if (
            f.type.endsWith("_REFERENCE") &&
            typeof row.cells[f.id] === "string"
          )
            fact(
              { ...from, ...(row.id ? { itemId: row.id } : {}), fieldId: f.id },
              {
                kind: f.type
                  .split("_")[0]
                  .toLowerCase() as ModuleReference["kind"],
                id: row.cells[f.id] as string,
              },
              f.label,
            );
    }
  }
  for (const board of op.whiteboards?.boards ?? [])
    for (const item of board.items) {
      const from: OperationSearchTarget = {
        kind: "whiteboard",
        boardId: board.id,
        itemId: item.id,
      };
      if (item.kind === "card")
        add(
          from,
          { kind: "card", cardId: item.cardId },
          board.name + " — Planning card",
        );
      if (item.kind === "symbol")
        refs.push({
          kind: "Catalog origin",
          label: board.name + " — " + item.label,
          from: target(from),
          to: {
            area: "catalog",
            catalogKind: "SYMBOL",
            catalogId: item.pin.versionId,
          },
        });
    }
  for (const c of op.planningCards?.definitions ?? [])
    refs.push({
      from: target({ kind: "card", cardId: c.id }),
      to:
        c.mode === "linked"
          ? target(c.source)
          : {
              area: "operation",
              operationId: c.origin.operationId ?? cardOrigins[c.id] ?? op.id,
              target: c.origin.target,
            },
      label: c.title,
      kind: c.mode === "linked" ? "Current reference" : "Independent copy",
    });
  return refs;
}
