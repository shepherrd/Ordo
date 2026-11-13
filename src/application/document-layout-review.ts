import type { DocumentComparison as Comparison } from "../domain/document-review";
import type { ReviewResult as HistoricalResult } from "./review-service";
export type ReviewResult = Omit<HistoricalResult, "comparison"> & {
  comparison: Comparison | null;
};
import type { Repository, Runtime } from "./ports";
import { NarrativeReviewService } from "./narrative-review-service";
import type {
  ComparisonEndpoint,
  EndpointSelector,
} from "../domain/diff/model";
const endpointSelector = (e: ComparisonEndpoint): EndpointSelector =>
  e.kind === "PUBLICATION"
    ? {
        kind: "PUBLICATION",
        operationId: e.operationId,
        publicationId: e.publicationId!,
      }
    : {
        kind: "REVISION",
        operationId: e.operationId,
        revisionId: e.revisionId,
      };
import { canonical } from "../export/projection";
import { documentStaleness } from "./verify-document-layout";
import { planningCardComparison } from "./planning-card-review";
import { briefingComparison } from "./briefing-review";
import { whiteboardChanges } from "./whiteboard-review";
import { planningScheduleComparison } from "./planning-schedule-review";
import type { ReviewHeader } from "../domain/reviews";

export function documentPresentationImpacts(
  repo: Repository,
  comparison: Comparison,
) {
  const resolve = (e: ComparisonEndpoint) =>
    repo.resolveEndpoint(endpointSelector(e)).operation;
  const baseline = resolve(comparison.baseline),
    target = resolve(comparison.target);
  return {
    schemaVersion: 1 as const,
    exports: repo
      .listExports(baseline.id)
      .filter(
        (e) =>
          e.schemaVersion === 6 && comparison.analyzedExportIds.includes(e.id),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .flatMap((e) => {
        const before = documentStaleness(e, baseline),
          after = documentStaleness(e, target);
        const b = before.changedPaths.filter((p) => p.startsWith("document/")),
          a = after.changedPaths.filter((p) => p.startsWith("document/"));
        if (
          canonical(baseline.metadata.documentLayout) ===
          canonical(target.metadata.documentLayout)
        )
          return [];
        return [
          {
            exportId: e.id,
            label: e.profile.name,
            baselineChangedPaths: b,
            targetChangedPaths: a,
          },
        ];
      }),
  };
}
export class DocumentLayoutReviewService {
  constructor(
    private repo: Repository,
    private rt: Runtime,
    private includeBriefings = false,
  ) {}
  execute(input: unknown): ReviewResult {
    const repo = this.repo;
    const enrich = (comparison: Comparison): Comparison => {
      const a = repo.resolveEndpoint(
        endpointSelector(comparison.baseline),
      ).operation;
      const b = repo.resolveEndpoint(
        endpointSelector(comparison.target),
      ).operation;
      if (
        !a.whiteboards &&
        !b.whiteboards &&
        (!this.includeBriefings || (!a.briefings && !b.briefings)) &&
        !a.metadata.documentLayout &&
        !b.metadata.documentLayout &&
        !a.planningCards &&
        !b.planningCards &&
        !a.planningProgress &&
        !b.planningProgress &&
        !a.timeline &&
        !b.timeline &&
        !a.events.some((e) => e.schedule) &&
        !b.events.some((e) => e.schedule)
      )
        return comparison;
      return {
        ...comparison,
        ...(a.whiteboards || b.whiteboards
          ? { whiteboards: whiteboardChanges(a, b) }
          : {}),
        ...(this.includeBriefings && (a.briefings || b.briefings)
          ? { briefings: briefingComparison(repo, comparison) }
          : {}),
        ...(a.timeline ||
        b.timeline ||
        a.planningProgress ||
        b.planningProgress ||
        a.events.some((e) => e.schedule) ||
        b.events.some((e) => e.schedule)
          ? { planningSchedule: planningScheduleComparison(repo, comparison) }
          : {}),
        ...(a.metadata.documentLayout || b.metadata.documentLayout
          ? {
              documentPresentation: documentPresentationImpacts(
                repo,
                comparison,
              ),
            }
          : {}),
        ...(a.planningCards || b.planningCards
          ? {
              planningCards: planningCardComparison(repo, comparison),
              diagnostics: comparison.diagnostics.filter(
                (d) =>
                  !repo
                    .listExports(a.id)
                    .some(
                      (e) => e.id === d.artifactId && e.schemaVersion === 7,
                    ),
              ),
            }
          : {}),
      };
    };
    const view = new Proxy(repo, {
      get(target, key) {
        if (key === "insertReview")
          return (header: ReviewHeader) => {
            const comparison = enrich(header.comparison);
            target.insertReview({
              ...header,
              comparison,
              ...(comparison.whiteboards
                ? { reportRendererVersion: "review-html-v9" as const }
                : comparison.briefings
                  ? { reportRendererVersion: "review-html-v8" as const }
                  : comparison.planningSchedule
                    ? { reportRendererVersion: "review-html-v7" as const }
                    : comparison.planningCards
                      ? { reportRendererVersion: "review-html-v6" as const }
                      : comparison.documentPresentation
                        ? { reportRendererVersion: "review-html-v5" as const }
                        : {}),
            });
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = new NarrativeReviewService(view, this.rt).execute(input);
    return result.comparison
      ? { ...result, comparison: enrich(result.comparison) }
      : result;
  }
}
