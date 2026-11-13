import { metadata, type Operation } from "./model";
import type { ModuleContent, ModuleInstance } from "./modules";

type Item = Extract<ModuleContent, { type: "TIMELINE" }>["items"][number];
export type CalendarEvent = Operation["events"][number] & {
  moduleId?: string;
  itemId?: string;
  description?: string;
};

// Item IDs are scoped to their module. Older duplicated modules can share the same item IDs.
export const moduleEventKey = (moduleId: string, itemId: string) =>
  moduleId + ":" + itemId;

export function moduleCalendarEvent(
  moduleId: string,
  item: Item,
): CalendarEvent {
  const { timing } = item;
  return {
    id: moduleEventKey(moduleId, item.id),
    moduleId,
    itemId: item.id,
    name: item.title,
    description: item.description,
    phaseId: item.phaseId,
    metadata: { ...metadata(), ownerId: item.staffId ?? null },
    schedule: item.schedule,
    at: timing.mode === "ABSOLUTE" ? timing.at : null,
    relativeToEventId:
      timing.mode === "RELATIVE"
        ? timing.withinModule
          ? moduleEventKey(moduleId, timing.referenceEventId)
          : timing.referenceEventId
        : null,
    offsetMinutes: timing.mode === "RELATIVE" ? timing.offsetMinutes : 0,
  };
}

export function timelineModuleEvents(module: ModuleInstance): CalendarEvent[] {
  return module.content.type === "TIMELINE"
    ? module.content.items.map((item) =>
        moduleCalendarEvent(module.moduleInstanceId, item),
      )
    : [];
}

/** Write through to the owning item. The combined calendar is never saved as a second list. */
export function editTimelineEvent(
  draft: Operation,
  row: CalendarEvent,
  edit: (event: CalendarEvent) => void,
) {
  if (!row.moduleId) {
    const event = draft.events.find((e) => e.id === row.id);
    if (event) edit(event);
    return;
  }
  const module = draft.modules?.instances.find(
    (m) => m.moduleInstanceId === row.moduleId,
  );
  if (module?.content.type !== "TIMELINE") return;
  const item = module.content.items.find((i) => i.id === row.itemId);
  if (!item) return;
  const event = moduleCalendarEvent(module.moduleInstanceId, item);
  edit(event);
  item.title = event.name;
  item.description = event.description ?? "";
  item.phaseId = event.phaseId;
  if (event.schedule) item.schedule = event.schedule;
  if (event.metadata.ownerId) item.staffId = event.metadata.ownerId;
  else delete item.staffId;
  const prefix = module.moduleInstanceId + ":";
  const parent = event.relativeToEventId;
  item.timing = parent
    ? {
        mode: "RELATIVE",
        referenceEventId: parent.startsWith(prefix)
          ? parent.slice(prefix.length)
          : parent,
        ...(parent.startsWith(prefix) ? { withinModule: true as const } : {}),
        offsetMinutes: event.offsetMinutes,
      }
    : { mode: "ABSOLUTE", at: event.at };
  module.updatedAt = new Date().toISOString();
}
