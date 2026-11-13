import type { Finding, Operation, ResolvedConfig } from "./model";
import { packageIncluded } from "./authoring";
import {
  cardPlacements,
  resolvePlanningCard,
} from "./planning-card-resolution";
export function planningCardFindings(
  op: Operation,
  config: ResolvedConfig,
): Finding[] {
  const placements = cardPlacements(op),
    cards = new Map(op.planningCards?.definitions.map((c) => [c.id, c]) ?? []);
  const included = (productId: string) =>
    productId === op.orderId ||
    op.attachments.some(
      (a) =>
        a.id === productId &&
        (op.schemaVersion === 1 || packageIncluded(op, a)),
    );
  const findings: Finding[] = [];
  for (const card of cards.values()) {
    try {
      resolvePlanningCard(op, config, card);
    } catch (e) {
      findings.push({
        ruleId: "planning-card",
        severity: placements.some(
          (p) => p.cardId === card.id && p.active && included(p.productId),
        )
          ? "error"
          : "warning",
        category: "Planning cards",
        entityId: card.id,
        field: "source",
        message: `${card.title}: ${e instanceof Error ? e.message : String(e)}`,
        revision: op.revision,
      });
    }
  }
  for (const p of placements)
    if (!cards.has(p.cardId))
      findings.push({
        ruleId: "planning-card",
        severity: p.active && included(p.productId) ? "error" : "warning",
        category: "Planning cards",
        entityId: p.moduleId,
        field: "placements",
        message:
          "A card placement references a missing definition. Remove it or choose a source.",
        revision: op.revision,
      });
  return findings;
}
