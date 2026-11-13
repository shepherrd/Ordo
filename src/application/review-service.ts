import { z } from "zod";
import { idSchema } from "../domain/model";
import {
  endpointSelectorSchema,
  comparisonSchema,
  type Comparison,
  type EndpointSelector,
} from "../domain/diff/model";
import { semanticDiff, diffEngineVersion } from "../domain/diff";
import {
  reviewActionSchema,
  reviewHeaderSchema,
  reviewState,
  type ChangeReview,
} from "../domain/reviews";
import type { Repository, Runtime } from "./ports";
import type { HistoryEntry } from "./review-ports";
import { reviewImpacts } from "./review-impact";
import { reviewImpactsV2 } from "./review-impact-v2";
import { reviewImpactsV3 } from "./review-impact-v3";
import { reviewSemantics, type DiffVersion } from "../domain/diff/versions";
import { supportsProjection } from "../export/projection";
const pair = {
  baseline: endpointSelectorSchema,
  target: endpointSelectorSchema,
  engineVersion: z.enum(["diff-engine-v1", "diff-engine-v2", "diff-engine-v3"]),
};
export const reviewCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("history"), operationId: idSchema }).strict(),
  z.object({ type: z.literal("compare"), ...pair }).strict(),
  z
    .object({
      type: z.literal("create-review"),
      ...pair,
      title: z.string().trim().min(1).max(160),
      description: z.string().max(40000),
      expectedRevision: z.number().int().positive(),
      parentReviewId: idSchema.nullable(),
      supersedesReviewId: idSchema.nullable(),
    })
    .strict(),
  z.object({ type: z.literal("get-review"), id: idSchema }).strict(),
  z
    .object({
      type: z.literal("review-actions"),
      id: idSchema,
      expectedSequence: z.number().int().nonnegative(),
      actions: z.array(reviewActionSchema).min(1).max(10000),
      confirmedBulk: z.boolean(),
    })
    .strict(),
]);
export type ReviewCommand = z.infer<typeof reviewCommandSchema>;
export type ReviewResult = {
  history: HistoryEntry[];
  publicationEndpoints: ReturnType<Repository["resolveEndpoint"]>["endpoint"][];
  reviews: ChangeReview[];
  comparison: Comparison | null;
  review: ChangeReview | null;
  requiresGraphicalReview?: boolean;
};
export class ReviewService {
  constructor(
    private repo: Repository,
    private runtime: Runtime,
  ) {}
  private compare(
    baseline: EndpointSelector,
    target: EndpointSelector,
    version: DiffVersion,
  ): Comparison {
    const a = this.repo.resolveEndpoint(baseline),
      b = this.repo.resolveEndpoint(target);
    const changes = semanticDiff(version, a, b, (text) => this.repo.hash(text));
    const exports = this.repo
      .listExports(a.operation.id)
      .sort((a, b) => a.id.localeCompare(b.id));
    const graphicIds = this.repo.listOperationGraphicExportIds(a.operation.id);
    if (
      version !== "diff-engine-v3" &&
      (graphicIds.length || exports.some((e) => e.projectionVersion === 5))
    )
      throw Error(
        "Comparisons assessing graphical exports require diff-engine-v3",
      );
    const graphics =
      version === "diff-engine-v3"
        ? graphicIds.map((id) => this.repo.getGraphicExport(id).record)
        : [];
    return comparisonSchema.parse({
      schemaVersion: reviewSemantics[version].schemaVersion,
      diffEngineVersion: version,
      impactEngineVersion: reviewSemantics[version].impact,
      baseline: a.endpoint,
      target: b.endpoint,
      changes,
      impacts:
        version === "diff-engine-v3"
          ? reviewImpactsV3(
              a,
              b,
              changes,
              exports,
              (text) => this.repo.hash(text),
              graphics,
            )
          : {
              "diff-engine-v1": reviewImpacts,
              "diff-engine-v2": reviewImpactsV2,
              "diff-engine-v3": reviewImpactsV3,
            }[version](a, b, changes, exports, (text) => this.repo.hash(text)),
      analyzedExportIds: [...exports.map((e) => e.id), ...graphicIds].sort(),
      diagnostics: [
        ...exports
          .filter((e) => !supportsProjection(e.projectionVersion))
          .map((e) => ({
            artifactId: e.id,
            code: "UNSUPPORTED_PROJECTION",
            message: `${e.profile.name}: projection ${e.projectionVersion} is unavailable. Impact was not assessed; the recorded artifact was preserved.`,
          })),
        ...graphics
          .filter((g) => g.schemaVersion !== 2)
          .map((g) => ({
            artifactId: g.id,
            code: "UNSUPPORTED_PROJECTION",
            message: `${g.profile.name}: legacy standalone graphic impact attribution is unavailable. Its recorded request, bytes, and separate staleness check remain unchanged.`,
          })),
      ],
    });
  }
  execute(input: unknown): ReviewResult {
    const c = reviewCommandSchema.parse(input),
      empty: ReviewResult = {
        history: [],
        publicationEndpoints: [],
        reviews: [],
        comparison: null,
        review: null,
      };
    if (c.type === "history")
      return {
        ...empty,
        requiresGraphicalReview:
          this.repo.listOperationGraphicExportIds(c.operationId).length > 0 ||
          this.repo
            .listExports(c.operationId)
            .some((e) => e.projectionVersion === 5),
        history: this.repo.revisionHistory(c.operationId),
        publicationEndpoints: this.repo.listPublications(c.operationId).map(
          (p) =>
            this.repo.resolveEndpoint({
              kind: "PUBLICATION",
              operationId: c.operationId,
              publicationId: p.id,
            }).endpoint,
        ),
        reviews: this.repo.listReviews(c.operationId),
      };
    if (c.type === "compare")
      return {
        ...empty,
        comparison: this.compare(c.baseline, c.target, c.engineVersion),
      };
    if (c.type === "get-review")
      return { ...empty, review: this.repo.getReview(c.id) };
    return this.repo.transaction(() => {
      if (c.type === "create-review") {
        const operation = this.repo.getOperation(c.target.operationId);
        if (operation.revision !== c.expectedRevision)
          throw Error(
            "Planning revision changed. Refresh endpoints before creating the review.",
          );
        const comparison = this.compare(c.baseline, c.target, c.engineVersion),
          at = this.runtime.now();
        const review = reviewHeaderSchema.parse({
          schemaVersion: reviewSemantics[c.engineVersion].schemaVersion,
          id: this.runtime.id(),
          operationId: operation.id,
          title: c.title,
          description: c.description,
          createdAt: at,
          createdByLocalActor: this.runtime.actor,
          parentReviewId: c.parentReviewId,
          supersedesReviewId: c.supersedesReviewId,
          reportRendererVersion:
            reviewSemantics[comparison.diffEngineVersion].report,
          comparison,
        });
        if (c.supersedesReviewId) {
          const old = this.repo.getReview(c.supersedesReviewId);
          if (
            old.operationId !== operation.id ||
            ["ARCHIVED", "SUPERSEDED"].includes(reviewState(old).status)
          )
            throw Error(
              "Choose an active or completed review from this operation to supersede",
            );
        }
        this.repo.insertReview(review);
        if (c.supersedesReviewId) {
          const old = this.repo.getReview(c.supersedesReviewId);
          this.repo.appendReviewEvent(
            {
              id: this.runtime.id(),
              reviewId: old.id,
              sequence: old.events.length + 1,
              at,
              actor: this.runtime.actor,
              action: { type: "SUPERSEDE", replacementReviewId: review.id },
            },
            old.events.length,
          );
        }
        return { ...empty, review: this.repo.getReview(review.id) };
      }
      if (c.actions.length > 1 && !c.confirmedBulk)
        throw Error("Confirm the selected bulk review actions");
      let review = this.repo.getReview(c.id);
      if (review.events.length !== c.expectedSequence)
        throw Error("Review changed. Reload before recording another action.");
      for (const [i, action] of c.actions.entries())
        this.repo.appendReviewEvent(
          {
            id: this.runtime.id(),
            reviewId: c.id,
            sequence: c.expectedSequence + i + 1,
            at: this.runtime.now(),
            actor: this.runtime.actor,
            action,
          },
          c.expectedSequence + i,
        );
      review = this.repo.getReview(c.id);
      return { ...empty, review };
    });
  }
}
