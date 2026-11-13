import type { Operation, ResolvedConfig } from "./model";
import type { PlanningTarget } from "./planning-target";
import { targetKey } from "./planning-target";
import type { PlanningCard, CardOrigin } from "./planning-cards";
import { independentCard } from "./planning-card-resolution";
export function authoredTargets(op: Operation): Set<string> {
  const result = new Set<string>(),
    add = (target: PlanningTarget) => result.add(targetKey(target));
  for (const [entityKind, items] of [
    ["unit", op.units],
    ["task", op.tasks],
    ["objective", op.objectives],
    ["phase", op.phases],
    ["event", op.events],
  ] as const)
    for (const e of items) add({ kind: "entity", entityKind, entityId: e.id });
  for (const s of op.sections) add({ kind: "paragraph", paragraphId: s.id });
  for (const f of op.authoring?.fields ?? []) {
    add({ kind: "base-field", fieldId: f.fieldId });
    for (const e of f.entries ?? [])
      add({ kind: "base-field", fieldId: f.fieldId, entryId: e.id });
  }
  for (const a of op.attachments) {
    add({ kind: "attachment-text", attachmentId: a.id });
    if (a.content?.kind === "narrative")
      for (const s of a.content.sections)
        add({ kind: "attachment-text", attachmentId: a.id, sectionId: s.id });
    if (a.content?.kind === "generic")
      for (const f of a.content.fields)
        add({ kind: "attachment-text", attachmentId: a.id, fieldId: f.id });
  }
  for (const m of op.modules?.instances ?? [])
    if (
      m.layoutState === "ACTIVE" &&
      (m.content.type === "PLAIN_TEXT" || m.content.type === "RICH_TEXT")
    )
      add({ kind: "module-text", moduleId: m.moduleInstanceId });
  return result;
}
export function removedCardSources(
  before: Operation,
  after: Operation,
): PlanningCard[] {
  if (!before.planningCards?.definitions.length) return [];
  const previous = authoredTargets(before),
    next = authoredTargets(after);
  return before.planningCards.definitions.filter(
    (c) =>
      c.mode === "linked" &&
      previous.has(targetKey(c.source)) &&
      !next.has(targetKey(c.source)),
  );
}
export function handleRemovedCardSources(
  before: Operation,
  after: Operation,
  config: ResolvedConfig,
  action: "remove" | "copy",
  origins: Map<string, CardOrigin>,
): Operation {
  const next = structuredClone(after),
    affected = removedCardSources(before, after),
    ids = new Set(affected.map((c) => c.id));
  if (action === "remove") {
    if (next.planningCards)
      next.planningCards.definitions = next.planningCards.definitions.filter(
        (c) => !ids.has(c.id),
      );
    for (const m of next.modules?.instances ?? [])
      if (m.content.type === "PLANNING_CARDS")
        m.content.placements = m.content.placements.filter(
          (p) => !ids.has(p.cardId),
        );
    for (const deck of next.briefings?.decks ?? [])
      for (const slide of deck.slides)
        slide.cardIds = slide.cardIds.filter((id) => !ids.has(id));
    for (const board of next.whiteboards?.boards ?? []) {
      const removed = new Set(
        board.items
          .filter((i) => i.kind === "card" && ids.has(i.cardId))
          .map((i) => i.id),
      );
      board.items = board.items.filter((i) => !removed.has(i.id));
      board.connectors = board.connectors.filter(
        (c) => !removed.has(c.fromId) && !removed.has(c.toId),
      );
    }
  } else
    for (const c of affected) {
      const origin = origins.get(c.id);
      if (!origin)
        throw Error("Missing source provenance for independent copy");
      const index = next.planningCards!.definitions.findIndex(
        (v) => v.id === c.id,
      );
      next.planningCards!.definitions[index] = independentCard(
        before,
        config,
        c,
        c.id,
        origin,
      );
    }
  return next;
}
