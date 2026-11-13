import type { Briefing, BriefingSlide } from "../domain/briefings";
import type { Operation, ResolvedConfig } from "../domain/model";
import { resolvePlanningCard } from "../domain/planning-card-resolution";

export type BriefingGraphic = { data: string; hash: string; label: string };
export type BriefingSlideView = {
  id: string;
  title: string;
  layout: BriefingSlide["layout"];
  body: string;
  cards: {
    id: string;
    title: string;
    values: { key: string; label: string; value: string }[];
  }[];
  graphic: BriefingGraphic | null;
  issues: string[];
};
export type BriefingView = {
  version: 1;
  id: string;
  name: string;
  footer: string;
  slides: BriefingSlideView[];
};
/** Takes one explicit source snapshot; never reads a live database. */
export function projectBriefing(
  op: Operation,
  config: ResolvedConfig,
  deck: Briefing,
  graphics: ReadonlyMap<string, BriefingGraphic> = new Map(),
): BriefingView {
  const definitions = new Map(
    op.planningCards?.definitions.map((c) => [c.id, c]),
  );
  return {
    version: 1,
    id: deck.id,
    name: deck.name,
    footer: deck.footer,
    slides: deck.slides.map((slide) => {
      const issues: string[] = [];
      const cards =
        slide.layout === "cards"
          ? slide.cardIds.flatMap((id) => {
              try {
                const card = definitions.get(id);
                if (!card)
                  throw Error(
                    "A selected planning card is missing. Replace or remove it.",
                  );
                const resolved = resolvePlanningCard(op, config, card);
                return [{ id, title: resolved.title, values: resolved.values }];
              } catch (e) {
                issues.push(e instanceof Error ? e.message : String(e));
                return [];
              }
            })
          : [];
      const graphic =
        slide.layout === "graphic" && slide.graphic
          ? (graphics.get(slide.id) ?? null)
          : null;
      if (slide.layout === "cards" && !slide.cardIds.length)
        issues.push("Choose at least one planning card.");
      if (slide.layout === "graphic" && !graphic)
        issues.push("Choose an available graphic or image.");
      if (
        !slide.title.trim() &&
        !slide.body.trim() &&
        !cards.length &&
        !graphic
      )
        issues.push("This slide is empty.");
      return {
        id: slide.id,
        title: slide.title,
        layout: slide.layout,
        body: slide.body,
        cards,
        graphic,
        issues,
      };
    }),
  };
}
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function renderBriefing(view: BriefingView, selectedSlide?: number) {
  const slides =
    selectedSlide == null
      ? view.slides
      : view.slides.slice(selectedSlide, selectedSlide + 1);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(view.name)}</title><style>
  @page{size:13.333333in 7.5in;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#182e28;font-family:Arial,sans-serif}
  .brief-slide{width:1280px;height:720px;padding:48px 64px 30px;display:flex;flex-direction:column;gap:24px;break-after:page;overflow:hidden;position:relative;border-top:12px solid #315f50}
  .brief-slide:last-child{break-after:auto}h1{font-size:42px;line-height:1.16;margin:0;overflow-wrap:anywhere;flex:none}h2{font-size:27px;margin:0 0 14px;line-height:1.15;overflow-wrap:anywhere}
  .brief-content{flex:1;min-height:0;font-size:27px;line-height:1.35;display:flex;flex-direction:column;gap:20px}.brief-body{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
  .brief-title{padding-top:170px}.brief-title h1{font-size:64px}.brief-title .brief-content{flex:0 0 auto;font-size:34px}
  .brief-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;min-height:0}.brief-cards:has(>article:only-child){grid-template-columns:1fr}
  .brief-cards article{border:1px solid #c3d1ca;border-radius:8px;padding:20px;min-width:0}.brief-cards dl{margin:0;font-size:23px;line-height:1.3}.brief-cards dt{font-size:17px;color:#456155;font-weight:bold;margin-top:10px}.brief-cards dd{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
  .brief-image{flex:1;min-height:0;width:100%;object-fit:contain}.brief-footer{margin-top:auto;flex:none;display:flex;justify-content:space-between;gap:20px;font-size:17px;color:#456155;border-top:1px solid #c3d1ca;padding-top:12px;overflow-wrap:anywhere}
  .brief-issue{color:#a13621;font-size:20px} @media print{body{width:1280px}.brief-slide{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body>${slides
    .map(
      (
        s,
        i,
      ) => `<section class="brief-slide ${s.layout === "title" ? "brief-title" : ""}" aria-label="Slide ${(selectedSlide ?? 0) + i + 1}">
  ${s.title ? `<h1>${escape(s.title)}</h1>` : ""}<div class="brief-content">${s.body ? `<p class="brief-body">${escape(s.body)}</p>` : ""}
  ${
    s.cards.length
      ? `<div class="brief-cards">${s.cards
          .map(
            (c) =>
              `<article><h2>${escape(c.title)}</h2><dl>${c.values
                .filter((v) => v.value)
                .map(
                  (v) =>
                    `<dt>${escape(v.label)}</dt><dd>${escape(v.value)}</dd>`,
                )
                .join("")}</dl></article>`,
          )
          .join("")}</div>`
      : ""
  }
  ${s.graphic ? `<img class="brief-image" alt="${escape(s.graphic.label)}" src="${escape(s.graphic.data)}">` : ""}
  ${s.issues.map((issue) => `<p class="brief-issue">${escape(issue)}</p>`).join("")}</div><footer class="brief-footer"><span>${escape(view.footer)}</span><span>${(selectedSlide ?? 0) + i + 1} / ${view.slides.length}</span></footer></section>`,
    )
    .join("")}</body></html>`;
}
