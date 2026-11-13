import type { Repository } from "./ports";
import type { DocumentComparison } from "../domain/document-review";
import type {
  ComparisonEndpoint,
  EndpointSelector,
} from "../domain/diff/model";
import { canonical } from "../export/projection";
import { cardPlacements } from "../domain/planning-card-resolution";
import { planningExportStaleness } from "./verify-planning-export";
const selector = (e: ComparisonEndpoint): EndpointSelector =>
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
export function planningCardComparison(
  repo: Repository,
  comparison: DocumentComparison,
) {
  const before = repo.resolveEndpoint(selector(comparison.baseline)).operation,
    after = repo.resolveEndpoint(selector(comparison.target)).operation;
  const a = new Map(
      before.planningCards?.definitions.map((c) => [c.id, c]) ?? [],
    ),
    b = new Map(after.planningCards?.definitions.map((c) => [c.id, c]) ?? []);
  const changes = [...new Set([...a.keys(), ...b.keys()])]
    .sort()
    .flatMap((id) => {
      const x = a.get(id),
        y = b.get(id),
        oldPlacements = cardPlacements(before, id),
        newPlacements = cardPlacements(after, id);
      if (
        canonical(x) === canonical(y) &&
        canonical(oldPlacements) === canonical(newPlacements)
      )
        return [];
      const kind = !x
        ? ("Added" as const)
        : !y
          ? ("Removed" as const)
          : x.mode === "linked" && y.mode === "independent"
            ? ("Made independent" as const)
            : x.mode === "linked" &&
                y.mode === "linked" &&
                canonical(x.source) !== canonical(y.source)
              ? ("Source changed" as const)
              : ("Edited" as const);
      return [
        {
          cardId: id,
          label: y?.title ?? x!.title,
          kind,
          before: canonical({ definition: x, placements: oldPlacements }),
          after: canonical({ definition: y, placements: newPlacements }),
        },
      ];
    });
  const exports = repo
    .listExports(before.id)
    .filter(
      (e) =>
        e.schemaVersion === 7 && comparison.analyzedExportIds.includes(e.id),
    )
    .map((e) => ({
      exportId: e.id,
      label: e.profile.name,
      baselineChangedPaths: planningExportStaleness(
        e as Extract<typeof e, { schemaVersion: 7 }>,
        before,
      ).changedPaths,
      targetChangedPaths: planningExportStaleness(
        e as Extract<typeof e, { schemaVersion: 7 }>,
        after,
      ).changedPaths,
    }));
  return { schemaVersion: 1 as const, changes, exports };
}
