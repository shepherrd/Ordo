import type { ExportProfile, Operation, ResolvedConfig } from "../domain/model";
import { project, projectCurrentAuthoring } from "./projection";

/** Presentation policy for new documents; references remain authoritative data. */
export function hasImplicitReferences(
  op: Operation,
  config: ResolvedConfig,
): boolean {
  const kinds = new Map(
    config.doctrine.catalog?.baseFields.map((f) => [f.id, f.contentKind]),
  );
  return (
    !!op.authoring?.fields.some(
      (f) =>
        (kinds.get(f.fieldId) !== "task-collection" &&
          kinds.get(f.fieldId) !== "canonical-tasks" &&
          f.references.length > 0) ||
        f.entries?.some((e) => e.references.length > 0),
    ) || op.attachments.some((a) => (a.content?.references.length ?? 0) > 0)
  );
}

export function projectReadableOrder(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  nodeId?: string,
) {
  const compose = (source: Operation) =>
    nodeId
      ? projectCurrentAuthoring(source, profile, config, nodeId)
      : project(source, profile, config);
  const original = compose(op);
  if (profile.product !== "opord" || !hasImplicitReferences(op, config))
    return original;
  const display = structuredClone(op);
  const kinds = new Map(
    config.doctrine.catalog?.baseFields.map((f) => [f.id, f.contentKind]),
  );
  for (const field of display.authoring?.fields ?? []) {
    if (
      kinds.get(field.fieldId) !== "task-collection" &&
      kinds.get(field.fieldId) !== "canonical-tasks"
    )
      field.references = [];
    for (const entry of field.entries ?? []) entry.references = [];
  }
  for (const attachment of display.attachments)
    if (attachment.content) attachment.content.references = [];
  // Keep source/dependency semantics exact. Do not filter by headings: an author
  // may deliberately use "Linked facts" as a title in their own content.
  return { view: compose(display).view, dependencies: original.dependencies };
}
