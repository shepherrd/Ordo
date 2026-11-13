import { escapeHtml } from "./html";
import type { ChangeReview } from "../domain/reviews";
import { renderReviewReport as historical } from "./review-report";
import { renderReviewReportV4 } from "./review-html-v4";
export function renderReviewReport(review: ChangeReview): string {
  if (review.reportRendererVersion === "review-html-v9")
    return renderReviewReport({
      ...review,
      reportRendererVersion: review.comparison.briefings
        ? "review-html-v8"
        : review.comparison.planningSchedule
          ? "review-html-v7"
          : review.comparison.planningCards
            ? "review-html-v6"
            : review.comparison.documentPresentation
              ? "review-html-v5"
              : "review-html-v4",
    }).replace(
      "</body>",
      `<section><h2>Planning whiteboards</h2>${review.comparison.whiteboards!.changes.map((c) => `<h3>${escapeHtml(c.label)} · ${escapeHtml(c.field)}</h3><p>Before</p><pre>${escapeHtml(c.before)}</pre><p>After</p><pre>${escapeHtml(c.after)}</pre>`).join("") || "<p>No whiteboard changes.</p>"}</section></body>`,
    );
  if (review.reportRendererVersion === "review-html-v8")
    return renderReviewReport({
      ...review,
      reportRendererVersion: review.comparison.planningSchedule
        ? "review-html-v7"
        : review.comparison.planningCards
          ? "review-html-v6"
          : review.comparison.documentPresentation
            ? "review-html-v5"
            : "review-html-v4",
    }).replace(
      "</body>",
      "<section><h2>Briefings</h2>" +
        review.comparison
          .briefings!.changes.map(
            (c) =>
              "<h3>" +
              escapeHtml(c.label) +
              " · " +
              escapeHtml(c.field) +
              "</h3><p>Before: " +
              escapeHtml(c.before) +
              "</p><p>After: " +
              escapeHtml(c.after) +
              "</p>",
          )
          .join("") +
        "</section></body>",
    );
  if (review.reportRendererVersion === "review-html-v7") {
    const schedule = review.comparison.planningSchedule!;
    return renderReviewReport({
      ...review,
      reportRendererVersion: review.comparison.planningCards
        ? "review-html-v6"
        : review.comparison.documentPresentation
          ? "review-html-v5"
          : "review-html-v4",
    }).replace(
      "</body>",
      `<section><h2>Timeline and writing progress</h2><p>Writing readiness is separate from formal approval.</p>${schedule.changes.map((c) => `<h3>${escapeHtml(c.label)} · ${escapeHtml(c.field)}</h3><p>Before: ${escapeHtml(c.before)}</p><p>After: ${escapeHtml(c.after)}</p>`).join("") || "<p>No schedule or writing progress changes.</p>"}</section></body>`,
    );
  }
  if (review.reportRendererVersion === "review-html-v6") {
    const cards = review.comparison.planningCards!;
    return renderReviewReport({
      ...review,
      reportRendererVersion: review.comparison.documentPresentation
        ? "review-html-v5"
        : "review-html-v4",
    }).replace(
      "</body>",
      `<section><h2>Planning cards</h2>${cards.changes.map((c) => `<h3>${escapeHtml(c.kind)}: ${escapeHtml(c.label)}</h3><p>Before</p><pre>${escapeHtml(c.before)}</pre><p>After</p><pre>${escapeHtml(c.after)}</pre>`).join("")}${cards.exports.map((e) => `<p>${escapeHtml(e.label)}: ${e.targetChangedPaths.length ? "requires a new export" : "matches this revision"}.</p>`).join("")}</section></body>`,
    );
  }
  if (review.reportRendererVersion === "review-html-v5") {
    const details =
      review.comparison.documentPresentation?.exports
        .map(
          (e) =>
            `<p><strong>${escapeHtml(e.label)}</strong>: header/footer ${e.targetChangedPaths.length ? "differs from the target revision" : "matches the target revision"}.</p>`,
        )
        .join("") ?? "";
    return renderReviewReportV4({
      ...review,
      reportRendererVersion: "review-html-v4",
    })
      .replace("review-html-v4 (", "review-html-v5 (")
      .replace(
        "</body>",
        `<section><h2>Document header and footer</h2>${details || "<p>No retained documents affected.</p>"}</section></body>`,
      );
  }
  return review.reportRendererVersion === "review-html-v4"
    ? renderReviewReportV4(review)
    : historical(review);
}
