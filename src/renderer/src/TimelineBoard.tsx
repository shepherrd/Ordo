import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Operation } from "../../domain/model";
import type { CalendarEvent } from "../../domain/module-timeline";
import type { EventTiming, TimelineLane } from "../../domain/planning-schedule";
import {
  calendarAxis,
  calendarRows,
  planningTime,
  type CalendarLane,
  type CalendarScale,
} from "./timeline-calendar";

type Event = Operation["events"][number];
export function TimelineBoard({
  lanes,
  visible,
  laneFor,
  times,
  first,
  last,
  scale,
  dDay,
  selectedId,
  onSelect,
  onAdd,
  onEditLane,
  sourceNames,
}: {
  lanes: CalendarLane[];
  visible: Event[];
  laneFor: (event: Event) => string;
  times: Map<string, EventTiming>;
  first: number;
  last: number;
  scale: CalendarScale;
  dDay: number | null;
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: (laneId?: string) => void;
  onEditLane: (lane: TimelineLane) => void;
  sourceNames?: Map<string, string>;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(720);
  useLayoutEffect(() => {
    const el = viewport.current!;
    const measure = () => {
      if (el.clientWidth) setViewWidth(el.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);
  const side = Math.min(160, Math.max(94, Math.floor(viewWidth * 0.22)));
  const axis = calendarAxis(
    first,
    last,
    Math.max(1, viewWidth - side),
    scale,
    dDay,
  );
  const occupied = new Set(
    visible.filter((e) => times.get(e.id)?.start != null).map(laneFor),
  );
  const { rows, links, height } = calendarRows(
    lanes.filter((lane) => lane.editable || occupied.has(lane.id)),
    visible,
    laneFor,
    times,
    axis,
  );
  const unscheduled = visible.filter((e) => times.get(e.id)?.start == null);
  const marker = useId();
  const sourceLabel = (event: CalendarEvent) =>
    event.moduleId ? sourceNames?.get(event.moduleId) : undefined;
  const columns = {
    "--lane-width": side + "px",
    width: side + axis.width,
  } as CSSProperties;
  return (
    <>
      <div
        ref={viewport}
        className="planning-chart-scroll"
        tabIndex={0}
        role="region"
        aria-label="Timeline calendar"
      >
        <div className="timeline-board" style={columns}>
          <div className="timeline-header">
            <div className="timeline-corner">
              <span>{axis.hourly ? "Date" : "Calendar"}</span>
              <span>{axis.hourly ? "Time · UTC" : "Date · UTC"}</span>
              <span>Weekday</span>
              <span>D-Day</span>
            </div>
            <div className="timeline-dates">
              <div className="timeline-months">
                {axis.bands.map((band) => (
                  <span
                    key={band.left}
                    title={band.label}
                    style={{ width: band.width }}
                  >
                    {band.label}
                  </span>
                ))}
              </div>
              <div className="timeline-ticks">
                {axis.ticks.map((tick) => (
                  <div
                    key={tick.at}
                    title={tick.fullDate}
                    style={{ width: tick.width }}
                  >
                    <span>{tick.day}</span>
                    <span>{tick.weekday}</span>
                    <span className={tick.relative === "D" ? "is-zero" : ""}>
                      {tick.relative}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="timeline-body">
            {rows.map(({ lane, items, height: rowHeight }) => (
              <section
                key={lane.id}
                className="timeline-band"
                data-tone={lane.color}
                style={{ height: rowHeight }}
                aria-label={lane.name}
              >
                <div className="timeline-gutter">
                  {lane.editable ? (
                    <>
                      <button
                        className="timeline-lane-name"
                        aria-label={`Edit lane ${lane.name}`}
                        title="Edit lane"
                        onClick={() => onEditLane(lane)}
                      >
                        <strong className="planning-lane">{lane.name}</strong>
                      </button>
                      <button
                        className="timeline-lane-add"
                        aria-label={`Add event to ${lane.name}`}
                        title="Add event"
                        onClick={() => onAdd(lane.id)}
                      >
                        +
                      </button>
                    </>
                  ) : (
                    <strong className="planning-lane">{lane.name}</strong>
                  )}
                </div>
                <div className="timeline-track">
                  {items.map(
                    ({ event, timing, left, width, start, end, y }) => (
                      <button
                        key={event.id}
                        className="planning-event-row timeline-card"
                        data-event-id={event.id}
                        aria-pressed={event.id === selectedId}
                        aria-label={event.name}
                        title={[
                          `${event.name}\n${planningTime(timing.start!)}${start === end ? "" : " → " + planningTime(timing.end!)}`,
                          sourceLabel(event),
                        ]
                          .filter(Boolean)
                          .join("\n")}
                        style={{ left, width, top: y }}
                        onClick={() => onSelect(event.id)}
                      >
                        <i
                          className={
                            start === end
                              ? "timeline-diamond"
                              : "timeline-duration"
                          }
                          style={{
                            left: start - left,
                            width: Math.max(2, end - start),
                          }}
                        />
                        <span>{event.name}</span>
                      </button>
                    ),
                  )}
                </div>
              </section>
            ))}
            <div className="timeline-overlay" aria-hidden="true">
              {axis.ticks.map((tick, i) => (
                <i
                  key={tick.at}
                  className={i % 2 ? "tinted" : ""}
                  style={{ left: tick.left, width: tick.width }}
                />
              ))}
              {axis.zero !== null && (
                <b className="timeline-zero" style={{ left: axis.zero }} />
              )}
              <svg width={axis.width} height={height}>
                <defs>
                  <marker
                    id={marker}
                    viewBox="0 0 6 6"
                    refX="5"
                    refY="3"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto"
                  >
                    <path d="M0 0L6 3L0 6Z" fill="currentColor" />
                  </marker>
                </defs>
                {links.map((link) => (
                  <path
                    key={link.id}
                    data-timeline-link={link.id}
                    className={
                      selectedId === link.id || selectedId === link.parent
                        ? "highlight"
                        : ""
                    }
                    d={link.path}
                    fill="none"
                    stroke="currentColor"
                    markerEnd={`url(#${marker})`}
                  />
                ))}
              </svg>
            </div>
          </div>
        </div>
      </div>
      {!!unscheduled.length && (
        <section className="timeline-unscheduled">
          <h3>Unscheduled events</h3>
          <div>
            {unscheduled.map((event) => (
              <button
                className="planning-event-row"
                key={event.id}
                title={sourceLabel(event)}
                aria-label={event.name}
                aria-pressed={event.id === selectedId}
                onClick={() => onSelect(event.id)}
              >
                {event.name}
                <small>
                  {lanes.find((lane) => lane.id === laneFor(event))?.name}
                </small>
                {times.get(event.id)?.issue && (
                  <small>{times.get(event.id)!.issue}</small>
                )}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
