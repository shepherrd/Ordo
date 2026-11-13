import type { Operation, ResolvedConfig } from "./model";
import { eventTime } from "./invariants";
import { resolveSchedule } from "./planning-schedule";
import { narrativePlainText } from "./narrative";
import { moduleDefinition } from "./module-authoring";
import type { RichNode } from "./modules";
import { type PlanningTarget } from "./planning-target";
import type { CardField, CardOrigin, PlanningCard } from "./planning-cards";

export type CardSource = {
  title: string;
  values: CardField[];
  phaseIds: string[];
  unitIds: string[];
  upstream: string[];
};
const richText = (node: RichNode): string =>
  node.type === "text"
    ? (node.text ?? "")
    : (node.content ?? [])
        .map(richText)
        .join(node.type === "paragraph" || node.type === "heading" ? "" : "\n");
export function resolveCardSource(
  op: Operation,
  config: ResolvedConfig,
  target: PlanningTarget,
): CardSource {
  const values: CardField[] = [],
    phaseIds: string[] = [],
    unitIds: string[] = [],
    upstream: string[] = [];
  const add = (
    key: CardField["key"],
    label: string,
    value: string | number | null | undefined,
  ) =>
    values.push({ key, label, value: narrativePlainText(String(value ?? "")) });
  let title = "";
  if (target.kind === "entity") {
    const collections = {
      unit: op.units,
      task: op.tasks,
      objective: op.objectives,
      phase: op.phases,
      event: op.events,
    };
    const entity = collections[target.entityKind].find(
      (e) => e.id === target.entityId,
    );
    if (!entity)
      throw Error(
        "The linked " +
          target.entityKind +
          " is unavailable. Choose another source or remove the card.",
      );
    title = entity.name;
    add("name", "Name", title);
    add(
      "staff",
      "Responsible staff",
      config.doctrine.staff.find((s) => s.id === entity.metadata.ownerId)
        ?.name ?? "",
    );
    add(
      "status",
      "Status",
      config.doctrine.statuses.find((s) => s.id === entity.metadata.statusId)
        ?.name ?? entity.metadata.statusId,
    );
    if ("purpose" in entity) add("purpose", "Purpose", entity.purpose);
    if ("description" in entity)
      add("description", "Description", entity.description);
    if ("sequence" in entity) {
      add("sequence", "Sequence", entity.sequence);
      phaseIds.push(entity.id);
    }
    if ("unitId" in entity) {
      add(
        "unit",
        "Assigned unit",
        op.units.find((u) => u.id === entity.unitId)?.name,
      );
      if (entity.unitId) unitIds.push(entity.unitId);
    }
    if ("objectiveId" in entity)
      add(
        "objective",
        "Objective",
        op.objectives.find((o) => o.id === entity.objectiveId)?.name,
      );
    if ("phaseId" in entity) {
      add(
        "phase",
        "Phase",
        op.phases.find((p) => p.id === entity.phaseId)?.name,
      );
      if (entity.phaseId) phaseIds.push(entity.phaseId);
    }
    if ("parentUnitId" in entity) {
      unitIds.push(entity.id);
      add(
        "parent",
        "Parent unit",
        op.units.find((u) => u.id === entity.parentUnitId)?.name,
      );
      for (const key of [
        "shortDesignation",
        "abbreviation",
        "unitType",
        "echelon",
        "service",
        "component",
        "callsign",
        "headquarters",
        "description",
        "notes",
      ] as const)
        add(
          key,
          key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
          entity.profileIdentity?.[key],
        );
    }
    if ("relativeToEventId" in entity) {
      let event: typeof entity | undefined = entity;
      while (event && !upstream.includes(event.id)) {
        upstream.push(event.id);
        event = op.events.find((e) => e.id === event!.relativeToEventId);
      }
      const time = eventTime(op, entity.id);
      if (entity.schedule) {
        const timing = resolveSchedule(op).get(entity.id);
        add(
          "finish",
          "Finish (UTC)",
          timing?.end == null
            ? "Time not set"
            : new Date(timing.end).toISOString(),
        );
        add("duration", "Duration (minutes)", entity.schedule.durationMinutes);
        add(
          "unit",
          "Assigned unit",
          op.units.find((u) => u.id === entity.schedule?.unitId)?.name,
        );
        if (entity.schedule.unitId) unitIds.push(entity.schedule.unitId);
      }
      add(
        "time",
        "Time (UTC)",
        time === null ? "Time not set" : new Date(time).toISOString(),
      );
    }
  } else if (target.kind === "paragraph") {
    const field = op.sections.find((s) => s.id === target.paragraphId);
    if (!field) throw Error("The linked paragraph is unavailable.");
    title =
      config.doctrine.paragraphs.find((p) => p.id === field.id)?.title ??
      field.id;
    add("text", "Text", field.summary);
  } else if (target.kind === "base-field") {
    const field = op.authoring?.fields.find(
        (f) => f.fieldId === target.fieldId,
      ),
      definition = config.doctrine.catalog?.baseFields.find(
        (f) => f.id === target.fieldId,
      );
    if (!field || !definition)
      throw Error("The linked base order field is unavailable.");
    title = definition.title;
    if (target.entryId) {
      const entry = field.entries?.find((e) => e.id === target.entryId);
      if (!entry) throw Error("The linked field entry is unavailable.");
      title += " — " + entry.label;
      add("text", "Text", entry.value);
    } else add("text", "Text", field.text);
  } else if (target.kind === "attachment-text") {
    const a = op.attachments.find((a) => a.id === target.attachmentId);
    if (!a) throw Error("The linked product is unavailable.");
    title = a.name;
    phaseIds.push(...a.phaseIds);
    unitIds.push(...a.unitIds);
    if (target.sectionId) {
      const section =
        a.content?.kind === "narrative"
          ? a.content.sections.find((s) => s.id === target.sectionId)
          : null;
      if (!section) throw Error("The linked narrative section is unavailable.");
      title += " — " + section.title;
      add("text", "Text", section.text);
    } else if (target.fieldId) {
      const field =
        a.content?.kind === "generic"
          ? a.content.fields.find((f) => f.id === target.fieldId)
          : null;
      if (!field) throw Error("The linked narrative field is unavailable.");
      title += " — " + field.label;
      add("text", "Text", field.value);
    } else add("text", "Text", a.narrative);
  } else {
    const m = op.modules?.instances.find(
      (m) => m.moduleInstanceId === target.moduleId,
    );
    if (
      !m ||
      m.layoutState !== "ACTIVE" ||
      (m.content.type !== "PLAIN_TEXT" && m.content.type !== "RICH_TEXT")
    )
      throw Error("The linked text module is unavailable.");
    title = moduleDefinition(m, config)?.title ?? "Text";
    const a = op.attachments.find((a) => a.id === m.productInstanceId);
    phaseIds.push(...(a?.phaseIds ?? []));
    unitIds.push(...(a?.unitIds ?? []));
    add(
      "text",
      "Text",
      m.content.type === "PLAIN_TEXT"
        ? m.content.text
        : richText(m.content.document),
    );
  }
  return { title, values, phaseIds, unitIds, upstream };
}
export function resolvePlanningCard(
  op: Operation,
  config: ResolvedConfig,
  card: PlanningCard,
): CardSource {
  const source =
    card.mode === "linked"
      ? resolveCardSource(op, config, card.source)
      : { title: card.title, values: card.values, ...card.scope, upstream: [] };
  const values = card.fields.map((key) => {
    const value = source.values.find((v) => v.key === key);
    if (!value)
      throw Error(
        `The selected field ${key} is unavailable for this card source.`,
      );
    return value;
  });
  if (values.reduce((n, v) => n + v.value.length, 0) > 40000)
    throw Error("This card exceeds 40,000 characters. Select fewer fields.");
  return {
    ...source,
    title: card.title,
    values,
    upstream: card.fields.includes("time") ? source.upstream : [],
  };
}
export function cardPlacements(op: Operation, cardId?: string) {
  return (op.modules?.instances ?? []).flatMap((m) =>
    m.content.type === "PLANNING_CARDS"
      ? m.content.placements
          .filter((p) => !cardId || p.cardId === cardId)
          .map((p) => ({
            moduleId: m.moduleInstanceId,
            productId: m.productInstanceId,
            active: m.layoutState === "ACTIVE",
            ...p,
          }))
      : [],
  );
}
export function independentCard(
  op: Operation,
  config: ResolvedConfig,
  card: PlanningCard,
  id: string,
  origin: CardOrigin,
): PlanningCard {
  const resolved = resolvePlanningCard(op, config, card);
  return {
    id,
    title: card.title,
    fields: [...card.fields],
    mode: "independent",
    values: structuredClone(resolved.values),
    scope: { unitIds: [...resolved.unitIds], phaseIds: [...resolved.phaseIds] },
    origin: { ...origin, operationId: origin.operationId ?? op.id },
  };
}
