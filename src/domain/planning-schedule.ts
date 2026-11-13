import { z } from "zod";
import type { Operation } from "./model";

const laneId = z.union([
  z.enum(["key-dates", "battle-rhythm"]),
  z.string().uuid(),
]);
export const laneColors = [
  "blue",
  "teal",
  "amber",
  "red",
  "violet",
  "slate",
] as const;
const timelineLaneSchema = z
  .object({
    id: laneId,
    name: z.string().trim().min(1).max(80),
    color: z.enum(laneColors),
  })
  .strict();
export type TimelineLane = z.infer<typeof timelineLaneSchema>;
export const initialTimelineLanes: TimelineLane[] = [
  { id: "key-dates", name: "Key dates", color: "blue" },
  { id: "battle-rhythm", name: "Battle rhythm", color: "teal" },
];
export const timelineSettingsSchema = z
  .object({
    dDay: z.iso.date().optional(),
    lanes: z
      .array(timelineLaneSchema)
      .max(64)
      .refine(
        (lanes) => new Set(lanes.map((lane) => lane.id)).size === lanes.length,
        "Timeline lane identifiers must be unique",
      )
      .optional(),
  })
  .strict();
export const timelineLanes = (op: Operation) =>
  op.timeline?.lanes ?? initialTimelineLanes;

export const eventScheduleSchema = z
  .object({
    schemaVersion: z.literal(1),
    durationMinutes: z.number().int().min(0).max(525600),
    unitId: z.string().uuid().nullable(),
    relativeAnchor: z.enum(["START", "END"]),
    laneId: laneId.optional(),
  })
  .strict();
export const planningProgressSchema = z
  .object({
    schemaVersion: z.literal(1),
    products: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            dueAt: z.string().datetime().nullable(),
            readyAt: z.string().datetime().nullable(),
            reopenedReason: z
              .enum(["Writing changed", "Linked information changed"])
              .optional(),
          })
          .strict(),
      )
      .max(2001),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.products.map((p) => p.productId)).size === v.products.length,
    "Planning products must be unique",
  );

export const newEventSchedule = (): z.infer<typeof eventScheduleSchema> => ({
  schemaVersion: 1,
  durationMinutes: 0,
  unitId: null,
  relativeAnchor: "START",
});
export type EventTiming = {
  start: number | null;
  end: number | null;
  issue: string;
};

/** One bounded traversal for the whole timeline. Never guesses a missing time. */
export function resolveSchedule(op: Operation): Map<string, EventTiming> {
  const events = new Map(op.events.map((e) => [e.id, e])),
    result = new Map<string, EventTiming>();
  const pending = new Set<string>();
  const resolve = (id: string): EventTiming => {
    const cached = result.get(id);
    if (cached) return cached;
    const e = events.get(id);
    if (!e) return { start: null, end: null, issue: "Linked event is missing" };
    if (pending.has(id))
      return {
        start: null,
        end: null,
        issue: "Scheduling relationships contain a cycle",
      };
    // Walk iteratively so long dependency chains do not exhaust the call stack.
    const chain: typeof op.events = [];
    let current: typeof e | undefined = e;
    while (current && !result.has(current.id)) {
      if (pending.has(current.id)) {
        for (const item of chain)
          result.set(item.id, {
            start: null,
            end: null,
            issue: "Scheduling relationships contain a cycle",
          });
        break;
      }
      pending.add(current.id);
      chain.push(current);
      if (!current.relativeToEventId || current.at) break;
      current = events.get(current.relativeToEventId);
    }
    for (const item of chain.reverse()) {
      if (!result.has(item.id)) {
        let start: number | null = item.at ? Date.parse(item.at) : null,
          issue = "";
        if (item.relativeToEventId && !item.at) {
          const parent = result.get(item.relativeToEventId);
          const anchor =
            item.schedule?.relativeAnchor === "END"
              ? parent?.end
              : parent?.start;
          start = anchor == null ? null : anchor + item.offsetMinutes * 60000;
          issue =
            start === null
              ? parent?.issue || "Linked event is unscheduled"
              : "";
          if (!events.has(item.relativeToEventId))
            issue = "Linked event is missing";
        }
        const end =
          start === null
            ? null
            : start + (item.schedule?.durationMinutes ?? 0) * 60000;
        if (
          (start !== null && !Number.isFinite(new Date(start).getTime())) ||
          (end !== null && !Number.isFinite(new Date(end).getTime()))
        ) {
          result.set(item.id, {
            start: null,
            end: null,
            issue: "Time is outside the supported date range",
          });
        } else result.set(item.id, { start, end, issue });
      }
      pending.delete(item.id);
    }
    return result.get(id)!;
  };
  for (const id of events.keys()) resolve(id);
  return result;
}

export function canLinkEvent(op: Operation, eventId: string, parentId: string) {
  const events = new Map(op.events.map((e) => [e.id, e])),
    seen = new Set([eventId]);
  let current: string | null = parentId;
  while (current) {
    if (seen.has(current) || !events.has(current)) return false;
    seen.add(current);
    current = events.get(current)!.relativeToEventId;
  }
  return true;
}

/** Build the picker once, rather than rebuilding an event map for every option. */
export function eventLinkOptions(op: Operation, eventId: string) {
  const children = new Map<string, string[]>();
  for (const event of op.events)
    if (event.relativeToEventId) {
      const list = children.get(event.relativeToEventId) ?? [];
      list.push(event.id);
      children.set(event.relativeToEventId, list);
    }
  const excluded = new Set<string>(),
    pending = [eventId];
  while (pending.length) {
    const id = pending.pop()!;
    if (excluded.has(id)) continue;
    excluded.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  const times = resolveSchedule(op);
  return op.events.filter(
    (event) =>
      !excluded.has(event.id) &&
      !/cycle|missing/.test(times.get(event.id)?.issue ?? ""),
  );
}

export function assertPlanningSchedule(op: Operation) {
  const units = new Set(op.units.map((u) => u.id)),
    lanes = new Set(timelineLanes(op).map((l) => l.id)),
    products = new Set([op.orderId, ...op.attachments.map((a) => a.id)]);
  for (const e of op.events) {
    if (e.schedule?.laneId && !lanes.has(e.schedule.laneId))
      throw Error("Unknown timeline lane");
    if (e.schedule?.unitId && !units.has(e.schedule.unitId))
      throw Error("Unknown timeline unit");
  }
  for (const p of op.planningProgress?.products ?? []) {
    if (!products.has(p.productId))
      throw Error("Planning progress references a missing product");
  }
  for (const time of resolveSchedule(op).values())
    if (time.issue === "Time is outside the supported date range")
      throw Error(time.issue);
}
