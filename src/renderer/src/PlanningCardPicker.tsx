import "./planning-card-picker.css";
import { useMemo, useState } from "react";
import type { Operation, ResolvedConfig } from "../../domain/model";
import type { PlanningCard } from "../../domain/planning-cards";
import { resolveCardSource } from "../../domain/planning-card-resolution";
import { operationSearchDocuments } from "../../domain/search-documents";
import {
  cardSource,
  targetKey,
  type PlanningTarget,
} from "../../domain/planning-target";
import { normalizeSearch } from "../../domain/search";
import { ModalBackdrop } from "./ModalBackdrop";

export function PlanningCardPicker({
  op,
  config,
  onAdd,
  onClose,
  searchLabel = "Search planning content",
}: {
  op: Operation;
  config: ResolvedConfig;
  onAdd: (card: PlanningCard, isNew: boolean) => void;
  onClose: () => void;
  searchLabel?: string;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<PlanningTarget | null>(null),
    [fields, setFields] = useState<PlanningCard["fields"]>([]);
  const sources = useMemo(() => {
    const unique = new Map<string, { target: PlanningTarget; title: string }>();
    for (const d of operationSearchDocuments(op, config)) {
      const t = cardSource(d.target);
      if (t && !unique.has(targetKey(t)))
        unique.set(targetKey(t), { target: t, title: d.title });
    }
    return [...unique.values()];
  }, [op, config]);
  const matches = sources.filter((s) =>
    normalizeSearch(s.title).includes(normalizeSearch(query)),
  );
  let source: ReturnType<typeof resolveCardSource> | null = null;
  try {
    if (selected) source = resolveCardSource(op, config, selected);
  } catch {
    /* Removed sources cannot be inserted. */
  }
  return (
    <ModalBackdrop>
      <div className="modal planning-card-picker">
        <h2>Add planning content</h2>
        <label className="field">
          Search sources or saved cards
          <input
            autoFocus
            aria-label={searchLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="planning-card-picker-columns">
          <div className="planning-card-sources">
            {(op.planningCards?.definitions ?? [])
              .filter((c) =>
                normalizeSearch(c.title).includes(normalizeSearch(query)),
              )
              .slice(0, 30)
              .map((c) => (
                <button key={c.id} onClick={() => onAdd(c, false)}>
                  {c.title}
                  <small>
                    Saved card ·{" "}
                    {c.mode === "linked" ? "Linked" : "Independent"}
                  </small>
                </button>
              ))}
            {matches.slice(0, 50).map((s) => (
              <button
                key={targetKey(s.target)}
                aria-pressed={
                  (selected && targetKey(selected) === targetKey(s.target)) ||
                  false
                }
                onClick={() => {
                  setSelected(s.target);
                  try {
                    setFields(
                      resolveCardSource(op, config, s.target)
                        .values.filter(
                          (v) =>
                            v.value &&
                            v.key !== "status" &&
                            v.key !== "staff" &&
                            v.key !== "name",
                        )
                        .slice(0, 3)
                        .map((v) => v.key),
                    );
                  } catch {
                    setFields([]);
                  }
                }}
              >
                {s.title}
                <small>
                  {s.target.kind === "entity"
                    ? s.target.entityKind
                    : "Written content"}
                </small>
              </button>
            ))}
            {!matches.length && <p>No matching sources.</p>}
            {matches.length > 50 && (
              <p>Showing the first 50. Refine your search.</p>
            )}
          </div>
          <div>
            {source ? (
              <>
                <h3>{source.title}</h3>
                <p>
                  Choose the fields to display. Their values follow the source.
                </p>
                <fieldset className="planning-card-fields">
                  <legend>Displayed fields</legend>
                  {source.values.map((v) => (
                    <label className="check" key={v.key}>
                      <input
                        type="checkbox"
                        checked={fields.includes(v.key)}
                        onChange={(e) =>
                          setFields((a) =>
                            e.target.checked
                              ? [...a, v.key]
                              : a.filter((k) => k !== v.key),
                          )
                        }
                      />
                      <span>
                        {v.label}
                        <small>{v.value.slice(0, 200) || "Empty"}</small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </>
            ) : (
              <p>
                Select a source to choose its fields, or choose a saved card.
              </p>
            )}
          </div>
        </div>
        <div className="button-row">
          <button
            disabled={!source || !fields.length}
            onClick={() => {
              if (source && selected)
                onAdd(
                  {
                    id: crypto.randomUUID(),
                    title: source.title.slice(0, 160),
                    mode: "linked",
                    source: selected,
                    fields,
                  },
                  true,
                );
            }}
          >
            Add linked content
          </button>
          <button data-dialog-cancel onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
