import { useState } from "react";
import type { Unit } from "../../domain/model";
import { Field } from "./Fields";
import { ModalBackdrop } from "./ModalBackdrop";
import { countLabel } from "./ui-text";

/** Keep same-name formations distinct without exposing internal identifiers. */
export function taskUnitOptions(units: Unit[]) {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const nameCounts = new Map<string, number>();
  for (const unit of units)
    nameCounts.set(unit.name, (nameCounts.get(unit.name) ?? 0) + 1);
  return units.map((unit) => {
    const ancestors: string[] = [];
    const seen = new Set([unit.id]);
    let parent = unit.parentUnitId;
    while (parent && !seen.has(parent)) {
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      seen.add(parent);
      ancestors.push(ancestor.name);
      parent = ancestor.parentUnitId;
    }
    const location = ancestors.length
      ? `Under ${ancestors.reverse().join(" › ")}`
      : "Top-level unit";
    return {
      id: unit.id,
      title: unit.name,
      location,
      name:
        nameCounts.get(unit.name)! > 1
          ? `${unit.name} — ${location}`
          : unit.name,
    };
  });
}

export function TaskUnitPicker({
  options,
  onAdd,
  onClose,
}: {
  options: ReturnType<typeof taskUnitOptions>;
  onAdd: (ids: Set<string>) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set<string>());
  const search = query.trim().toLowerCase();
  const matches = options.filter((unit) =>
    (unit.title + " " + unit.location).toLowerCase().includes(search),
  );
  return (
    <ModalBackdrop>
      <section
        className="modal profile-picker"
        aria-label="Add units from ORBAT"
      >
        <h2>Add units from ORBAT</h2>
        <Field label="Search ORBAT units" value={query} onChange={setQuery} />
        <div className="profile-picker-list task-unit-choices">
          {matches.map((unit) => (
            <label key={unit.id}>
              <input
                type="checkbox"
                checked={selected.has(unit.id)}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (checked) next.add(unit.id);
                    else next.delete(unit.id);
                    return next;
                  });
                }}
              />
              <span>
                <strong>{unit.title}</strong>
                <small>{unit.location}</small>
              </span>
            </label>
          ))}
          {!matches.length && <p className="empty-small">No matching units.</p>}
        </div>
        <div className="button-row">
          <button
            className="primary"
            disabled={!selected.size}
            onClick={() => onAdd(selected)}
          >
            {selected.size
              ? `Add ${countLabel(selected.size, "unit")}`
              : "Add units"}
          </button>
          <button data-dialog-cancel onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
