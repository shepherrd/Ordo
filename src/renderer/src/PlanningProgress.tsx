import { useEffect, useMemo, useState } from "react";
import type { Operation, ResolvedConfig } from "../../domain/model";
import {
  planningProducts,
  setProductProgress,
  type ProductProgress,
} from "../../domain/planning-progress";
import { Field, Panel, Select } from "./Fields";
import "./planning-schedule.css";

export function PlanningProgress({
  op,
  config,
  change,
  onOpen,
}: {
  op: Operation;
  config: ResolvedConfig;
  change: (fn: (op: Operation) => void) => void;
  onOpen: (product: ProductProgress) => void;
}) {
  const [now, setNow] = useState(Date.now),
    [staff, setStaff] = useState<string | null>(null),
    [status, setStatus] = useState("All"),
    [all, setAll] = useState(false),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const rows = useMemo(
    () => planningProducts(op, config, now),
    [op, config, now],
  );
  const included = rows.filter((r) => r.included),
    ready = included.filter((r) => r.state === "Ready").length;
  const filtered = rows
    .filter(
      (r) =>
        (all || r.included) &&
        (!staff || r.staff === staff) &&
        (status === "All" ||
          (status === "Overdue" ? r.overdue : r.state === status)) &&
        r.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        a.staff.localeCompare(b.staff) ||
        Number(b.overdue) - Number(a.overdue) ||
        (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
        a.name.localeCompare(b.name),
    );
  const current = Math.min(
      page,
      Math.max(0, Math.ceil(filtered.length / 40) - 1),
    ),
    visible = filtered.slice(current * 40, (current + 1) * 40);
  const groups = new Map<string, ProductProgress[]>();
  for (const row of visible)
    groups.set(row.staff, [...(groups.get(row.staff) ?? []), row]);
  return (
    <Panel
      title="Planning progress"
      subtitle="Track writing and due dates. Ready is set by the drafter; approval and publication remain separate."
    >
      <div className="planning-progress-summary">
        <strong>
          {ready} of {included.length} included products ready
        </strong>
        <progress
          aria-label="Included products ready"
          value={ready}
          max={included.length || 1}
        />
        <span>{included.filter((r) => r.overdue).length} overdue</span>
      </div>
      <div className="planning-toolbar">
        <Field
          label="Find products"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(0);
          }}
        />
        <Select
          label="Responsible staff"
          value={staff}
          empty="All staff"
          options={[...new Set(rows.map((r) => r.staff))]
            .sort()
            .map((name) => ({ id: name, name }))}
          onChange={(v) => {
            setStaff(v);
            setPage(0);
          }}
        />
        <label className="field">
          <span>Writing state</span>
          <select
            aria-label="Writing state"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            {["All", "Not started", "In progress", "Ready", "Overdue"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </label>
        <label className="planning-check">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => {
              setAll(e.target.checked);
              setPage(0);
            }}
          />
          Show omitted and undecided products
        </label>
      </div>
      <p className="planning-caption">
        Only authored products appear here. Changes to a product’s writing or
        linked information reopen that product. Ordinary prose is not a tracked
        link.
      </p>
      {!filtered.length && (
        <p className="planning-empty">No products match these filters.</p>
      )}
      {[...groups].map(([name, products]) => (
        <details className="planning-staff-group" key={name} open>
          <summary>
            {name}
            <span>
              {products.length} {products.length === 1 ? "product" : "products"}
            </span>
          </summary>
          {products.map((p) => (
            <article
              key={p.id}
              className="planning-product"
              data-progress-product={p.id}
            >
              <div className="planning-product-title">
                <h3>{p.name}</h3>
                <span
                  className={`planning-state ${p.state === "Ready" ? "ready" : ""}`}
                >
                  {p.state}
                </span>
                {!p.included && <small>Not included</small>}
                {p.reopenedReason && (
                  <small>Reopened: {p.reopenedReason.toLowerCase()}.</small>
                )}
                {p.warning && (
                  <small className="planning-issue">{p.warning}</small>
                )}
              </div>
              <div className="planning-product-due">
                <Field
                  label={`Due date (UTC) — ${p.name}`}
                  type="datetime-local"
                  value={p.dueAt?.slice(0, 16) ?? ""}
                  onChange={(v) => {
                    const date = v ? new Date(v + "Z") : null;
                    if (!date || Number.isFinite(date.getTime()))
                      change((d) =>
                        setProductProgress(d, p.id, {
                          dueAt: date?.toISOString() ?? null,
                        }),
                      );
                  }}
                />
                {p.overdue && (
                  <strong className="planning-issue">Overdue</strong>
                )}
              </div>
              <div className="planning-product-actions">
                <label className="planning-check">
                  <input
                    type="checkbox"
                    aria-label={`Ready — ${p.name}`}
                    checked={p.state === "Ready"}
                    onChange={(e) =>
                      change((d) =>
                        setProductProgress(d, p.id, {
                          readyAt: e.target.checked
                            ? new Date().toISOString()
                            : null,
                        }),
                      )
                    }
                  />
                  Ready
                </label>
                <button onClick={() => onOpen(p)}>Open writing</button>
              </div>
            </article>
          ))}
        </details>
      ))}
      {filtered.length > 40 && (
        <div className="planning-pagination">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous products
          </button>
          <span>
            {current * 40 + 1}–{Math.min((current + 1) * 40, filtered.length)}{" "}
            of {filtered.length}
          </span>
          <button
            disabled={(current + 1) * 40 >= filtered.length}
            onClick={() => setPage(current + 1)}
          >
            More products
          </button>
        </div>
      )}
    </Panel>
  );
}
