import type { Operation } from "../domain/model";
import type { ModuleInstance } from "../domain/modules";
import { timelineModuleEvents } from "../domain/module-timeline";
import { resolveSchedule } from "../domain/planning-schedule";
import { narrativePrefix, readNarrative } from "../domain/narrative";
import { escapeHtml } from "./html";
import { tableHtml, richHtml } from "./module-render";

/** Old module rows stay with their retained projector until they use a new scheduling field. */
export function needsScheduledTimeline(module: ModuleInstance) {
  return (
    module.content.type === "TIMELINE" &&
    module.content.items.some(
      (item) =>
        item.schedule ||
        item.staffId ||
        (item.timing.mode === "ABSOLUTE"
          ? item.timing.at === null
          : item.timing.withinModule),
    )
  );
}

export function renderScheduledTimeline(module: ModuleInstance, op: Operation) {
  const rows = timelineModuleEvents(module);
  const events = [...op.events, ...rows];
  const times = resolveSchedule({ ...op, events });
  const names = new Map(events.map((e) => [e.id, e.name]));
  const phases = new Map(op.phases.map((p) => [p.id, p.name]));
  return tableHtml(
    ["Item", "Description", "Time (UTC)", "Timing", "Phase"],
    rows.map((row) => {
      const time = times.get(row.id)!;
      let when =
        time.start === null
          ? time.issue || "Unscheduled"
          : new Date(time.start).toISOString();
      if (time.end !== null && time.start !== time.end)
        when += " – " + new Date(time.end).toISOString();
      const anchor = row.schedule?.relativeAnchor === "END" ? " finish" : "";
      const timing = row.relativeToEventId
        ? `${names.get(row.relativeToEventId) ?? "Missing event"}${anchor} ${row.offsetMinutes >= 0 ? "+" : ""}${row.offsetMinutes} min`
        : "Absolute";
      const description = row.description ?? "";
      return [
        escapeHtml(row.name),
        description.startsWith(narrativePrefix)
          ? richHtml(readNarrative(description))
          : escapeHtml(description),
        escapeHtml(when),
        escapeHtml(timing),
        escapeHtml(phases.get(row.phaseId ?? "") ?? ""),
      ];
    }),
  );
}
