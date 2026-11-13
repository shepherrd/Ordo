import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ModalBackdrop } from "./ModalBackdrop";
import { useWorkspaceApi, useWorkspaceSession } from "./WorkspaceContext";
import {
  compareSearchHits,
  searchRequestSchema,
  searchTypes,
  type SearchHit,
  type SearchResponse,
} from "../../domain/search";
import { editorError } from "./editor-error";
import { countLabel } from "./ui-text";
import type { SearchTarget } from "../../domain/planning-target";
import "./search.css";
import { PlanningUsage, CatalogPlanningUsage } from "./PlanningUsage";
import type { Operation, ResolvedConfig } from "../../domain/model";

export function SearchDialog({
  operationId,
  onClose,
  onOpen,
}: {
  operationId: string | null;
  onClose: () => void;
  onOpen: (target: SearchTarget, title: string) => void;
}) {
  const api = useWorkspaceApi(),
    session = useWorkspaceSession(),
    registry = session.search;
  const generation = useSyncExternalStore(
    registry.subscribe,
    registry.getRevision,
  );
  const [query, setQuery] = useState(""),
    [scope, setScope] = useState(
      operationId ? (registry.scope ?? "operation") : "workspace",
    );
  const [usage, setUsage] = useState(false),
    [savedContext, setSavedContext] = useState<{
      operation: Operation | null;
      config: ResolvedConfig;
    } | null>(null);
  const [type, setType] = useState(""),
    [phase, setPhase] = useState(""),
    [staff, setStaff] = useState(""),
    [offset, setOffset] = useState(0);
  const [result, setResult] = useState<SearchResponse | null>(null),
    [selected, setSelected] = useState<SearchHit | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [operationFilter, setOperationFilter] = useState(""),
    [operations, setOperations] = useState<{ id: string; name: string }[]>([]);
  const sequence = useRef(0),
    mounted = useRef(true);
  const dispatched = useRef(0);
  useEffect(() => {
    if (!result || !dispatched.current) return;
    const start = dispatched.current;
    const handle = requestAnimationFrame(() => {
      performance.clearMeasures("ordo-search-render");
      performance.measure("ordo-search-render", {
        start,
        end: performance.now(),
      });
    });
    return () => cancelAnimationFrame(handle);
  }, [result]);
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      let offset = 0,
        more = true;
      const items: { id: string; name: string }[] = [];
      while (more && mounted.current) {
        const r = await api.workspace({
          type: "browse-operations",
          query: {
            search: "",
            status: "",
            echelon: "",
            sort: "name",
            offset,
            limit: 100,
          },
        });
        items.push(...(r.operations?.items ?? []));
        more = items.length < (r.operations?.total ?? 0);
        offset += 100;
      }
      if (mounted.current) setOperations(items);
    })().catch((e) => setError(editorError(e)));
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  const selectedOperation =
    scope === "operation" ? operationId : operationFilter || null;
  useEffect(() => {
    setSavedContext(null);
    if (!selectedOperation || registry.context(selectedOperation)) return;
    let alive = true;
    void api
      .execute({ type: "load", operationId: selectedOperation })
      .then((s) => {
        if (alive) setSavedContext(s);
      })
      .catch((e) => {
        if (alive) setError(editorError(e));
      });
    return () => {
      alive = false;
    };
  }, [selectedOperation]);
  const context = selectedOperation
    ? (registry.context(selectedOperation) ?? savedContext)
    : null;
  const phases = context?.operation?.phases ?? [],
    staffOptions = context?.config.doctrine.staff ?? [];
  useEffect(() => {
    const seq = ++sequence.current;
    setResult(null);
    setSelected(null);
    setUsage(false);
    setError("");
    if (!query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        dispatched.current = performance.now();
        const request = searchRequestSchema.parse({
          query,
          operationId: selectedOperation,
          type: type || null,
          phaseId: phase || null,
          staffId: staff || null,
          sequence: seq,
          excludedOwners: registry.owners(),
        });
        const working = registry.query(request);
        // Both streams are ranked before slicing. Fetch only enough saved pages to
        // determine this page; excluded owners cannot leak back in later pages.
        let saved: SearchHit[] = [],
          response: SearchResponse;
        do {
          response = await api.search({ ...request, offset: saved.length });
          saved = [...saved, ...response.hits];
        } while (
          response.more &&
          saved.length < offset + 50 &&
          sequence.current === seq
        );
        if (
          !mounted.current ||
          sequence.current !== seq ||
          generation !== registry.getRevision()
        )
          return;
        const all = [...working, ...saved].sort(compareSearchHits);
        const hits = all.slice(offset, offset + 50);
        setResult({
          ...response,
          hits,
          more: all.length > offset + 50 || response.more,
        });
        setSelected(hits[0] ?? null);
      })()
        .catch((e) => {
          if (sequence.current === seq) setError(editorError(e));
        })
        .finally(() => {
          if (sequence.current === seq) setLoading(false);
        });
    }, 160);
    return () => clearTimeout(timer);
  }, [query, selectedOperation, type, phase, staff, offset, generation]);
  const reset = () => setOffset(0);
  const open = async () => {
    if (!selected || !result) return;
    try {
      if (session.snapshot().dirty.some((e) => e.unappliedSymbolField))
        throw Error(
          "Apply or discard the highlighted symbol field edits before opening a search result.",
        );
      const fresh =
        registry.resolve(selected) ??
        (registry.owners().includes(selected.owner)
          ? null
          : await api.resolveSearch({
              target: selected.target,
              sourceToken: selected.sourceToken,
              workspaceGeneration: result.workspaceGeneration,
            }));
      if (!fresh)
        throw Error(
          "This source was removed from the working draft. Search again.",
        );
      if (!mounted.current) return;
      onOpen(fresh.target, fresh.title);
      onClose();
    } catch (e) {
      setError(editorError(e));
    }
  };
  return (
    <ModalBackdrop>
      <section className="modal search-dialog" aria-label="Search Ordo">
        <header className="panel-heading">
          <h2>Search</h2>
          <button data-dialog-cancel onClick={onClose}>
            Close
          </button>
        </header>
        <label>
          Find in Ordo
          <input
            data-dialog-initial
            aria-label="Find in Ordo"
            maxLength={256}
            value={query}
            placeholder="Names, tasks, orders, staff, and saved items"
            onChange={(e) => {
              setQuery(e.target.value);
              reset();
            }}
          />
        </label>
        <div className="search-filters">
          <label>
            Scope
            <select
              value={scope}
              onChange={(e) => {
                const value = e.target.value as "operation" | "workspace";
                setScope(value);
                registry.scope = value;
                setPhase("");
                setStaff("");
                reset();
              }}
            >
              <option value="workspace">Workspace</option>
              {operationId && <option value="operation">This operation</option>}
            </select>
          </label>
          {scope === "workspace" && (
            <label>
              Operation
              <select
                value={operationFilter}
                onChange={(e) => {
                  setOperationFilter(e.target.value);
                  setPhase("");
                  setStaff("");
                  reset();
                }}
              >
                <option value="">All operations and catalogs</option>
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Content
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                reset();
              }}
            >
              <option value="">All content</option>
              {searchTypes.map((t) => (
                <option key={t} value={t}>
                  {t[0].toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </label>
          {!!phases.length && (
            <label>
              Phase
              <select
                value={phase}
                onChange={(e) => {
                  setPhase(e.target.value);
                  reset();
                }}
              >
                <option value="">All phases</option>
                {phases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!!staffOptions.length && (
            <label>
              Staff
              <select
                value={staff}
                onChange={(e) => {
                  setStaff(e.target.value);
                  reset();
                }}
              >
                <option value="">All staff</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p role="status">
          {loading
            ? "Searching…"
            : !query.trim()
              ? "Enter text to search. Open editors use their working content."
              : result
                ? `${countLabel(result.hits.length, "result")} on this page`
                : ""}
          {result &&
            !result.complete &&
            " · Workspace indexing is incomplete; open editors remain searchable."}
          {result?.indexError && ` · ${result.indexError}`}
        </p>
        <div className="search-results">
          <div aria-label="Search results">
            {result?.hits.map((hit) => (
              <button
                key={hit.id}
                className={`search-result ${selected?.id === hit.id ? "active" : ""}`}
                aria-pressed={selected?.id === hit.id}
                onClick={() => {
                  setSelected(hit);
                  setUsage(false);
                }}
              >
                <strong>{hit.title}</strong>
                <small>
                  {hit.type} · {hit.ownerName} · {hit.state}
                </small>
                <span>{hit.excerpt}</span>
              </button>
            ))}
            {result && !result.hits.length && <p>No matching content.</p>}
          </div>
          <aside aria-label="Search preview">
            {selected && (
              <>
                <small>
                  {selected.state} content · {selected.type}
                </small>
                <h3>{selected.title}</h3>
                <p className="search-preview-text">
                  {selected.text.slice(0, 40000)}
                </p>
                {selected.text.length > 40000 && (
                  <p>Open the source to read the rest.</p>
                )}
                <button className="primary" onClick={() => void open()}>
                  Open source
                </button>
                {selected.target.area !== "file" && (
                  <button onClick={() => setUsage((v) => !v)}>Used in</button>
                )}
                {usage && selected.target.area === "operation" && (
                  <PlanningUsage
                    key={selected.id}
                    operationId={selected.target.operationId}
                    target={selected.target.target}
                    onOpen={onClose}
                  />
                )}
                {usage && selected.target.area === "catalog" && (
                  <CatalogPlanningUsage
                    key={selected.id}
                    target={selected.target}
                    onOpen={(target) => {
                      onOpen(target, "");
                      onClose();
                    }}
                  />
                )}
              </>
            )}
          </aside>
        </div>
        <footer className="toolbar">
          <button
            disabled={!offset || loading}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            Previous results
          </button>
          <button
            disabled={!result?.more || loading || offset >= 49950}
            onClick={() => setOffset((n) => n + 50)}
          >
            More results
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}
