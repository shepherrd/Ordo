import { useCallback, useEffect, useState } from "react";
import { useSearchOpen } from "./SearchProvider";
import { useWorkspaceApi } from "./WorkspaceContext";
import type { SymbolLibrarySummary } from "../../application/symbology-ports";
import MilitarySymbolsWorkspace from "./MilitarySymbolsWorkspace";
import OrbatWorkspace from "./OrbatWorkspace";
import { SavedSymbolThumbnail } from "./SymbolThumbnail";
import { beginSymbolDrag } from "./symbol-transfer";
import { editorError } from "./editor-error";
import { Field } from "./Fields";
import { countLabel } from "./ui-text";
import "./symbology.css";
import "./workbench.css";

type Mode = "SYMBOL" | "ORBAT";
type OpenRequest = { kind: Mode; id: string; nonce: number };

/** Shared presentation workspace; each editor retains its own draft and history. */
export default function SymbolsAndOrbatsWorkspace({
  active,
  requestedMode,
}: {
  active: boolean;
  requestedMode: Mode;
}) {
  const desktop = useWorkspaceApi();
  const [mode, setMode] = useState<Mode>(requestedMode);
  useSearchOpen("catalog", (target) => {
    if (
      target.area === "catalog" &&
      (target.catalogKind === "SYMBOL" || target.catalogKind === "ORBAT")
    )
      setMode(target.catalogKind);
  });
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [request, setRequest] = useState<OpenRequest | null>(null);
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);
  const [generation, setGeneration] = useState(0);
  const changed = useCallback(() => setGeneration((n) => n + 1), []);
  const [symbolBlocked, setSymbolBlocked] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<SymbolLibrarySummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const open = useCallback((kind: Mode, id: string) => {
    setMode(kind);
    setRequest((previous) => ({ kind, id, nonce: (previous?.nonce ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (active) setMode(requestedMode);
  }, [requestedMode]);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void desktop
      .symbols({
        type: "browse",
        kind: "SYMBOL",
        query: { search, status: "", offset, limit: 30 },
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.page!.items);
        setTotal(result.page!.total);
        if (offset && !result.page!.items.length)
          setOffset(Math.max(0, offset - 30));
      })
      .catch((e) => {
        if (!cancelled) setError(editorError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop, active, search, offset, generation]);
  return (
    <section
      className="symbol-workbench"
      aria-label="Symbols and ORBATs workspace"
    >
      <aside className="workbench-rail" aria-label="Saved military symbols">
        <div
          className="workbench-current"
          ref={setPreviewHost}
          aria-label="Current symbol preview"
        />
        <section className="workbench-saved">
          <h2>Saved military symbols</h2>
          <Field
            label="Search saved symbols"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
          />
          {error && <p role="alert">{error}</p>}
          {symbolBlocked && (
            <p className="muted">
              Save or discard symbol edits before choosing another saved symbol.
            </p>
          )}
          <div
            className="workbench-symbol-list"
            aria-label="Saved symbols list"
            role="region"
            tabIndex={0}
            aria-busy={loading}
          >
            {rows.map((row) => (
              <button
                key={row.versionId}
                className="workbench-symbol-card"
                data-symbol-id={row.versionId}
                disabled={symbolBlocked || loading}
                draggable={!symbolBlocked && !loading}
                onDragStart={(event) => {
                  beginSymbolDrag(
                    event.dataTransfer,
                    JSON.stringify({ kind: "CATALOG", id: row.versionId }),
                  );
                }}
                onClick={() => open("SYMBOL", row.versionId)}
              >
                <SavedSymbolThumbnail
                  id={row.versionId}
                  contentVersion={row.contentVersion}
                  active={active}
                  iconOnly
                />
                <strong>{row.name}</strong>
              </button>
            ))}
            {!loading && !rows.length && (
              <p className="muted">
                {search
                  ? "No symbols match this search."
                  : "Create or import symbols to keep them here."}
              </p>
            )}
          </div>
          {total > 30 && (
            <div className="button-row">
              <button
                disabled={!offset || loading}
                onClick={() => setOffset((n) => Math.max(0, n - 30))}
              >
                Previous symbols
              </button>
              <button
                disabled={offset + 30 >= total || loading}
                onClick={() => setOffset((n) => n + 30)}
              >
                Next symbols
              </button>
            </div>
          )}
          <small>{countLabel(total, "saved symbol")}</small>
        </section>
      </aside>
      <div className="workbench-main">
        <div className="workbench-tabs">
          <button
            onClick={() => setDictionaryOpen(true)}
            aria-haspopup="dialog"
          >
            FM Dictionary
          </button>
          <div
            className="workbench-editor-tabs"
            role="tablist"
            aria-label="Symbol workspace view"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "SYMBOL"
                  : event.key === "End"
                    ? "ORBAT"
                    : mode === "SYMBOL"
                      ? "ORBAT"
                      : "SYMBOL";
              setMode(next);
              event.currentTarget
                .querySelector<HTMLButtonElement>(
                  next === "SYMBOL"
                    ? "#symbol-workbench-tab"
                    : "#orbat-workbench-tab",
                )
                ?.focus();
            }}
          >
            <button
              role="tab"
              id="symbol-workbench-tab"
              aria-selected={mode === "SYMBOL"}
              tabIndex={mode === "SYMBOL" ? 0 : -1}
              aria-controls="symbol-workbench-panel"
              onClick={() => setMode("SYMBOL")}
            >
              Symbol editor
            </button>
            <button
              role="tab"
              id="orbat-workbench-tab"
              aria-selected={mode === "ORBAT"}
              tabIndex={mode === "ORBAT" ? 0 : -1}
              aria-controls="orbat-workbench-panel"
              onClick={() => setMode("ORBAT")}
            >
              ORBAT maps
            </button>
          </div>
        </div>
        <div
          role="tabpanel"
          id="symbol-workbench-panel"
          aria-labelledby="symbol-workbench-tab"
          hidden={mode !== "SYMBOL"}
        >
          <MilitarySymbolsWorkspace
            dictionaryOpen={active && dictionaryOpen}
            onCloseDictionary={() => setDictionaryOpen(false)}
            onDictionaryApplied={() => setMode("SYMBOL")}
            active={active && mode === "SYMBOL"}
            previewHost={previewHost}
            openRequest={request?.kind === "SYMBOL" ? request : undefined}
            onOpenImported={open}
            onLibraryChange={changed}
            onBlockedChange={setSymbolBlocked}
          />
        </div>
        <div
          role="tabpanel"
          id="orbat-workbench-panel"
          aria-labelledby="orbat-workbench-tab"
          hidden={mode !== "ORBAT"}
        >
          <OrbatWorkspace
            active={active && mode === "ORBAT"}
            previewHost={previewHost}
            openRequest={request?.kind === "ORBAT" ? request : undefined}
            onOpenImported={open}
            onLibraryChange={changed}
          />
        </div>
      </div>
    </section>
  );
}
