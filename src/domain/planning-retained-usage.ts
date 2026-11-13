import type { ExportRecord } from "./model";
import type { OperationSearchTarget } from "./planning-target";
import { targetKey } from "./planning-target";

/** Versioned evidence only. Aggregated rows without stable IDs are explicitly
 * unknown; a name appearing in retained HTML is never proof of a reference. */
export function retainedPlanningUsage(
  record: ExportRecord,
  target: OperationSearchTarget,
) {
  if (record.projectionVersion < 1 || record.projectionVersion > 6)
    return { used: false, coverage: "Unsupported historical projection" };
  const prefixes: string[] = [];
  if (target.kind === "entity")
    prefixes.push(`facts/${target.entityKind}/${target.entityId}`);
  if (target.kind === "paragraph")
    prefixes.push(
      `sections/${target.paragraphId}/`,
      `paragraphs/${target.paragraphId}/`,
    );
  if (target.kind === "base-field") prefixes.push(`base/${target.fieldId}`);
  if (target.kind === "product" || target.kind === "attachment-text")
    prefixes.push(
      `products/${target.attachmentId}/`,
      `attachments/${target.attachmentId}/`,
    );
  if (target.kind === "module" || target.kind === "module-text")
    prefixes.push(`modules/${target.moduleId}/`);
  if (target.kind === "net" || target.kind === "pace")
    prefixes.push(
      `${target.kind === "net" ? "nets" : "pace"}/${target.entityId}/`,
    );
  if (target.kind === "signal") prefixes.push("signal/");
  if (target.kind === "operation") prefixes.push("operation/");
  if (target.kind === "card") prefixes.push(`cards/${target.cardId}/`);
  let used = record.dependencies.some((d) => {
    if (
      !prefixes.some((p) =>
        p.endsWith("/")
          ? d.path.startsWith(p)
          : d.path === p || d.path.startsWith(p + "/"),
      )
    )
      return false;
    if (target.kind === "base-field" && target.entryId) {
      const value = JSON.parse(d.canonicalValue);
      return !!value?.entries?.some(
        (e: { id: string }) => e.id === target.entryId,
      );
    }
    if (
      target.kind === "attachment-text" &&
      (target.sectionId || target.fieldId)
    ) {
      const value = JSON.parse(d.canonicalValue);
      return !!(value?.sections ?? value?.fields)?.some(
        (e: { id: string }) => e.id === (target.sectionId ?? target.fieldId),
      );
    }
    return true;
  });
  if (record.projectionVersion === 6)
    for (const d of record.dependencies)
      if (/^cards\/[^/]+\/definition$/.test(d.path)) {
        const definition = JSON.parse(d.canonicalValue) as {
          source?: OperationSearchTarget;
          origin?: { target: OperationSearchTarget; operationId?: string };
        };
        const source = definition.source ?? definition.origin?.target;
        if (
          source &&
          (!definition.origin?.operationId ||
            definition.origin.operationId === record.operationId) &&
          targetKey(source) === targetKey(target)
        )
          used = true;
      }
  return {
    used,
    coverage:
      target.kind === "entity" && !used
        ? "Partial: historical summary rows may omit source IDs"
        : "Recorded dependencies checked",
  };
}
