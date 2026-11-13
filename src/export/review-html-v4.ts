import type { ChangeReview } from "../domain/reviews";
import { reviewSemantics } from "../domain/diff/versions";
import { narrativeDisplayText } from "../domain/narrative";
import { renderReviewReport as v1 } from "./review-html";
import { renderReviewReportV2 as v2 } from "./review-html-v2";
import { renderReviewReportV3 as v3 } from "./review-html-v3";
import { expandNarratives } from "./narrative-html";

/** Display adaptation only: retained comparison values, hashes and decisions are unchanged. */
export function renderReviewReportV4(review: ChangeReview): string {
  const text = (value: unknown): unknown =>
    typeof value === "string"
      ? narrativeDisplayText(value)
      : Array.isArray(value)
        ? value.map(text)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, text(v)]),
            )
          : value;
  const version = reviewSemantics[review.comparison.diffEngineVersion].report;
  const display = {
    ...review,
    reportRendererVersion: version,
    comparison: text(review.comparison) as ChangeReview["comparison"],
  };
  const render =
    version === "review-html-v1" ? v1 : version === "review-html-v2" ? v2 : v3;
  return expandNarratives(render(display)).replace(
    version,
    `review-html-v4 (${version} comparison layout)`,
  );
}
