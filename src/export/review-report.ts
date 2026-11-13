import type { ChangeReview } from "../domain/reviews";
import { renderReviewReport as renderV1 } from "./review-html";
import { renderReviewReportV2 } from "./review-html-v2";
import { renderReviewReportV3 } from "./review-html-v3";
export function renderReviewReport(review: ChangeReview): string {
  if (review.reportRendererVersion === "review-html-v1")
    return renderV1(review);
  if (review.reportRendererVersion === "review-html-v2")
    return renderReviewReportV2(review);
  if (review.reportRendererVersion === "review-html-v3")
    return renderReviewReportV3(review);
  throw Error("Unsupported review report renderer");
}
