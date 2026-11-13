import type {
  ComparisonEndpoint,
  EndpointSelector,
  ResolvedEndpoint,
} from "../domain/diff/model";
import type {
  ChangeReview,
  ReviewEvent,
  ReviewHeader,
} from "../domain/reviews";
export interface HistoryEntry {
  endpoint: ComparisonEndpoint;
  actor: string;
  status: string;
  approvalIds: string[];
  publicationIds: string[];
  current: boolean;
}
export interface ReviewRepository {
  hash(text: string): string;
  revisionHistory(operationId: string): HistoryEntry[];
  resolveEndpoint(selector: EndpointSelector): ResolvedEndpoint;
  insertReview(review: ReviewHeader): void;
  listReviews(operationId: string): ChangeReview[];
  getReview(id: string): ChangeReview;
  appendReviewEvent(event: ReviewEvent, expectedSequence: number): void;
}
