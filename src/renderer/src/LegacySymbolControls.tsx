import {
  useWorkspaceApi,
  useEditorProtection,
  useUnappliedSymbolEdits,
} from "./WorkspaceContext";
import { useEffect, useState } from "react";
import type { MilitarySymbolDefinition } from "../../domain/symbology";
import {
  editLegacySegment,
  legacySegments,
  type LegacySegment,
} from "../../domain/symbol-codes";
import { Field } from "./Fields";
import { legacyEchelonChoices } from "./symbol-size-choices";
import type { CrosswalkPreview } from "../../application/legacy-crosswalk";
type Choice = { id: string; name: string; note?: string };
function LegacyField({
  label,
  value,
  apply,
}: {
  label: string;
  value: string;
  apply: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEditorProtection({
    name: `Unapplied symbol field — ${label}`,
    dirty: draft !== value,
    busy: false,
    unappliedSymbolField: true,
  });
  useEffect(() => setDraft(value), [value]);
  return (
    <div data-unapplied-symbol-field={draft !== value}>
      <Field label={label} value={draft} onChange={setDraft} />
      <button
        type="button"
        disabled={draft === value}
        onClick={() => apply(draft)}
      >
        Apply {label}
      </button>
      {draft !== value && (
        <button onClick={() => setDraft(value)}>Discard {label} edit</button>
      )}
      {draft !== value && <small>Unapplied field edit</small>}
    </div>
  );
}
export function LegacySymbolControls({
  value,
  onChange,
  active,
}: {
  value: MilitarySymbolDefinition;
  onChange: (d: MilitarySymbolDefinition) => void;
  active: boolean;
}) {
  const desktop = useWorkspaceApi();
  const unapplied = useUnappliedSymbolEdits();
  const [crosswalk, setCrosswalk] = useState<CrosswalkPreview | null>(null);
  const [groups, setGroups] = useState<Choice[]>([]),
    [group, setGroup] = useState("GRDTRK_UNT"),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [choices, setChoices] = useState<Choice[]>([]),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    void desktop
      .symbolCatalog({ type: "legacy-sets" })
      .then((r) => {
        if (!stopped) setGroups(r.choices!);
      })
      .catch((e) => {
        if (!stopped) setError(String(e));
      });
    return () => {
      stopped = true;
    };
  }, [active]);
  useEffect(() => {
    if (!active || !open) return;
    let stopped = false;
    void desktop
      .symbolCatalog({
        type: "legacy-metadata",
        set: group,
        search,
        offset,
        limit: 30,
      })
      .then((r) => {
        if (!stopped) {
          setChoices(r.choices!);
          setTotal(r.total!);
        }
      })
      .catch((e) => {
        if (!stopped) setError(String(e));
      });
    return () => {
      stopped = true;
    };
  }, [group, search, offset, active, open]);
  const segments = legacySegments(value.code);
  const inspect = async () => {
    try {
      const r = await desktop.symbolCatalog({
        type: "legacy-crosswalk",
        code: value.code,
      });
      setCrosswalk(r.crosswalk!);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const edit = (key: LegacySegment, text: string) => {
    try {
      onChange({
        ...value,
        code: editLegacySegment(value.code, key, text),
        origin: { kind: "MANUAL" },
      });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const apply = async (
    entryId: string,
    action: "APPLY_COMPONENT" | "OPEN_EXAMPLE",
  ) => {
    try {
      const r = await desktop.symbolCatalog({
        type: "legacy-apply",
        entryId,
        action,
        definition: value,
      });
      onChange(r.definition!);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section aria-label="Legacy symbol controls">
      <p className="muted">
        Legacy fields preserve the full code length, including country and
        order-of-battle suffixes. Apply each field edit to update the symbol.
      </p>
      {error && <p role="alert">{error}</p>}
      {segments ? (
        <div className="field-grid">
          {segments.scheme === "S" &&
            segments.dimension === "G" &&
            segments.function.startsWith("U") &&
            !["M", "N"].includes(segments.modifier[0]) && (
              <label className="field">
                <span>Unit echelon</span>
                <select
                  aria-label="Unit echelon"
                  disabled={unapplied}
                  value={segments.modifier[1]}
                  onChange={(e) =>
                    edit("modifier", segments.modifier[0] + e.target.value)
                  }
                >
                  {!legacyEchelonChoices.some(
                    (c) => c.id === segments.modifier[1],
                  ) && (
                    <option value={segments.modifier[1]}>
                      Existing mark ({segments.modifier[1]})
                    </option>
                  )}
                  {legacyEchelonChoices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          {(
            [
              "identity",
              "status",
              "function",
              "modifier",
              "country",
              "orderOfBattle",
            ] as LegacySegment[]
          ).map(
            (key) =>
              segments[key] !== null && (
                <LegacyField
                  key={key}
                  label={`Legacy ${key}`}
                  value={segments[key]!}
                  apply={(text) => edit(key, text)}
                />
              ),
          )}
        </div>
      ) : (
        <p>The current text has an unsupported legacy form.</p>
      )}
      <button type="button" onClick={() => void inspect()}>
        Inspect numeric crosswalk
      </button>
      {crosswalk && (
        <section aria-label="Crosswalk inspection">
          <p>
            {crosswalk.status} · source {crosswalk.sourceCode}
          </p>
          {crosswalk.sourceCode !== value.code.sidc && (
            <p role="status">
              The symbol changed; inspect again for the current code.
            </p>
          )}
          <p>Numeric candidate: {crosswalk.candidateCode ?? "Unavailable"}</p>
          {crosswalk.diagnostics.map((d) => (
            <p key={d}>{d}</p>
          ))}
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Source</th>
                <th>Candidate</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {crosswalk.fields.map((f) => (
                <tr key={f.field}>
                  <td>{f.field}</td>
                  <td>{f.source}</td>
                  <td>{f.target ?? "—"}</td>
                  <td>{f.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small>
            {crosswalk.release} · {crosswalk.sourceKey} ·{" "}
            {crosswalk.sourceRowHash}
          </small>
        </section>
      )}
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Legacy function catalog</summary>
        <label className="field">
          <span>Legacy group</span>
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setOffset(0);
            }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Search legacy functions"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setOffset(0);
          }}
        />
        {choices.map((c) => (
          <div className="catalog-row" key={c.id}>
            <strong>{c.name}</strong>
            <p>{c.note}</p>
            <div className="button-row">
              <button
                disabled={unapplied}
                onClick={() => void apply(c.id, "APPLY_COMPONENT")}
              >
                Apply legacy function
              </button>
              <button
                disabled={unapplied}
                onClick={() => void apply(c.id, "OPEN_EXAMPLE")}
              >
                Open legacy example
              </button>
            </div>
          </div>
        ))}
        <div className="button-row">
          <button disabled={!offset} onClick={() => setOffset((n) => n - 30)}>
            Previous legacy entries
          </button>
          <span>{total} entries</span>
          <button
            disabled={offset + 30 >= total}
            onClick={() => setOffset((n) => n + 30)}
          >
            Next legacy entries
          </button>
        </div>
      </details>
    </section>
  );
}
