import type { Operation, ResolvedConfig } from "./model";
import { factTargets } from "./authoring";
import type { FactReference } from "./doctrine";
import { narrativePlainText } from "./narrative";

/** Overview writing progress, not a validation or publication-readiness check. */
export function orderProgress(op: Operation, config: ResolvedConfig) {
  const hasText = (text: string) => !!narrativePlainText(text).trim();
  const hasReference = (ref: FactReference) =>
    factTargets(op, ref.kind).some((target) => target.id === ref.id);
  const fields = new Map(
    (op.authoring?.fields ?? []).map((field) => [field.fieldId, field]),
  );
  const started = config.doctrine.paragraphs.filter((paragraph) => {
    if (
      op.sections.some(
        (section) => section.id === paragraph.id && hasText(section.summary),
      )
    )
      return true;
    return (config.doctrine.catalog?.baseFields ?? []).some((definition) => {
      if (definition.paragraphId !== paragraph.id) return false;
      const field = fields.get(definition.id);
      const linked = (ref: FactReference) =>
        definition.bindings.includes(ref.kind) && hasReference(ref);
      switch (definition.contentKind) {
        case "group":
          return false;
        case "canonical-tasks":
          return op.tasks.length > 0;
        case "task-collection":
          return !!field?.references.some(
            (ref) => ref.kind === "task" && linked(ref),
          );
        case "structured-fields":
          return !!field?.entries?.some(
            (entry) => hasText(entry.value) || entry.references.some(linked),
          );
        case "narrative":
          return (
            !!field && (hasText(field.text) || field.references.some(linked))
          );
      }
    });
  }).length;
  return { started, total: config.doctrine.paragraphs.length };
}
