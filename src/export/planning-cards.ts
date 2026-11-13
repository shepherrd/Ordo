import type {
  Dependency,
  ExportProfile,
  Operation,
  ResolvedConfig,
} from "../domain/model";
import { resolvePlanningCard } from "../domain/planning-card-resolution";
import { moduleDefinition } from "../domain/module-authoring";
import { projectReadableOrder } from "./readable-order";
import { canonical, projectVersion } from "./projection";
import { escapeHtml } from "./html";
import type { GraphicalView } from "./projections/v5";
import {
  needsScheduledTimeline,
  renderScheduledTimeline,
} from "./scheduled-module";

export const hasPlanningBlocks = (op: Operation) =>
  op.modules?.instances.some(
    (m) =>
      (m.content.type === "PLANNING_CARDS" || needsScheduledTimeline(m)) &&
      m.layoutState === "ACTIVE",
  ) ?? false;
const marker = (id: string) => `ORDO_CARD_BLOCK_${id}`;
export const cardDocumentCss = `<style id="ordo-cards-v1">.order-planning-card{border:1px solid #777;padding:10px 14px;margin:12px 0;color:#000;background:#fff;overflow-wrap:anywhere;break-inside:avoid}.order-planning-card h3{margin:0 0 8px;break-after:avoid}.order-planning-card dl{margin:0}.order-planning-card dt{font-weight:bold;break-after:avoid}.order-planning-card dd{margin:0 0 8px;white-space:pre-wrap;orphans:3;widows:3}.order-planning-card.compact{font-size:90%}.order-planning-card.compact dt{display:inline}.order-planning-card.compact dt:after{content:': '}.order-planning-card.compact dd{display:inline}.order-planning-card.compact dd:after{content:'';display:block}</style>`;
/** v6 composes explicit card blocks into the prior authored module positions.
 * The prior engine receives temporary plain-text slots, never unresolved cards.
 * Its non-card dependencies and historical behavior remain untouched. */
export function projectPlanningCards(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  nodeId?: string,
): { view: GraphicalView; dependencies: Dependency[] } {
  const display = structuredClone(op);
  const blocks = new Map(
    (op.modules?.instances ?? [])
      .filter(
        (m) => m.content.type === "PLANNING_CARDS" || needsScheduledTimeline(m),
      )
      .map((m) => [m.moduleInstanceId, m]),
  );
  for (const m of display.modules?.instances ?? [])
    if (blocks.has(m.moduleInstanceId))
      m.content = { type: "PLAIN_TEXT", text: marker(m.moduleInstanceId) };
  const base = projectReadableOrder(display, profile, config, nodeId);
  const deps = base.dependencies.filter(
    (d) =>
      ![...blocks.keys()].some((id) => d.path.startsWith(`modules/${id}/`)),
  );
  const track = (path: string, value: unknown) =>
    deps.push({ path, canonicalValue: canonical(value) });
  const cards = new Map(
    op.planningCards?.definitions.map((c) => [c.id, c]) ?? [],
  );
  const view: GraphicalView = {
    ...base.view,
    sections: (base.view as GraphicalView).sections.map((section) => {
      if (!("moduleHtml" in section) || !section.moduleHtml) return section;
      const block = [...blocks.values()].find((m) =>
        section.moduleHtml!.includes(marker(m.moduleInstanceId)),
      );
      if (!block) return section;
      if (block.content.type === "TIMELINE") {
        const moduleHtml = renderScheduledTimeline(block, op);
        track(`modules/${block.moduleInstanceId}/content`, block.content);
        track(
          `modules/${block.moduleInstanceId}/definition`,
          moduleDefinition(block, config)?.title ?? "Timeline",
        );
        track(`modules/${block.moduleInstanceId}/resolved`, moduleHtml);
        return { ...section, moduleHtml };
      }
      if (block.content.type !== "PLANNING_CARDS") return section;
      track(`cards/blocks/${block.moduleInstanceId}`, {
        productId: block.productInstanceId,
        title: moduleDefinition(block, config)?.title ?? "Planning cards",
        placements: block.content.placements,
      });
      const content = block.content.placements
        .map((p) => {
          const card = cards.get(p.cardId);
          if (!card)
            throw Error("An included planning card definition is unavailable.");
          const resolved = resolvePlanningCard(op, config, card);
          const include =
            (!profile.inclusion.audienceUnitIds.length ||
              !resolved.unitIds.length ||
              resolved.unitIds.some((id) =>
                profile.inclusion.audienceUnitIds.includes(id),
              )) &&
            (!profile.inclusion.phaseIds.length ||
              !resolved.phaseIds.length ||
              resolved.phaseIds.some((id) =>
                profile.inclusion.phaseIds.includes(id),
              ));
          track(`cards/${card.id}/selection`, {
            included: include,
            unitIds: resolved.unitIds,
            phaseIds: resolved.phaseIds,
          });
          if (!include) return "";
          track(`cards/${card.id}/definition`, {
            title: card.title,
            mode: card.mode,
            fields: card.fields,
            ...(card.mode === "linked"
              ? { source: card.source }
              : { origin: card.origin }),
          });
          track(`cards/${card.id}/values`, resolved.values);
          for (const id of resolved.upstream) {
            const e = op.events.find((e) => e.id === id)!;
            track(`cards/${card.id}/upstream/${id}`, {
              at: e.at,
              relativeToEventId: e.relativeToEventId,
              offsetMinutes: e.offsetMinutes,
              ...(e.schedule ? { schedule: e.schedule } : {}),
            });
          }
          return `<article class="order-planning-card ${p.layout}" data-card-id="${escapeHtml(card.id)}" data-placement-id="${escapeHtml(p.id)}"><h3>${escapeHtml(card.title)}</h3><dl>${resolved.values.map((v) => `<dt>${escapeHtml(v.label)}</dt><dd>${escapeHtml(v.value)}</dd>`).join("")}</dl></article>`;
        })
        .join("");
      return { ...section, moduleHtml: content };
    }),
  };
  return {
    view,
    dependencies: [...new Map(deps.map((d) => [d.path, d])).values()].sort(
      (a, b) => a.path.localeCompare(b.path),
    ),
  };
}
export function projectConnectedVersion(
  version: number,
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
) {
  return version === 6
    ? projectPlanningCards(op, profile, config)
    : projectVersion(version, op, profile, config);
}
export function projectConnectedPreview(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  nodeId?: string,
) {
  if (!hasPlanningBlocks(op))
    return projectReadableOrder(op, profile, config, nodeId);
  const result = projectPlanningCards(op, profile, config, nodeId);
  const filtered = result.dependencies
    .filter(
      (d) =>
        /^cards\/[^/]+\/selection$/.test(d.path) &&
        !JSON.parse(d.canonicalValue).included,
    )
    .map(
      (d) =>
        op.planningCards?.definitions.find((c) => c.id === d.path.split("/")[1])
          ?.title ?? "Card",
    );
  if (filtered.length)
    result.view.sections.push({
      title: "Preview note",
      text: `Outside this product's audience or phase selection: ${filtered.join(", ")}. This note is not included in exports.`,
    });
  return result;
}
