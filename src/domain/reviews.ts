import { z } from "zod";
import { idSchema } from "./model";
import { documentComparisonSchema as comparisonSchema } from "./document-review";
import { reviewSemantics } from "./diff/versions";

const actor = z.string().trim().min(1).max(160),
  text = z.string().max(40000);
export const dispositions = [
  "UNREVIEWED",
  "ACCEPTED",
  "REJECTED",
  "NEEDS_CHANGES",
  "NOTED",
] as const;
export const reviewStatuses = [
  "OPEN",
  "COMPLETED",
  "SUPERSEDED",
  "ARCHIVED",
] as const;
export const reviewHeaderSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    id: idSchema,
    operationId: idSchema,
    title: z.string().trim().min(1).max(160),
    description: text,
    createdAt: z.string().datetime(),
    createdByLocalActor: actor,
    parentReviewId: idSchema.nullable(),
    supersedesReviewId: idSchema.nullable(),
    reportRendererVersion: z.enum([
      "review-html-v1",
      "review-html-v2",
      "review-html-v3",
      "review-html-v4",
      "review-html-v5",
      "review-html-v6",
      "review-html-v7",
      "review-html-v8",
      "review-html-v9",
    ]),
    comparison: comparisonSchema,
  })
  .strict()
  .refine(
    (r) => r.operationId === r.comparison.baseline.operationId,
    "Review operation differs from comparison",
  )
  .refine(
    (r) =>
      ((r.reportRendererVersion === "review-html-v9" &&
        !!r.comparison.whiteboards) ||
        (r.reportRendererVersion === "review-html-v8" &&
          !!r.comparison.briefings) ||
        (r.reportRendererVersion === "review-html-v7" &&
          !!r.comparison.planningSchedule) ||
        (r.reportRendererVersion === "review-html-v6" &&
          !!r.comparison.planningCards) ||
        (r.reportRendererVersion === "review-html-v5" &&
          !!r.comparison.documentPresentation) ||
        r.reportRendererVersion === "review-html-v4" ||
        r.reportRendererVersion ===
          reviewSemantics[r.comparison.diffEngineVersion].report) &&
      r.schemaVersion ===
        reviewSemantics[r.comparison.diffEngineVersion].schemaVersion,
    "Review renderer and comparison semantics must match",
  );
export type ReviewHeader = z.infer<typeof reviewHeaderSchema>;
export const reviewActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("DECISION"),
      changeId: idSchema,
      disposition: z.enum(dispositions),
      note: text,
    })
    .strict(),
  z
    .object({
      type: z.literal("COMMENT"),
      changeId: idSchema.nullable(),
      text: text.min(1).refine((s) => !!s.trim(), "Comment is empty"),
    })
    .strict(),
  z
    .object({
      type: z.literal("METADATA"),
      title: z.string().trim().min(1).max(160),
      description: text,
    })
    .strict(),
  z.object({ type: z.literal("COMPLETE") }).strict(),
  z.object({ type: z.literal("ARCHIVE") }).strict(),
  z
    .object({ type: z.literal("SUPERSEDE"), replacementReviewId: idSchema })
    .strict(),
]);
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export const reviewEventSchema = z
  .object({
    id: idSchema,
    reviewId: idSchema,
    sequence: z.number().int().positive(),
    at: z.string().datetime(),
    actor,
    action: reviewActionSchema,
  })
  .strict();
export type ReviewEvent = z.infer<typeof reviewEventSchema>;
export type ChangeReview = ReviewHeader & { events: ReviewEvent[] };
export function reviewState(review: ChangeReview) {
  let status: (typeof reviewStatuses)[number] = "OPEN",
    title = review.title,
    description = review.description;
  let completedAt: string | null = null,
    completedByLocalActor: string | null = null,
    replacementReviewId: string | null = null;
  const decisions = Object.fromEntries(
    review.comparison.changes.map((c) => [
      c.changeId,
      "UNREVIEWED" as (typeof dispositions)[number],
    ]),
  );
  const comments: ReviewEvent[] = [],
    decisionHistory: ReviewEvent[] = [];
  const ids = new Set<string>();
  let lastAt = review.createdAt;
  for (const [index, input] of review.events.entries()) {
    const e = reviewEventSchema.parse(input),
      a = e.action;
    if (
      e.reviewId !== review.id ||
      e.sequence !== index + 1 ||
      ids.has(e.id) ||
      Date.parse(e.at) < Date.parse(lastAt)
    )
      throw Error("Invalid review event history");
    ids.add(e.id);
    lastAt = e.at;
    if (status !== "OPEN" && !["ARCHIVE", "SUPERSEDE"].includes(a.type))
      throw Error("Closed review is read-only");
    if (a.type === "DECISION") {
      if (!Object.hasOwn(decisions, a.changeId))
        throw Error("Decision belongs to a different review/change");
      decisions[a.changeId] = a.disposition;
      decisionHistory.push(e);
    } else if (a.type === "COMMENT") {
      if (a.changeId && !Object.hasOwn(decisions, a.changeId))
        throw Error("Comment belongs to a different review/change");
      comments.push(e);
    } else if (a.type === "METADATA") {
      title = a.title;
      description = a.description;
    } else if (a.type === "COMPLETE") {
      if (Object.values(decisions).includes("UNREVIEWED"))
        throw Error(
          "Give every change a disposition before completing the review",
        );
      status = "COMPLETED";
      completedAt = e.at;
      completedByLocalActor = e.actor;
    } else if (a.type === "ARCHIVE") {
      if (status === "ARCHIVED") throw Error("Review is already archived");
      status = "ARCHIVED";
    } else {
      if (
        status === "ARCHIVED" ||
        status === "SUPERSEDED" ||
        a.replacementReviewId === review.id
      )
        throw Error("Invalid review supersession");
      status = "SUPERSEDED";
      replacementReviewId = a.replacementReviewId;
    }
  }
  const counts = Object.fromEntries(
    dispositions.map((d) => [
      d,
      Object.values(decisions).filter((v) => v === d).length,
    ]),
  ) as Record<(typeof dispositions)[number], number>;
  return {
    status,
    title,
    description,
    completedAt,
    completedByLocalActor,
    replacementReviewId,
    decisions,
    comments,
    decisionHistory,
    counts,
    sequence: review.events.length,
  };
}
