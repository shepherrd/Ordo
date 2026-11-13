import {
  ReviewService,
  reviewCommandSchema,
  type ReviewCommand,
  type ReviewResult,
} from "./review-service";
import type { Repository, Runtime } from "./ports";
import { hasRichNarrative, validateNarratives } from "../domain/narrative";
import type { ReviewHeader } from "../domain/reviews";
export type NarrativeReviewCommand =
  | ReviewCommand
  | (Extract<ReviewCommand, { type: "create-review" }> & {
      formattedText?: boolean;
    });
/** New narrative presentation, with the complete historical review service unchanged. */
export class NarrativeReviewService {
  constructor(
    private repo: Repository,
    private rt: Runtime,
  ) {}
  execute(input: unknown): ReviewResult {
    validateNarratives(input);
    let formatted = false,
      raw = input;
    if (
      input &&
      typeof input === "object" &&
      "type" in input &&
      input.type === "create-review" &&
      "formattedText" in input
    ) {
      if (typeof input.formattedText !== "boolean")
        throw Error("Invalid review text option");
      const { formattedText, ...rest } = input;
      formatted = formattedText;
      raw = rest;
    }
    const command = reviewCommandSchema.parse(raw);
    if (
      command.type === "review-actions" &&
      ![
        "review-html-v4",
        "review-html-v5",
        "review-html-v6",
        "review-html-v7",
        "review-html-v8",
        "review-html-v9",
      ].includes(this.repo.getReview(command.id).reportRendererVersion) &&
      hasRichNarrative(command.actions)
    )
      throw Error(
        "This historical review uses plain text notes. Create a new review for formatted notes.",
      );
    const view = new Proxy(this.repo, {
      get(target, key) {
        if (key === "insertReview")
          return (header: ReviewHeader) =>
            target.insertReview(
              formatted || hasRichNarrative(header)
                ? { ...header, reportRendererVersion: "review-html-v4" }
                : header,
            );
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return new ReviewService(view, this.rt).execute(command);
  }
}
