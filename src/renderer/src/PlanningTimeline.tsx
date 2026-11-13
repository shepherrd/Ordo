import { useEffect, useMemo, useState } from "react";
import type { Operation, ResolvedConfig } from "../../domain/model";
import {
  moduleDefinition,
  moduleConfiguration,
} from "../../domain/module-authoring";
import {
  editTimelineEvent,
  timelineModuleEvents,
  moduleEventKey,
  type CalendarEvent,
} from "../../domain/module-timeline";
import { TimelineSources, useTimelineSources } from "./TimelineSources";
import {
  eventLinkOptions,
  newEventSchedule,
  resolveSchedule,
  timelineLanes,
  type TimelineLane,
} from "../../domain/planning-schedule";
import { Field, Panel, Select } from "./Fields";
import { TimelineBoard } from "./TimelineBoard";
import { TimelineLaneEditor } from "./TimelineLaneEditor";
import {
  DAY,
  planningTime,
  type CalendarLane,
  type CalendarScale,
} from "./timeline-calendar";
import "./planning-schedule.css";

export function PlanningTimeline({
  op,
  config,
  selectedId: externalSelection,
  onSelect: externalSelect,
  moduleId,
  revealItem,
  change,
  onAdd,
  onRemove,
}: {
  op: Operation;
  config: ResolvedConfig;
  selectedId?: string;
  onSelect?: (id: string) => void;
  moduleId?: string;
  revealItem?: { moduleId: string; itemId: string };
  change: (fn: (d: Operation) => void) => void;
  onAdd?: (laneId?: string) => void;
  onRemove?: (id: string) => void;
}) {
  const [localId, setLocalId] = useState("");
  const selectedId = externalSelection ?? localId;
  const onSelect = externalSelect ?? setLocalId;
  const sources = useMemo(() => {
    const attachments = new Map(op.attachments.map((a) => [a.id, a]));
    return (op.modules?.instances ?? [])
      .filter(
        (m) =>
          m.layoutState === "ACTIVE" &&
          m.content.type === "TIMELINE" &&
          (!moduleId || m.moduleInstanceId === moduleId),
      )
      .map((m) => {
        const attachment = attachments.get(m.productInstanceId);
        const product = attachment
          ? `${attachment.kind[0].toUpperCase() + attachment.kind.slice(1)} ${attachment.code} · ${attachment.name}`
          : "Base order";
        return {
          id: m.moduleInstanceId,
          name:
            product +
            " / " +
            (moduleDefinition(m, config)?.title ?? "Timeline"),
          mode: moduleConfiguration(m, config).timelineMode,
          events: timelineModuleEvents(m),
        };
      });
  }, [op.modules, op.attachments, config, moduleId]);
  const sourceFilter = useTimelineSources(op.id);
  const allEvents = useMemo<CalendarEvent[]>(
    () => [...op.events, ...sources.flatMap((s) => s.events)],
    [op.events, sources],
  );
  const schedule = useMemo(
    () => ({ ...op, events: allEvents }),
    [op, allEvents],
  );
  const [group, setGroup] = useState("lanes"),
    [phase, setPhase] = useState<string | null>(null),
    [query, setQuery] = useState("");
  const [zoom, setZoom] = useState<CalendarScale>("fit"),
    [page, setPage] = useState(0),
    [error, setError] = useState("");
  const times = useMemo(() => resolveSchedule(schedule), [allEvents]);
  const selected = allEvents.find((e) => e.id === selectedId);
  const source = sources.find((s) => s.id === (selected?.moduleId ?? moduleId));
  const event =
    selected &&
    (moduleId
      ? selected.moduleId === moduleId
      : !selected.moduleId || !sourceFilter.hidden.has(selected.moduleId))
      ? selected
      : undefined;
  useEffect(() => {
    if (moduleId && revealItem?.moduleId === moduleId) {
      setLocalId(moduleEventKey(moduleId, revealItem.itemId));
      setQuery("");
      setPhase(null);
    }
  }, [moduleId, revealItem]);
  const linkOptions = useMemo(
    () =>
      eventLinkOptions(schedule, selectedId).filter(
        (e) =>
          !e.id.includes(":") ||
          (event?.moduleId && e.id.startsWith(event.moduleId + ":")),
      ),
    [allEvents, selectedId, event?.moduleId],
  );
  const assignedLanes = timelineLanes(op);
  const [editingLane, setEditingLane] = useState<
    TimelineLane | null | undefined
  >(undefined);
  const staff = new Map(config.doctrine.staff.map((s) => [s.id, s.name]));
  const units = new Map(op.units.map((u) => [u.id, u.name]));
  const laneFor = (event: Operation["events"][number]) => {
    if (group === "unit") return event.schedule?.unitId ?? "unassigned-unit";
    if (group === "staff") return event.metadata.ownerId ?? "unassigned-staff";
    if (group === "time") return "events";
    return event.schedule?.laneId ?? "unsorted";
  };
  const laneMap = new Map<string, CalendarLane>();
  if (group === "lanes")
    assignedLanes.forEach((lane) =>
      laneMap.set(lane.id, { ...lane, editable: true }),
    );
  const scopedEvents = allEvents.filter((e) =>
    moduleId
      ? e.moduleId === moduleId
      : !e.moduleId || !sourceFilter.hidden.has(e.moduleId),
  );
  const events = scopedEvents
    .filter(
      (e) =>
        (!phase || e.phaseId === phase) &&
        (!query ||
          `${e.name} ${units.get(e.schedule?.unitId ?? "") ?? ""}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())),
    )
    .sort(
      (a, b) =>
        (times.get(a.id)?.start ?? Infinity) -
          (times.get(b.id)?.start ?? Infinity) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  const currentPage = Math.min(
      page,
      Math.max(0, Math.ceil(events.length / 60) - 1),
    ),
    visible = events.slice(currentPage * 60, (currentPage + 1) * 60);
  const scheduled = events.flatMap((e) => {
    const t = times.get(e.id)!;
    return t.start === null ? [] : [t];
  });
  visible.forEach((event) => {
    const id = laneFor(event);
    if (laneMap.has(id)) return;
    const name =
      group === "unit"
        ? (units.get(id) ?? "Unassigned unit")
        : group === "staff"
          ? (staff.get(id) ?? "Unassigned staff")
          : group === "time"
            ? "Events"
            : "Unsorted events";
    laneMap.set(id, { id, name, color: "slate" });
  });
  const dDay = op.timeline?.dDay
    ? Date.parse(op.timeline.dDay + "T00:00:00Z")
    : null;
  const first = scheduled.reduce((min, t) => Math.min(min, t.start!), Infinity);
  const last = scheduled.reduce((max, t) => Math.max(max, t.end!), -Infinity);
  const emptyStart = dDay ?? Date.now();
  const edit = (fn: (e: CalendarEvent) => void) =>
    event && change((d) => editTimelineEvent(d, event, fn));
  const add = (laneId?: string) => {
    setQuery("");
    setPhase(null);
    setError("");
    if (!moduleId) {
      onAdd?.(laneId);
      return;
    }
    const id = crypto.randomUUID();
    const relative = source?.mode === "RELATIVE";
    const parent: CalendarEvent | undefined = source?.events[0] ?? op.events[0];
    change((d) => {
      const m = d.modules?.instances.find(
        (m) => m.moduleInstanceId === moduleId,
      );
      if (m?.content.type !== "TIMELINE") return;
      m.content.items.push({
        id,
        title: "New event",
        description: "",
        phaseId: null,
        ...(laneId ? { schedule: { ...newEventSchedule(), laneId } } : {}),
        timing:
          relative && parent
            ? {
                mode: "RELATIVE",
                referenceEventId: parent.itemId ?? parent.id,
                ...(parent.moduleId ? { withinModule: true as const } : {}),
                offsetMinutes: 0,
              }
            : { mode: "ABSOLUTE", at: null },
      });
      m.updatedAt = new Date().toISOString();
    });
    onSelect(moduleEventKey(moduleId, id));
  };
  const number = (
    v: string,
    min: number,
    max: number,
    fn: (n: number) => void,
  ) => {
    if (v === "") return;
    const n = Number(v);
    if (Number.isInteger(n) && n >= min && n <= max) {
      setError("");
      fn(n);
    } else
      setError(
        `Enter a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.`,
      );
  };
  return (
    <Panel
      title={moduleId ? "Timeline calendar" : "Timeline"}
      subtitle={
        moduleId
          ? "Events in this module also appear on the operation timeline."
          : undefined
      }
      action={
        <div className="button-row">
          <button
            disabled={assignedLanes.length >= 64}
            onClick={() => setEditingLane(null)}
          >
            Add lane
          </button>
          <button className="primary" onClick={() => add()}>
            + Add event
          </button>
        </div>
      }
    >
      <div className="planning-toolbar">
        <Field
          label="Find events"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
        />
        <Select
          label="Timeline phase"
          empty="All phases"
          options={op.phases}
          value={phase}
          onChange={(v) => {
            setPhase(v);
            setPage(0);
          }}
        />
        <label className="field">
          <span>Group by</span>
          <select
            aria-label="Group timeline by"
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(0);
            }}
          >
            <option value="lanes">Timeline lanes</option>
            <option value="time">Time</option>
            <option value="unit">Unit</option>
            <option value="staff">Staff section</option>
          </select>
        </label>
        <label className="field">
          <span>Time scale</span>
          <select
            aria-label="Timeline scale"
            value={zoom}
            onChange={(e) => setZoom(e.target.value as CalendarScale)}
          >
            <option value="fit">Fit schedule</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <Field
          label="D-Day (UTC)"
          type="date"
          value={op.timeline?.dDay ?? ""}
          onChange={(value) =>
            change((d) => {
              d.timeline ??= {};
              if (value) d.timeline.dDay = value;
              else delete d.timeline.dDay;
            })
          }
        />
      </div>
      {!moduleId && sources.length > 0 && (
        <TimelineSources sources={sources} {...sourceFilter} />
      )}
      <p className="planning-caption">
        {scheduled.length} scheduled · {events.length - scheduled.length}{" "}
        unscheduled · All times UTC
      </p>
      <div
        className={`planning-timeline-layout ${event ? "has-selection" : ""}`}
      >
        <div className="planning-chart-wrap">
          {!!(moduleId ? scopedEvents.length : allEvents.length) &&
            !events.length && (
              <p className="planning-caption">No events match these filters.</p>
            )}
          {!(moduleId ? scopedEvents.length : allEvents.length) && (
            <p className="planning-caption">
              Add an event to begin your timeline.
            </p>
          )}
          <TimelineBoard
            lanes={[...laneMap.values()]}
            visible={visible}
            laneFor={laneFor}
            times={times}
            sourceNames={
              moduleId ? undefined : new Map(sources.map((s) => [s.id, s.name]))
            }
            first={scheduled.length ? first : emptyStart}
            last={scheduled.length ? last : emptyStart + 6 * DAY}
            scale={zoom}
            dDay={dDay}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelect(id);
              setError("");
            }}
            onAdd={add}
            onEditLane={setEditingLane}
          />
          {events.length > 60 && (
            <div className="planning-pagination">
              <button
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous events
              </button>
              <span>
                {currentPage * 60 + 1}–
                {Math.min((currentPage + 1) * 60, events.length)} of{" "}
                {events.length}
              </span>
              <button
                disabled={(currentPage + 1) * 60 >= events.length}
                onClick={() => setPage(currentPage + 1)}
              >
                More events
              </button>
            </div>
          )}
        </div>
        {event && (
          <section
            className="planning-event-editor"
            data-entity-id={event.id}
            data-item-id={event.itemId}
            aria-label="Selected event"
          >
            <div className="planning-editor-heading">
              <h3>Selected event</h3>
              <button
                aria-label="Close event editor"
                onClick={() => onSelect("")}
              >
                ×
              </button>
            </div>
            {!moduleId && event.moduleId && (
              <p className="planning-caption">Source · {source?.name}</p>
            )}
            <Field
              label="Event name"
              value={event.name}
              onChange={(v) =>
                edit((e) => {
                  e.name = v;
                })
              }
            />
            {event.moduleId && (
              <Field
                label="Event description"
                area
                value={event.description ?? ""}
                onChange={(value) =>
                  edit((e) => {
                    e.description = value;
                  })
                }
              />
            )}
            <Select
              label="Event lane"
              empty="Unsorted events"
              options={assignedLanes}
              value={event.schedule?.laneId ?? null}
              onChange={(id) =>
                edit((e) => {
                  if (id) {
                    e.schedule ??= newEventSchedule();
                    e.schedule.laneId = id;
                  } else if (e.schedule) delete e.schedule.laneId;
                })
              }
            />
            <Select
              label="Event phase"
              options={op.phases}
              value={event.phaseId}
              onChange={(v) =>
                edit((e) => {
                  e.phaseId = v;
                })
              }
            />
            <Select
              label="Event unit"
              options={op.units}
              value={event.schedule?.unitId ?? null}
              onChange={(v) =>
                edit((e) => {
                  e.schedule ??= newEventSchedule();
                  e.schedule.unitId = v;
                })
              }
            />
            <Select
              label="Event staff section"
              options={config.doctrine.staff}
              value={event.metadata.ownerId}
              onChange={(v) =>
                edit((e) => {
                  e.metadata.ownerId = v;
                })
              }
            />
            {(source?.mode !== "ABSOLUTE" || event.relativeToEventId) && (
              <Select
                label="Relative to event"
                empty={
                  source?.mode === "RELATIVE"
                    ? "Choose a reference event"
                    : "Use an absolute time"
                }
                options={linkOptions}
                value={event.relativeToEventId}
                onChange={(v) =>
                  edit((e) => {
                    const resolved = times.get(e.id)?.start;
                    e.relativeToEventId = v;
                    e.at =
                      v || source?.mode === "RELATIVE"
                        ? null
                        : resolved == null
                          ? null
                          : new Date(resolved).toISOString();
                  })
                }
              />
            )}
            {event.relativeToEventId ? (
              <>
                <label className="field">
                  <span>Follow</span>
                  <select
                    aria-label="Follow linked event"
                    value={event.schedule?.relativeAnchor ?? "START"}
                    onChange={(v) =>
                      edit((e) => {
                        e.schedule ??= newEventSchedule();
                        e.schedule.relativeAnchor = v.target.value as
                          "START" | "END";
                      })
                    }
                  >
                    <option value="START">Event start</option>
                    <option value="END">Event finish</option>
                  </select>
                </label>
                <Field
                  label="Offset in minutes"
                  type="number"
                  value={String(event.offsetMinutes)}
                  onChange={(v) =>
                    number(v, -5256000, 5256000, (n) =>
                      edit((e) => {
                        e.offsetMinutes = n;
                      }),
                    )
                  }
                />
              </>
            ) : (
              (source?.mode !== "RELATIVE" || event.at) && (
                <Field
                  label="Absolute time (UTC)"
                  type="datetime-local"
                  value={event.at?.slice(0, 16) ?? ""}
                  onChange={(v) => {
                    const time = v ? new Date(v + "Z") : null;
                    if (!time || Number.isFinite(time.getTime()))
                      edit((e) => {
                        e.at = time?.toISOString() ?? null;
                      });
                  }}
                />
              )
            )}
            <Field
              label="Duration in minutes"
              type="number"
              value={String(event.schedule?.durationMinutes ?? 0)}
              onChange={(v) =>
                number(v, 0, 525600, (n) =>
                  edit((e) => {
                    e.schedule ??= newEventSchedule();
                    e.schedule.durationMinutes = n;
                  }),
                )
              }
            />
            <small>
              Use a duration of 0 for a milestone.
              {event.relativeToEventId &&
                " Negative offsets place this event before the linked time."}
            </small>
            <p className="planning-resolved">
              {times.get(event.id)?.start == null ? (
                times.get(event.id)?.issue || "Unscheduled"
              ) : (
                <>
                  {planningTime(times.get(event.id)!.start!)}
                  {times.get(event.id)!.end !== times.get(event.id)!.start && (
                    <>
                      <br />
                      Until {planningTime(times.get(event.id)!.end!)}
                    </>
                  )}
                </>
              )}
            </p>
            {error && (
              <p role="alert" className="planning-issue">
                {error}
              </p>
            )}
            <button
              className="danger"
              onClick={() => {
                const dependents = allEvents.filter(
                  (e) => e.relativeToEventId === event.id,
                );
                if (dependents.length)
                  setError(
                    `Change the scheduling link on ${dependents.map((e) => e.name).join(", ")} before removing this event.`,
                  );
                else if (event.moduleId) {
                  change((d) => {
                    const m = d.modules?.instances.find(
                      (m) => m.moduleInstanceId === event.moduleId,
                    );
                    if (m?.content.type === "TIMELINE") {
                      m.content.items = m.content.items.filter(
                        (i) => i.id !== event.itemId,
                      );
                      m.updatedAt = new Date().toISOString();
                    }
                  });
                  onSelect("");
                } else onRemove?.(event.id);
              }}
            >
              Remove event
            </button>
          </section>
        )}
      </div>
      {editingLane !== undefined && (
        <TimelineLaneEditor
          lane={editingLane}
          lanes={assignedLanes}
          onClose={() => setEditingLane(undefined)}
          onSave={(lane) => {
            change((d) => {
              const next = timelineLanes(d);
              (d.timeline ??= {}).lanes = editingLane
                ? next.map((l) => (l.id === lane.id ? lane : l))
                : [...next, lane];
            });
            setGroup("lanes");
            setEditingLane(undefined);
          }}
          onRemove={() => {
            if (!editingLane) return;
            change((d) => {
              (d.timeline ??= {}).lanes = timelineLanes(d).filter(
                (l) => l.id !== editingLane.id,
              );
              for (const e of d.events)
                if (e.schedule?.laneId === editingLane.id)
                  delete e.schedule.laneId;
              for (const m of d.modules?.instances ?? [])
                if (m.content.type === "TIMELINE")
                  for (const item of m.content.items)
                    if (item.schedule?.laneId === editingLane.id)
                      delete item.schedule.laneId;
            });
            setEditingLane(undefined);
          }}
        />
      )}
    </Panel>
  );
}
