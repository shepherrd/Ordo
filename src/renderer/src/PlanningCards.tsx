import { useMemo, useState } from "react";
import type { Operation, ResolvedConfig } from "../../domain/model";
import type { ModuleInstance } from "../../domain/modules";
import type { PlanningCard } from "../../domain/planning-cards";
import {
  cardPlacements,
  independentCard,
  resolveCardSource,
  resolvePlanningCard,
} from "../../domain/planning-card-resolution";
import { operationSearchDocuments } from "../../domain/search-documents";
import {
  cardSource,
  targetKey,
  type PlanningTarget,
} from "../../domain/planning-target";
import { normalizeSearch } from "../../domain/search";
import { ModalBackdrop } from "./ModalBackdrop";
import { useWorkspaceSession } from "./WorkspaceContext";
import { Field } from "./Fields";
import { canonical } from "../../export/projection";
import { PlanningUsage } from "./PlanningUsage";
import "./planning-cards.css";
import { useSearchOpen } from "./SearchProvider";
export async function cardHash(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function PlanningCards({
  op,
  config,
  module,
  change,
}: {
  op: Operation;
  config: ResolvedConfig;
  module: ModuleInstance;
  change: (edit: (draft: Operation) => void) => void;
}) {
  const session = useWorkspaceSession();
  const [picker, setPicker] = useState(false),
    [replacement, setReplacement] = useState(""),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<PlanningTarget | null>(null),
    [inspector, setInspector] = useState(""),
    [usage, setUsage] = useState(""),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0);
  const cards = op.planningCards?.definitions ?? [];
  const definitions = useMemo(
    () => new Map(cards.map((c) => [c.id, c])),
    [op.planningCards],
  );
  const placements =
    module.content.type === "PLANNING_CARDS" ? module.content.placements : [];
  useSearchOpen(
    "operation",
    (target) => {
      if (
        target.area !== "operation" ||
        target.operationId !== op.id ||
        target.target.kind !== "card"
      )
        return;
      const cardId = target.target.cardId;
      const index = placements.findIndex((p) => p.cardId === cardId);
      if (index >= 0) setOffset(Math.floor(index / 20) * 20);
    },
    module.moduleInstanceId,
  );
  const sources = useMemo(() => {
    if (!picker) return [];
    const unique = new Map<
      string,
      { target: PlanningTarget; title: string; text: string }
    >();
    for (const d of operationSearchDocuments(op, config)) {
      const target = cardSource(d.target);
      if (!target || unique.has(targetKey(target))) continue;
      try {
        const source = resolveCardSource(op, config, target);
        unique.set(targetKey(target), {
          target,
          title: source.title,
          text: source.values.map((v) => v.value).join(" "),
        });
      } catch {
        /* Only available authored sources belong in the picker. */
      }
    }
    return [...unique.values()];
  }, [op, config, picker]);
  const matches = sources
    .filter((s) =>
      normalizeSearch(s.title + " " + s.text).includes(normalizeSearch(query)),
    )
    .slice(0, 50);
  let preview: ReturnType<typeof resolveCardSource> | null = null;
  try {
    if (selected) preview = resolveCardSource(op, config, selected);
  } catch {
    /* source may be edited while picker is open */
  }
  const editPlacements = (fn: (p: typeof placements) => void) =>
    change((d) => {
      const m = d.modules!.instances.find(
        (m) => m.moduleInstanceId === module.moduleInstanceId,
      )!;
      if (m.content.type === "PLANNING_CARDS") fn(m.content.placements);
    });
  const insert = () => {
    if (!selected || !preview) return;
    const source = selected,
      title = preview.title;
    const fields = preview.values
      .filter((v) => v.value || v.key === "name" || v.key === "text")
      .map((v) => v.key);
    change((d) => {
      d.planningCards ??= { schemaVersion: 1, definitions: [] };
      if (replacement) {
        d.planningCards.definitions = d.planningCards.definitions.map((c) =>
          c.id === replacement
            ? { id: c.id, title: c.title, mode: "linked", source, fields }
            : c,
        );
      } else {
        const id = crypto.randomUUID();
        d.planningCards.definitions.push({
          id,
          title: title.slice(0, 160),
          mode: "linked",
          source,
          fields,
        });
        const m = d.modules!.instances.find(
          (m) => m.moduleInstanceId === module.moduleInstanceId,
        )!;
        if (m.content.type === "PLANNING_CARDS")
          m.content.placements.push({
            id: crypto.randomUUID(),
            cardId: id,
            layout: "detailed",
          });
      }
    });
    setPicker(false);
    setSelected(null);
    setReplacement("");
  };
  const detach = async (card: PlanningCard, placementId: string) => {
    if (card.mode !== "linked") return;
    try {
      const values = resolvePlanningCard(op, config, card).values;
      const copy = independentCard(op, config, card, crypto.randomUUID(), {
        target: card.source,
        contentHash: await cardHash(values),
        state: session.search.originState(op.id),
      });
      change((d) => {
        // Re-check the exact displayed source after asynchronous hashing.
        if (
          canonical(resolvePlanningCard(d, config, card).values) !==
          canonical(values)
        )
          throw Error("The source changed. Try copying again.");
        d.planningCards!.definitions.push(copy);
        const m = d.modules!.instances.find(
          (m) => m.moduleInstanceId === module.moduleInstanceId,
        )!;
        if (m.content.type === "PLANNING_CARDS")
          m.content.placements.find((p) => p.id === placementId)!.cardId =
            copy.id;
      });
    } catch (e) {
      setError(String(e));
    }
  };
  const updateCard = (id: string, fn: (c: PlanningCard) => void) =>
    change((d) => fn(d.planningCards!.definitions.find((c) => c.id === id)!));
  return (
    <section className="planning-cards" aria-label="Planning cards">
      <div className="button-row">
        <button
          onClick={() => {
            setReplacement("");
            setPicker(true);
          }}
        >
          Insert linked card
        </button>
        <label>
          Reuse card
          <select
            aria-label="Reuse planning card"
            value=""
            onChange={(e) => {
              if (e.target.value)
                editPlacements((p) =>
                  p.push({
                    id: crypto.randomUUID(),
                    cardId: e.target.value,
                    layout: "detailed",
                  }),
                );
            }}
          >
            <option value="">Choose an existing card</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.mode === "independent" ? " · Independent" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {!placements.length && (
        <p>
          Insert a view of an existing task, unit, phase, event, objective, or
          narrative. Editing its source updates linked placements.
        </p>
      )}
      {placements.slice(offset, offset + 20).map((placement, pageIndex) => {
        const card = definitions.get(placement.cardId),
          index = offset + pageIndex;
        let resolved: ReturnType<typeof resolvePlanningCard> | null = null,
          diagnostic = "";
        try {
          if (!card) throw Error("Card definition is unavailable.");
          resolved = resolvePlanningCard(op, config, card);
        } catch (e) {
          diagnostic = e instanceof Error ? e.message : String(e);
        }
        let available = resolved?.values ?? [];
        if (card?.mode === "linked")
          try {
            available = resolveCardSource(op, config, card.source).values;
          } catch {
            /* visible diagnostic above */
          }
        return (
          <article
            className={`planning-card ${placement.layout}`}
            key={placement.id}
            data-card-id={placement.cardId}
          >
            <header>
              <h4>{card?.title ?? "Missing card"}</h4>
              <small>
                {card?.mode === "independent"
                  ? "Independent copy"
                  : "Linked to source"}
              </small>
            </header>
            {diagnostic ? (
              <p role="alert">{diagnostic}</p>
            ) : (
              <dl>
                {resolved?.values.map((v) => (
                  <div key={v.key}>
                    <dt>{v.label}</dt>
                    <dd>{v.value || "Not entered"}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="button-row">
              {card?.mode === "linked" && (
                <button
                  onClick={() =>
                    session.search.open({
                      area: "operation",
                      operationId: op.id,
                      target: card.source,
                    })
                  }
                >
                  Open source
                </button>
              )}
              {card && (
                <>
                  <button
                    onClick={() => setUsage(usage === card.id ? "" : card.id)}
                  >
                    Used in
                  </button>
                  <button
                    onClick={() =>
                      setInspector(inspector === card.id ? "" : card.id)
                    }
                  >
                    Edit display
                  </button>
                  {card.mode === "linked" && (
                    <button
                      disabled={!!diagnostic}
                      onClick={() => void detach(card, placement.id)}
                    >
                      Make independent copy
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setReplacement(card.id);
                      setPicker(true);
                    }}
                  >
                    Replace source
                  </button>
                </>
              )}
              <button onClick={() => editPlacements((p) => p.splice(index, 1))}>
                Remove placement
              </button>
              <button
                aria-label="Move card up"
                disabled={!index}
                onClick={() =>
                  editPlacements((p) => {
                    [p[index - 1], p[index]] = [p[index], p[index - 1]];
                  })
                }
              >
                ↑
              </button>
              <button
                aria-label="Move card down"
                disabled={index === placements.length - 1}
                onClick={() =>
                  editPlacements((p) => {
                    [p[index + 1], p[index]] = [p[index], p[index + 1]];
                  })
                }
              >
                ↓
              </button>
            </div>
            {card && inspector === card.id && (
              <div className="card-inspector">
                <p>
                  Title and fields affect all{" "}
                  {cardPlacements(op, card.id).length} placements of this card.
                  Layout affects this placement.
                </p>
                <Field
                  label="Card title"
                  value={card.title}
                  onChange={(v) =>
                    updateCard(card.id, (c) => {
                      c.title = v;
                    })
                  }
                />
                <label>
                  Layout
                  <select
                    value={placement.layout}
                    onChange={(e) =>
                      editPlacements((p) => {
                        p[index].layout = e.target.value as
                          "compact" | "detailed";
                      })
                    }
                  >
                    <option value="detailed">Detailed</option>
                    <option value="compact">Compact</option>
                  </select>
                </label>
                <div className="button-row">
                  {available.map((v) => (
                    <label key={v.key}>
                      <input
                        type="checkbox"
                        checked={card.fields.includes(v.key)}
                        disabled={
                          card.fields.length === 1 &&
                          card.fields.includes(v.key)
                        }
                        onChange={(e) =>
                          updateCard(card.id, (c) => {
                            c.fields = e.target.checked
                              ? [...c.fields, v.key]
                              : c.fields.filter((k) => k !== v.key);
                          })
                        }
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
                {card.mode === "independent" &&
                  card.values.map((v, i) => (
                    <Field
                      key={v.key}
                      label={v.label}
                      area
                      plain
                      value={v.value}
                      onChange={(value) =>
                        updateCard(card.id, (c) => {
                          if (c.mode === "independent")
                            c.values[i].value = value;
                        })
                      }
                    />
                  ))}
              </div>
            )}
            {card && usage === card.id && (
              <>
                <h4>Card placements</h4>
                {cardPlacements(op, card.id).map((p) => (
                  <p key={p.id}>
                    {op.attachments.find((a) => a.id === p.productId)?.name ??
                      "Base order"}
                    {p.active ? "" : " · Removed block"}
                  </p>
                ))}
                <PlanningUsage
                  operationId={
                    card.mode === "independent"
                      ? (card.origin.operationId ??
                        session.search.context(op.id)?.cardOrigins?.[card.id] ??
                        op.id)
                      : op.id
                  }
                  target={
                    card.mode === "linked" ? card.source : card.origin.target
                  }
                />
              </>
            )}
          </article>
        );
      })}
      {placements.length > 20 && (
        <div className="button-row">
          <button
            disabled={!offset}
            onClick={() => setOffset((n) => Math.max(0, n - 20))}
          >
            Previous cards
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 20, placements.length)} of{" "}
            {placements.length}
          </span>
          <button
            disabled={offset + 20 >= placements.length}
            onClick={() => setOffset((n) => n + 20)}
          >
            More cards
          </button>
        </div>
      )}
      {picker && (
        <ModalBackdrop>
          <section
            className="modal card-picker"
            aria-label="Choose card source"
          >
            <h2>
              {replacement ? "Replace card source" : "Insert linked card"}
            </h2>
            <p>
              Sources belong to this operation. Choose an authored field or
              planning item.
            </p>
            <Field label="Find card source" value={query} onChange={setQuery} />
            <div className="search-results">
              <div>
                {matches.map((s) => (
                  <button
                    className="search-result"
                    key={targetKey(s.target)}
                    aria-pressed={
                      selected !== null &&
                      targetKey(selected) === targetKey(s.target)
                    }
                    onClick={() => setSelected(s.target)}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
              <aside>
                {preview && (
                  <>
                    <h3>{preview.title}</h3>
                    <p className="search-preview-text">
                      {preview.values
                        .map((v) => `${v.label}: ${v.value}`)
                        .join("\n")
                        .slice(0, 40000)}
                    </p>
                  </>
                )}
              </aside>
            </div>
            <div className="button-row">
              <button className="primary" disabled={!preview} onClick={insert}>
                {replacement ? "Replace source" : "Insert card"}
              </button>
              <button data-dialog-cancel onClick={() => setPicker(false)}>
                Cancel
              </button>
            </div>
          </section>
        </ModalBackdrop>
      )}
    </section>
  );
}
