import type { Operation } from "../../domain/model";
import type { EventTiming, TimelineLane } from "../../domain/planning-schedule";

export const DAY = 86400000;
const HOUR = DAY / 24;
export type CalendarScale = "fit" | "day" | "week" | "month";
export type CalendarLane = TimelineLane & { editable?: boolean };
export const utcDay = (time: number) => Math.floor(time / DAY) * DAY;
const formatUTC = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
const month = formatUTC({ month: "short", year: "numeric" });
const date = formatUTC({ day: "numeric", month: "short" });
const weekday = formatUTC({ weekday: "short" });
const fullDate = formatUTC({ dateStyle: "full" });
export const planningTime = (time: number | string) =>
  new Date(time).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function calendarAxis(
  first: number,
  last: number,
  available: number,
  scale: CalendarScale,
  dDay: number | null,
) {
  const start = utcDay(first);
  const end = utcDay(last) + DAY;
  const days = (end - start) / DAY;
  const dayWidth = { fit: 0, day: 840, week: 128, month: 43 }[scale];
  const width = Math.max(available, Math.min(24000, days * dayWidth));
  const x = (time: number) => ((time - start) / (end - start)) * width;
  const hourly = scale === "day" || (scale === "fit" && days <= 2);
  const minStep = ((end - start) * (hourly ? 54 : 36)) / width;
  const steps = [
    ...(hourly ? [1, 2, 3, 6, 12].map((h) => h * HOUR) : []),
    ...[1, 2, 7, 14, 28, 56, 112, 365].map((d) => d * DAY),
  ];
  const step =
    steps.find((v) => v >= minStep) ??
    Math.ceil(minStep / (365 * DAY)) * 365 * DAY;
  const ticks = [];
  for (let at = start; at < end; at += step) {
    const t = new Date(at);
    const offset = dDay === null ? null : (utcDay(at) - utcDay(dDay)) / DAY;
    ticks.push({
      at,
      left: x(at),
      width: x(Math.min(at + step, end)) - x(at),
      day: step < DAY ? t.toISOString().slice(11, 16) : String(t.getUTCDate()),
      weekday: weekday.format(t),
      fullDate: fullDate.format(t),
      relative:
        offset === null
          ? "—"
          : offset === 0
            ? "D"
            : `D${offset > 0 ? "+" : "−"}${Math.abs(offset)}`,
    });
  }
  // Break month bands at real UTC boundaries, including when a tick spans two months.
  const bands = [];
  for (let at = start; at < end;) {
    const t = new Date(at);
    const label =
      step < DAY
        ? date.format(t) + " " + t.getUTCFullYear()
        : step < 28 * DAY
          ? month.format(t)
          : String(t.getUTCFullYear());
    const next = new Date(at);
    if (step < DAY) next.setUTCDate(next.getUTCDate() + 1);
    else if (step < 28 * DAY) next.setUTCMonth(next.getUTCMonth() + 1, 1);
    else
      next.setUTCFullYear(
        next.getUTCFullYear() + Math.max(1, Math.round(step / (365 * DAY))),
        0,
        1,
      );
    const until = Math.min(next.getTime(), end);
    bands.push({ label, left: x(at), width: x(until) - x(at) });
    at = until;
  }
  return {
    width,
    x,
    ticks,
    bands,
    hourly: step < DAY,
    zero:
      dDay !== null && utcDay(dDay) >= start && utcDay(dDay) < end
        ? x(utcDay(dDay))
        : null,
  };
}

type Event = Operation["events"][number];
export function calendarRows(
  lanes: CalendarLane[],
  events: Event[],
  laneFor: (event: Event) => string,
  times: Map<string, EventTiming>,
  axis: ReturnType<typeof calendarAxis>,
) {
  const positions = new Map<
    string,
    { start: number; end: number; y: number }
  >();
  let height = 0;
  const rows = lanes.map((lane) => {
    const tracks: number[] = [];
    const top = height;
    const items = [];
    for (const event of events) {
      const timing = times.get(event.id)!;
      if (
        laneFor(event) !== lane.id ||
        timing.start === null ||
        timing.end === null
      )
        continue;
      const start = axis.x(timing.start),
        end = axis.x(timing.end);
      const width = Math.min(
        axis.width,
        Math.max(
          end - start,
          Math.min(184, Math.max(60, event.name.length * 7 + 16)),
        ),
      );
      const left = Math.min(start, axis.width - width);
      let track = tracks.findIndex((right) => right <= left + 0.01);
      if (track === -1) track = tracks.length;
      tracks[track] = left + width;
      const y = top + 12 + track * 36;
      positions.set(event.id, { start, end, y });
      items.push({ event, timing, left, width, start, end, y: y - top });
    }
    const rowHeight = Math.max(54, tracks.length * 36 + 18);
    height += rowHeight;
    return { lane, items, height: rowHeight };
  });
  const links = events.flatMap((event) => {
    const from = positions.get(event.relativeToEventId ?? ""),
      to = positions.get(event.id);
    if (!from || !to) return [];
    const origin =
      event.schedule?.relativeAnchor === "END" ? from.end : from.start;
    const bend = Math.max(from.y, to.y) - 7;
    // When two bars meet, draw a small hook so the relationship is visible.
    const approach =
      from.y === to.y && Math.abs(origin - to.start) < 1
        ? `h -6 V ${bend}`
        : `V ${bend}`;
    return [
      {
        id: event.id,
        parent: event.relativeToEventId,
        path: `M ${origin} ${from.y} ${approach} H ${to.start} V ${to.y}`,
      },
    ];
  });
  return { rows, links, height };
}
