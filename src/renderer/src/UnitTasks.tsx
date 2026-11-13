import { useEffect, useRef, useState } from "react";
import type { Operation, Task } from "../../domain/model";
import { Field, Select, Panel } from "./Fields";
import { countLabel } from "./ui-text";
import { taskUnitOptions, TaskUnitPicker } from "./TaskUnitPicker";

export function UnitTasks({
  op,
  selectedId,
  reveal,
  change,
  addTask,
  addObjective,
  remove,
}: {
  op: Operation;
  selectedId: string;
  reveal: { id: string } | null;
  change: (edit: (d: Operation) => void) => void;
  addTask: (unitId: string | null) => string;
  addObjective: () => string;
  remove: (collection: "tasks" | "objectives", id: string) => void;
}) {
  const [expanded, setExpanded] = useState(new Set<string>());
  const [searchClosed, setSearchClosed] = useState(new Set<string>());
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    groupId: string;
  } | null>(null);
  const newRecord = useRef<string | null>(null);
  const form = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing || editing.id !== newRecord.current || !form.current) return;
    newRecord.current = null;
    form.current.querySelector<HTMLInputElement>("input")?.focus();
  }, [editing]);
  const options = taskUnitOptions(op.units);
  const objectivesById = new Map(op.objectives.map((o) => [o.id, o]));
  type Group = {
    id: string;
    name: string;
    aliases: string;
    unitId: string | null;
    tasks: Task[];
    objectives: Operation["objectives"];
  };
  const group = (
    id: string,
    name: string,
    unitId: string | null = null,
    aliases = "",
  ): Group => ({ id, name, unitId, aliases, tasks: [], objectives: [] });
  const buckets = new Map(
    options.map((u, i) => {
      const identity = op.units[i].profileIdentity;
      return [
        u.id,
        group(
          u.id,
          u.name,
          u.id,
          [
            identity?.abbreviation,
            identity?.shortDesignation,
            identity?.callsign,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      ];
    }),
  );
  const unassigned = group("unassigned", "Unassigned tasks");
  const objectiveGroups = new Map<string, Set<Group>>();
  for (const task of op.tasks) {
    const bucket = buckets.get(task.unitId ?? "") ?? unassigned;
    bucket.tasks.push(task);
    const objective = objectivesById.get(task.objectiveId ?? "");
    if (!objective) continue;
    const users = objectiveGroups.get(objective.id) ?? new Set<Group>();
    if (!users.has(bucket)) bucket.objectives.push(objective);
    users.add(bucket);
    objectiveGroups.set(objective.id, users);
  }
  const groups: Group[] = [];
  const available: typeof options = [];
  options.forEach((option, i) => {
    const bucket = buckets.get(option.id)!;
    if (op.units[i].onTaskList || bucket.tasks.length) groups.push(bucket);
    else available.push(option);
  });
  if (unassigned.tasks.length) groups.push(unassigned);
  const unused = group("objectives", "Unassigned objectives");
  unused.objectives = op.objectives.filter((o) => !objectiveGroups.has(o.id));
  if (unused.objectives.length) groups.push(unused);

  const search = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(search);
  const visible = groups.flatMap((g) => {
    if (!search || matches(g.name) || matches(g.aliases)) return [g];
    const pinned = editing?.groupId === g.id ? editing.id : "";
    const objectives = g.objectives.filter(
      (o) => o.id === pinned || matches(o.name),
    );
    const matchedObjectives = new Set(objectives.map((o) => o.id));
    const tasks = g.tasks.filter(
      (t) =>
        t.id === pinned ||
        matches(t.name) ||
        matchedObjectives.has(t.objectiveId ?? ""),
    );
    return tasks.length || objectives.length
      ? [{ ...g, tasks, objectives }]
      : [];
  });
  const isOpen = (id: string) =>
    search ? !searchClosed.has(id) : expanded.has(id);
  const setOpen = (ids: string[], open: boolean) => {
    const set = search ? setSearchClosed : setExpanded;
    set((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (search ? !open : open) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const openRecord = (id: string, groupId: string) => {
    setExpanded((previous) => new Set(previous).add(groupId));
    setEditing({ id, groupId });
  };
  // Validation and workspace search may reopen the same record through an active local filter.
  useEffect(() => {
    const id = reveal?.id ?? selectedId;
    const g = groups.find(
      (g) =>
        g.tasks.some((t) => t.id === id) ||
        g.objectives.some((o) => o.id === id),
    );
    if (g) {
      setQuery("");
      openRecord(id, g.id);
    }
  }, [selectedId, reveal]);
  const createTask = (unitId: string | null) => {
    setQuery("");
    const id = addTask(unitId);
    newRecord.current = id;
    openRecord(id, unitId ?? "unassigned");
  };
  const editTask = (task: Task) => (
    <div className="task-record-editor" ref={form}>
      <Field
        label="Task"
        value={task.name}
        onChange={(v) =>
          change((d) => {
            d.tasks.find((t) => t.id === task.id)!.name = v;
          })
        }
      />
      <div className="three-columns">
        <Select
          label="Assigned unit"
          value={task.unitId}
          options={options}
          onChange={(v) => {
            setOpen([v ?? "unassigned"], true);
            openRecord(task.id, v ?? "unassigned");
            change((d) => {
              d.tasks.find((t) => t.id === task.id)!.unitId = v;
            });
          }}
        />
        <Select
          label="Phase"
          value={task.phaseId}
          options={op.phases}
          onChange={(v) =>
            change((d) => {
              d.tasks.find((t) => t.id === task.id)!.phaseId = v;
            })
          }
        />
        <Select
          label="Objective"
          value={task.objectiveId}
          options={op.objectives}
          onChange={(v) =>
            change((d) => {
              d.tasks.find((t) => t.id === task.id)!.objectiveId = v;
            })
          }
        />
      </div>
      <Field
        label="Purpose"
        area
        value={task.purpose}
        onChange={(v) =>
          change((d) => {
            d.tasks.find((t) => t.id === task.id)!.purpose = v;
          })
        }
      />
      <button
        className="text-button danger"
        onClick={() => remove("tasks", task.id)}
      >
        Remove task
      </button>
    </div>
  );
  const editObjective = (objective: Operation["objectives"][number]) => {
    const users = [...(objectiveGroups.get(objective.id) ?? [])];
    return (
      <div className="task-record-editor" ref={form}>
        {users.length > 1 && (
          <p className="hint">
            Shared objective: {users.map((g) => g.name).join(", ")}. Edits apply
            to every task using it.
          </p>
        )}
        <Field
          label="Objective name"
          value={objective.name}
          onChange={(v) =>
            change((d) => {
              d.objectives.find((o) => o.id === objective.id)!.name = v;
            })
          }
        />
        <Field
          label="Objective description"
          area
          value={objective.description}
          onChange={(v) =>
            change((d) => {
              d.objectives.find((o) => o.id === objective.id)!.description = v;
            })
          }
        />
        <button
          className="text-button danger"
          onClick={() => remove("objectives", objective.id)}
        >
          Remove objective
        </button>
      </div>
    );
  };
  const row = (
    groupId: string,
    record: Task | Operation["objectives"][number],
  ) => {
    const active = editing?.id === record.id && editing.groupId === groupId;
    const isTask = "unitId" in record;
    const context = isTask
      ? [
          op.phases.find((p) => p.id === record.phaseId)?.name,
          objectivesById.get(record.objectiveId ?? "")?.name,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    return (
      <div className="task-record" key={record.id} data-entity-id={record.id}>
        <button
          className="task-record-summary"
          aria-expanded={active}
          onClick={() => setEditing(active ? null : { id: record.id, groupId })}
        >
          <span>
            {record.name || (isTask ? "Unnamed task" : "Unnamed objective")}
          </span>
          {context && <small>{context}</small>}
        </button>
        {active && (isTask ? editTask(record) : editObjective(record))}
      </div>
    );
  };
  const allClosed = visible.every((g) => !isOpen(g.id));
  return (
    <Panel
      title="Tasks & objectives by unit"
      action={
        <div className="button-row">
          <button onClick={() => setPicking(true)} disabled={!available.length}>
            Add units from ORBAT
          </button>
          <button onClick={() => createTask(null)}>+ Add task</button>
          <button
            onClick={() => {
              setQuery("");
              const id = addObjective();
              newRecord.current = id;
              openRecord(id, "objectives");
            }}
          >
            + Add objective
          </button>
        </div>
      }
    >
      {picking && (
        <TaskUnitPicker
          options={available}
          onClose={() => setPicking(false)}
          onAdd={(ids) => {
            change((d) => {
              for (const unit of d.units)
                if (ids.has(unit.id)) unit.onTaskList = true;
            });
            setQuery("");
            if (ids.size === 1)
              setExpanded((previous) => new Set([...previous, ...ids]));
            setPicking(false);
          }}
        />
      )}
      {!!groups.length && (
        <div className="task-list-tools">
          <label className="field">
            <span>Find a unit, task or objective</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchClosed(new Set());
                setEditing(null);
              }}
            />
          </label>
          {!!visible.length && (
            <button
              onClick={() =>
                setOpen(
                  visible.map((g) => g.id),
                  allClosed,
                )
              }
            >
              {allClosed ? "Expand all units" : "Collapse all units"}
            </button>
          )}
        </div>
      )}
      {!groups.length && (
        <p className="empty-small">
          {op.units.length
            ? "No units on the task list yet. Choose Add units from ORBAT to get started."
            : "Your task list is empty. Add units in Task organization to choose them here."}
        </p>
      )}
      {!!groups.length && !visible.length && (
        <p className="empty-small" role="status">
          No matching units, tasks or objectives.{" "}
          <button className="text-button" onClick={() => setQuery("")}>
            Clear search
          </button>
        </p>
      )}
      {visible.map((g) => {
        const open = isOpen(g.id);
        return (
          <details
            key={g.id}
            className="unit-task-group"
            data-task-unit-id={g.id}
            open={open}
          >
            <summary
              onClick={(e) => {
                e.preventDefault();
                setOpen([g.id], !open);
              }}
            >
              <strong>{g.name}</strong>
              <span>
                {g.id !== "objectives" && countLabel(g.tasks.length, "task")}
                {g.id !== "objectives" && g.objectives.length > 0 && " · "}
                {(g.id === "objectives" || g.objectives.length > 0) &&
                  countLabel(g.objectives.length, "objective")}
              </span>
            </summary>
            {open && (
              <div className="unit-task-content">
                {!!g.tasks.length && (
                  <section aria-label={`Tasks for ${g.name}`}>
                    <h3>Tasks</h3>
                    {g.tasks.map((t) => row(g.id, t))}
                  </section>
                )}
                {!!g.objectives.length && (
                  <section aria-label={`Objectives for ${g.name}`}>
                    <h3>Objectives</h3>
                    {g.objectives.map((o) => row(g.id, o))}
                  </section>
                )}
                {g.unitId && (
                  <div className="button-row">
                    <button
                      className="text-button"
                      aria-label={`Add task for ${g.name}`}
                      onClick={() => createTask(g.unitId)}
                    >
                      + Add task for this unit
                    </button>
                    {!buckets.get(g.unitId)!.tasks.length && (
                      <button
                        className="text-button"
                        onClick={() =>
                          change((d) => {
                            const unit = d.units.find((u) => u.id === g.unitId);
                            if (unit) delete unit.onTaskList;
                          })
                        }
                      >
                        Remove from task list
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </details>
        );
      })}
    </Panel>
  );
}
