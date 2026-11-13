import type { SearchTarget } from "../../domain/planning-target";
import type { Operation, ResolvedConfig } from "../../domain/model";
import { findingLocation } from "./validation-navigation";
export function searchLocation(
  target: Extract<SearchTarget, { area: "operation" }>,
  op: Operation,
  config: ResolvedConfig,
) {
  const t = target.target;
  const entityId =
    "entityId" in t
      ? t.entityId
      : "attachmentId" in t
        ? t.attachmentId
        : "moduleId" in t
          ? t.moduleId
          : op.id;
  const base = findingLocation(
    {
      entityId,
      field: target.field ?? "",
      ruleId: "search",
      category: "content",
      severity: "warning",
      message: "",
      revision: op.revision,
    },
    op,
    config,
  );
  const q = (s: string) => CSS.escape(s);
  const labels: Record<string, string> = {
    name:
      t.kind === "entity"
        ? t.entityKind[0].toUpperCase() + t.entityKind.slice(1)
        : "Name",
    summary: "Summary",
    description: "Description",
    narrative: "Narrative",
    text: "Text",
    concept: "Signal concept",
    architecture: "Architecture",
    spectrumNotes: "Spectrum notes",
    maintenanceNotes: "Maintenance notes",
  };
  let page: string = base.page,
    anchor = base.anchor,
    id = base.id;
  if (t.kind === "entity" && t.entityKind === "objective") {
    labels.name = "Objective name";
    labels.description = "Objective description";
  }
  if (t.kind === "operation") {
    page = "overview";
    anchor = '[data-content-id="operation-name"]';
    labels.name = "Operation name";
  }
  if (t.kind === "signal") {
    page = "signal";
    anchor = ".panel";
  }
  if (t.kind === "paragraph") {
    page = "base";
    anchor = `[data-paragraph-id="${q(t.paragraphId)}"]`;
  }
  if (t.kind === "base-field") {
    page = "base";
    anchor = `[data-field-id="${q(t.fieldId)}"]`;
    if (t.entryId) anchor += ` [data-entry-id="${q(t.entryId)}"]`;
  }
  if (t.kind === "whiteboard") {
    page = "whiteboards";
    anchor = t.itemId
      ? `[data-whiteboard-item="${q(t.itemId)}"]`
      : `[data-whiteboard-id="${q(t.boardId)}"]`;
  }
  if (t.kind === "card") {
    const module = op.modules?.instances.find(
      (m) =>
        m.layoutState === "ACTIVE" &&
        m.content.type === "PLANNING_CARDS" &&
        m.content.placements.some((p) => p.cardId === t.cardId),
    );
    if (module) {
      const location = findingLocation(
        {
          entityId: module.moduleInstanceId,
          field: "",
          ruleId: "search",
          category: "content",
          severity: "warning",
          message: "",
          revision: op.revision,
        },
        op,
        config,
      );
      page = location.page;
      id = location.id;
    } else
      page = op.whiteboards?.boards.some((b) =>
        b.items.some((i) => i.kind === "card" && i.cardId === t.cardId),
      )
        ? "whiteboards"
        : "base";
    anchor = `[data-card-id="${q(t.cardId)}"]`;
  }
  if (t.kind === "attachment-text" && (t.sectionId || t.fieldId))
    anchor = `[data-content-id="${q(t.sectionId ?? t.fieldId!)}"]`;
  if (t.kind === "product" && t.itemId)
    anchor = `[data-content-id="${q(t.itemId)}"]`;
  if (t.kind === "module" && t.itemId)
    anchor += ` [data-item-id="${q(t.itemId)}"]`;
  if (t.kind === "module" && t.fieldId)
    anchor += ` [data-field-id="${q(t.fieldId)}"]`;
  if (t.kind === "product" && t.columnId)
    anchor += ` [data-column-id="${q(t.columnId)}"]`;
  if (t.kind === "attachment-text" && t.fieldId) anchor += " .narrative-field";
  const timelineItem =
    t.kind === "module" &&
    t.itemId &&
    op.modules?.instances.some(
      (m) => m.moduleInstanceId === t.moduleId && m.content.type === "TIMELINE",
    )
      ? { moduleId: t.moduleId, itemId: t.itemId }
      : undefined;
  if (timelineItem) {
    labels.title = "Event name";
    labels.description = "Event description";
  }
  return {
    page,
    id,
    anchor,
    timelineItem,
    label: labels[target.field ?? ""] ?? base.label,
  };
}
