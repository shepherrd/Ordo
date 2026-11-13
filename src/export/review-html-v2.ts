import { reviewState, type ChangeReview } from "../domain/reviews";
import { textDifference } from "../domain/diff/text";
const e = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const reviewRendererVersion = "review-html-v2";
export function renderReviewReportV2(
  review: ChangeReview,
  version = review.reportRendererVersion,
): string {
  if (version !== reviewRendererVersion)
    throw Error(`Unsupported review renderer: ${version}`);
  const state = reviewState(review),
    comparison = review.comparison;
  const endpoint = (side: "baseline" | "target") => {
    const p = comparison[side];
    return `<section><h2>${side === "baseline" ? "Baseline" : "Target"}</h2><p>${e(p.label)}<br>${e(p.timestamp)}<br>Revision ID: ${e(p.revisionId)}${p.publicationId ? `<br>Publication ID: ${e(p.publicationId)}` : ""}${p.unitProfileProvenance ? `<br>Organization: ${e(p.unitProfileProvenance.designation)} · ${e(p.unitProfileProvenance.versionLabel)}<br>Unit Profile family: ${e(p.unitProfileProvenance.unitProfileFamilyId)}<br>Unit Profile version: ${e(p.unitProfileProvenance.unitProfileVersionId)}<br>Organization SHA-256: ${e(p.unitProfileProvenance.contentHash)}` : "<br>Organization: Unconfigured"}<br>Doctrine: ${e(p.doctrineRef.id)} v${p.doctrineRef.version}</p><small>State SHA-256 ${e(p.stateHash)}<br>Configuration SHA-256 ${e(p.configHash)}</small></section>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${e(state.title)} — Change Review</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:1200px;margin:40px auto;padding:0 28px;color:#24332e}h1,h2,h3{line-height:1.25}small{overflow-wrap:anywhere}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{border-top:2px solid #acbcb4;margin:30px 0;padding-top:16px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f4f2;padding:16px;margin-top:6px}del{background:#ffe1de;text-decoration:none}ins{background:#ddf2e3;text-decoration:none}.note{border-left:3px solid #718f82;padding-left:12px}.muted{color:#52655c}table{width:100%;border-collapse:collapse}th,td{padding:9px;text-align:left;border-bottom:1px solid #ccd5d0}@media print{article{break-inside:avoid}body{margin:0}.pair{gap:12px}}</style></head><body><p class="muted">ORDO · CHANGE REVIEW · ${e(state.status)}</p><h1>${e(state.title)}</h1><p>${e(state.description)}</p><p>Operation: ${e(comparison.target.operationName)} · Review ID: ${e(review.id)}<br>Created ${e(review.createdAt)} by ${e(review.createdByLocalActor)}<br>${e(comparison.diffEngineVersion)} · ${e(comparison.impactEngineVersion)} · ${reviewRendererVersion} · Event sequence ${state.sequence}</p><p>Review decisions record the planner’s assessment. They do not apply, revert, approve, or publish planning changes.</p><div class="pair">${endpoint("baseline")}${endpoint("target")}</div>${comparison.diagnostics.map((d) => `<p>${e(d.message)}</p>`).join("")}<h2>Disposition summary</h2><p>${Object.entries(
    state.counts,
  )
    .map(([d, n]) => `${e(d.replaceAll("_", " "))}: ${n}`)
    .join(
      " · ",
    )}</p>${state.completedAt ? `<p>Completed ${e(state.completedAt)} by ${e(state.completedByLocalActor)}</p>` : ""}${comparison.changes
    .map((c) => {
      const delta = textDifference(c.beforeDisplay, c.afterDisplay);
      const values = (side: "before" | "after") =>
        delta[side]
          .map((p) =>
            p.changed
              ? `<${side === "before" ? "del" : "ins"}>${e(p.text)}</${side === "before" ? "del" : "ins"}>`
              : e(p.text),
          )
          .join("");
      return `<article><p class="muted">${e(c.category.replaceAll("_", " "))} · ${e(c.changeType)} · ${e(state.decisions[c.changeId])}</p><h2>${e(c.humanSummary)}</h2><p>${e(c.sourceLabel)} → ${e(c.targetLabel)}</p><div class="pair"><section><strong>Before</strong><pre>${values("before")}</pre></section><section><strong>After</strong><pre>${values("after")}</pre></section></div>${comparison.impacts
        .filter((i) => i.changeIds.includes(c.changeId))
        .map(
          (i) =>
            `<div class="note"><h3>Affected: ${e(i.label)}</h3><p>${e(i.reason)}<br>${i.chain.map(e).join(" → ")}</p>${i.dependencyPaths.length ? `<p>Dependencies: ${i.dependencyPaths.map(e).join(", ")}</p>` : ""}</div>`,
        )
        .join(
          "",
        )}<small>Change ${e(c.changeId)} · ${e(c.fieldPath)}<br>Fingerprint ${e(c.semanticFingerprint)}</small>${state.decisionHistory
        .filter(
          (h) =>
            h.action.type === "DECISION" && h.action.changeId === c.changeId,
        )
        .map(
          (h) =>
            `<p>Decision #${h.sequence} · ${e(h.at)} · ${e(h.actor)}: ${h.action.type === "DECISION" ? `${e(h.action.disposition)} — ${e(h.action.note)}` : ""}</p>`,
        )
        .join("")}${state.comments
        .filter(
          (h) =>
            h.action.type === "COMMENT" && h.action.changeId === c.changeId,
        )
        .map(
          (h) =>
            `<p class="note">${e(h.at)} · ${e(h.actor)}: ${h.action.type === "COMMENT" ? e(h.action.text) : ""}</p>`,
        )
        .join("")}</article>`;
    })
    .join("")}<h2>Review notes</h2>${state.comments
    .filter((h) => h.action.type === "COMMENT" && !h.action.changeId)
    .map(
      (h) =>
        `<p class="note">${e(h.at)} · ${e(h.actor)}: ${h.action.type === "COMMENT" ? e(h.action.text) : ""}</p>`,
    )
    .join("")}<h2>Lifecycle history</h2>${review.events
    .filter((h) => !["DECISION", "COMMENT"].includes(h.action.type))
    .map(
      (h) =>
        `<p>#${h.sequence} · ${e(h.at)} · ${e(h.actor)} · ${e(h.action.type)}</p>`,
    )
    .join("")}</body></html>`;
}
