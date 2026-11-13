import { editorError } from "./editor-error";
import { countLabel } from "./ui-text";
import { useWorkspaceApi } from "./WorkspaceContext";
import { useEffect, useState, useRef } from "react";
import type {
  MilitarySymbolDefinition,
  SymbolSnapshot,
} from "../../domain/symbology";
import { SymbolThumbnail } from "./SymbolThumbnail";
import { beginSymbolDrag } from "./symbol-transfer";

export function SymbolTray({
  active,
  disabled,
  onUse,
  onLoad,
  context,
  refresh = 0,
}: {
  active: boolean;
  disabled: boolean;
  onUse: (snapshot: SymbolSnapshot) => void;
  onLoad?: (snapshot: SymbolSnapshot) => void;
  context: string;
  refresh?: number;
}) {
  const desktop = useWorkspaceApi();
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [context, disabled, active]);
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  const [items, setItems] = useState<
    { id: string; name: string; definition: MilitarySymbolDefinition }[]
  >([]);
  const usePin = async (id: string, apply: (s: SymbolSnapshot) => void) => {
    const expected = generation.current;
    try {
      const {
        definition,
        definitionHash: _hash,
        ...source
      } = (await desktop.symbols({ type: "symbol-pin", id })).pin!;
      if (!disabled && active && expected === generation.current)
        apply({ definition, source });
    } catch (e) {
      setError(editorError(e));
    }
  };
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    setItems([]);
    setError("");
    void desktop
      .symbols({
        type: "browse",
        kind: "SYMBOL",
        query: { search: query, status: "", offset, limit: 6 },
      })
      .then(async (r) => {
        const cards = await Promise.all(
          r.page!.items.map(async (v) => ({
            name: v.name,
            id: v.versionId,
            definition: (
              await desktop.symbols({
                type: "get",
                kind: "SYMBOL",
                id: v.versionId,
              })
            ).symbol!.definition,
          })),
        );
        if (!stopped) {
          setItems(cards);
          setTotal(r.page!.total);
        }
      })
      .catch((e) => {
        if (!stopped) setError(editorError(e));
      });
    return () => {
      stopped = true;
    };
  }, [query, offset, active, refresh]);
  return (
    <details className="symbol-tray" open>
      <summary>Saved symbols</summary>
      <p className="muted">
        Drag onto the centre of a unit, or use Add subordinate, to add a unit
        below it. Drop at an edge to insert a sibling.
      </p>
      <label className="field">
        <span>Find saved symbol</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="symbol-tray-grid">
        {items.map((v) => (
          <div
            className="symbol-tray-card"
            key={v.id}
            draggable={!disabled}
            onDragStart={(e) => {
              beginSymbolDrag(
                e.dataTransfer,
                JSON.stringify({
                  kind: "CATALOG",
                  id: v.id,
                }),
              );
            }}
          >
            <SymbolThumbnail definition={v.definition} active={active} />
            {onLoad ? (
              <button
                disabled={disabled}
                onClick={() => void usePin(v.id, onLoad)}
              >
                Load into editor: {v.name}
              </button>
            ) : (
              <strong>{v.name}</strong>
            )}
            <button
              disabled={disabled}
              onClick={() => void usePin(v.id, onUse)}
            >
              Add subordinate: {v.name}
            </button>
          </div>
        ))}
      </div>
      {!items.length && !error && (
        <p className="muted">
          Create a symbol in Military Symbols to use it here.
        </p>
      )}
      <div className="button-row">
        <button
          disabled={!offset}
          onClick={() => setOffset((o) => Math.max(0, o - 6))}
        >
          Previous symbols
        </button>
        <small>{countLabel(total, "symbol")}</small>
        <button
          disabled={offset + 6 >= total}
          onClick={() => setOffset((o) => o + 6)}
        >
          Next symbols
        </button>
      </div>
    </details>
  );
}
