import { useEffect, useState } from "react";
import type {
  BuiltinSymbolEntry,
  SymbolCatalogResult,
} from "../../application/symbol-catalog";
import { useWorkspaceApi } from "./WorkspaceContext";
import { Panel, Field } from "./Fields";
import { SymbolThumbnail } from "./SymbolThumbnail";
import { GraphicPreview } from "./GraphicPreview";

// Display wording only; retained catalog identities and source data stay exact.
const iconLabels: Record<string, string> = {
  "Main function": "Main icon",
  "Sector 1": "First icon modifier",
  "Sector 2": "Second icon modifier",
};

export function BuiltinSymbolCatalog({
  active,
  disabled,
  onCreate,
  expanded = false,
}: {
  active: boolean;
  disabled: boolean;
  onCreate: (entry: BuiltinSymbolEntry) => Promise<void>;
  expanded?: boolean;
}) {
  const desktop = useWorkspaceApi();
  const [open, setOpen] = useState(expanded),
    [collection, setCollection] = useState<"NUMERIC" | "LEGACY" | "FM">(
      "NUMERIC",
    ),
    [group, setGroup] = useState(""),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [result, setResult] = useState<SymbolCatalogResult["builtin"]>(),
    [loadedKey, setLoadedKey] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<BuiltinSymbolEntry | null>(null),
    [rendered, setRendered] = useState(false),
    [creating, setCreating] = useState(false);
  const key = JSON.stringify({ collection, group, search, offset });
  useEffect(() => {
    if (!active || !open) return;
    let stopped = false;
    setError("");
    const timer = setTimeout(() => {
      void desktop
        .symbolCatalog({
          type: "builtin-browse",
          collection,
          group,
          search,
          offset,
          limit: 24,
        })
        .then((r) => {
          if (!stopped) {
            setResult(r.builtin);
            setLoadedKey(key);
          }
        })
        .catch((e) => {
          if (!stopped) {
            setError(String(e));
            setLoadedKey(key);
            setResult(undefined);
          }
        });
    }, 120);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [key, open, active]);
  const change = () => {
    setOffset(0);
    setSelected(null);
    setRendered(false);
  };
  const loading = loadedKey !== key;
  const sameCollection =
    loadedKey && JSON.parse(loadedKey).collection === collection;
  return (
    <Panel
      title="Built-in catalog"
      subtitle="Browse symbol sets, legacy symbols and the FM reference dictionary. Create a saved copy only when you need one."
      action={
        !expanded && (
          <button
            aria-expanded={open}
            aria-controls="builtin-symbol-browser"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close built-in catalog" : "Browse built-in catalog"}
          </button>
        )
      }
    >
      {open && (
        <section
          id="builtin-symbol-browser"
          aria-label="Built-in symbol catalog"
        >
          <div className="field-grid">
            <label className="field">
              <span>Catalog collection</span>
              <select
                aria-label="Catalog collection"
                value={collection}
                onChange={(e) => {
                  setCollection(e.target.value as typeof collection);
                  setGroup("");
                  change();
                }}
              >
                <option value="NUMERIC">Numeric symbols and modifiers</option>
                <option value="LEGACY">Legacy symbols (8 groups)</option>
                <option value="FM">FM reference dictionary</option>
              </select>
            </label>
            <label className="field">
              <span>Catalog group</span>
              <select
                aria-label="Catalog group"
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  change();
                }}
              >
                <option value="">All groups</option>
                {sameCollection &&
                  result?.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
            <Field
              label="Search built-in symbols"
              value={search}
              onChange={(value) => {
                setSearch(value.slice(0, 200));
                change();
              }}
            />
          </div>
          <p className="muted">
            {collection === "LEGACY"
              ? "Uses the original letter codes directly. Unsupported conversion to another standard does not remove the original symbol."
              : collection === "FM"
                ? "Doctrinal reference entries retain their source notes, unavailable mappings and discrepancies. These are distinct from the renderer catalog."
                : "Includes main icons, first and second icon modifiers, and common modifiers. Modifiers are shown as component examples."}
          </p>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <div className="builtin-catalog-layout">
            <div>
              <p role="status">
                {loading
                  ? "Loading catalog…"
                  : `${result?.total ?? 0} matching entries · ${result?.catalogTotal ?? 0} in this collection`}
              </p>
              <div className="builtin-catalog-results" aria-busy={loading}>
                {!loading &&
                  result?.entries.map((entry) => (
                    <button
                      key={entry.id}
                      className="builtin-symbol-card"
                      aria-pressed={selected?.id === entry.id}
                      onClick={() => {
                        setSelected(entry);
                        setRendered(false);
                      }}
                    >
                      {entry.definition && (
                        <SymbolThumbnail
                          definition={entry.definition}
                          active={active && open}
                        />
                      )}
                      <strong>{entry.name}</strong>
                      <span>
                        {entry.group} · {iconLabels[entry.kind] ?? entry.kind}
                      </span>
                      <code>{entry.code ?? "No verified symbol mapping"}</code>
                      {!["CATALOG", "MAPPED"].includes(entry.availability) && (
                        <span className="catalog-availability">
                          {entry.availability}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
              {!loading && result?.total === 0 && (
                <p>
                  No entries match. Clear the search or choose another group.
                </p>
              )}
              <div className="button-row">
                <button
                  disabled={loading || !offset}
                  onClick={() => {
                    setOffset((v) => Math.max(0, v - 24));
                    setSelected(null);
                  }}
                >
                  Previous catalog page
                </button>
                <span>
                  {!loading && result?.total
                    ? `${offset + 1}–${Math.min(offset + 24, result.total)}`
                    : "—"}
                </span>
                <button
                  disabled={loading || !result || offset + 24 >= result.total}
                  onClick={() => {
                    setOffset((v) => v + 24);
                    setSelected(null);
                  }}
                >
                  Next catalog page
                </button>
              </div>
            </div>
            <section
              className="builtin-symbol-detail"
              aria-label="Selected catalog symbol"
            >
              {selected ? (
                <>
                  <h3>{selected.name}</h3>
                  <p>
                    {iconLabels[selected.kind] ?? selected.kind} ·{" "}
                    {selected.availability}
                  </p>
                  {selected.definition ? (
                    <GraphicPreview
                      key={selected.id}
                      active={active && open}
                      request={{
                        kind: "SYMBOL",
                        input: {
                          definition: selected.definition,
                          size: 70,
                          context: "SYMBOL",
                          labelSide: "RIGHT",
                        },
                      }}
                      onResult={(value) => setRendered(!!value)}
                    />
                  ) : (
                    <p>
                      No verified symbol mapping is available for this entry.
                      Its original reference and notes remain below.
                    </p>
                  )}
                  <button
                    className="primary"
                    disabled={
                      disabled || creating || !selected.definition || !rendered
                    }
                    onClick={() => {
                      setCreating(true);
                      setError("");
                      void onCreate(selected)
                        .then(() => setOpen(false))
                        .catch((e) => setError(String(e)))
                        .finally(() => setCreating(false));
                    }}
                  >
                    {creating
                      ? "Creating copy…"
                      : "Create editable symbol copy"}
                  </button>
                  {disabled && (
                    <p>
                      Save or discard your current symbol edits and finish
                      pending work before creating another copy.
                    </p>
                  )}
                  <p className="muted">
                    Creates an editable copy using the classic label placement.
                  </p>
                  {selected.notes.map((note, i) => (
                    <p key={i}>
                      {note ===
                      "Component example; configure its main function and other fields in the builder."
                        ? "Component example; configure its main icon and other fields in the builder."
                        : note}
                    </p>
                  ))}
                  <details>
                    <summary>Source and exact code</summary>
                    <p>{selected.source}</p>
                    <code>
                      {selected.definition?.code.sidc ?? "Unavailable"}
                    </code>
                    <p>Entry: {selected.id}</p>
                    {selected.definition?.origin.kind === "CATALOG" && (
                      <p>
                        Catalog: {selected.definition.origin.catalogId} ·{" "}
                        {selected.definition.origin.release}
                        <br />
                        SHA-256 {selected.definition.origin.catalogHash}
                      </p>
                    )}
                  </details>
                </>
              ) : (
                <p>
                  Select a symbol to preview it and see its source. Browsing
                  does not add items to Saved Symbols.
                </p>
              )}
            </section>
          </div>
        </section>
      )}
    </Panel>
  );
}
