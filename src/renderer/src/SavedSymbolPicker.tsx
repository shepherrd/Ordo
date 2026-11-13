import { ModalBackdrop } from "./ModalBackdrop";
import { countLabel } from "./ui-text";
import { editorError } from "./editor-error";
import { useWorkspaceApi } from "./WorkspaceContext";
import { useEffect, useRef, useState } from "react";
import type { SavedSymbolPin } from "../../domain/symbology";
import type { SymbolLibrarySummary } from "../../application/symbology-ports";
import { GraphicPreview } from "./GraphicPreview";
import { Field } from "./Fields";
import { SavedSymbolThumbnail } from "./SymbolThumbnail";
export function SavedSymbolPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (pin: SavedSymbolPin, name: string) => void;
  onCancel: () => void;
}) {
  const desktop = useWorkspaceApi();
  const [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<SymbolLibrarySummary[]>([]),
    [total, setTotal] = useState(0),
    [pin, setPin] = useState<SavedSymbolPin | null>(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(false);
  const selectionRequest = useRef(0);
  const select = async (id: string) => {
    const request = ++selectionRequest.current;
    setSelected(id);
    setPin(null);
    setError("");
    setLoading(true);
    try {
      const r = await desktop.symbols({ type: "symbol-pin", id });
      if (request === selectionRequest.current) setPin(r.pin!);
    } catch (e) {
      if (request === selectionRequest.current) setError(editorError(e));
    } finally {
      if (request === selectionRequest.current) setLoading(false);
    }
  };
  useEffect(() => {
    let stopped = false;
    selectionRequest.current++;
    setSelected("");
    setPin(null);
    setLoading(false);
    setError("");
    void desktop
      .symbols({
        type: "browse",
        kind: "SYMBOL",
        query: { search: query, status: "", offset, limit: 20 },
      })
      .then((r) => {
        if (!stopped) {
          setItems(r.page!.items);
          setTotal(r.page!.total);
        }
      })
      .catch((e) => {
        if (!stopped) setError(editorError(e));
      });
    return () => {
      stopped = true;
      selectionRequest.current++;
    };
  }, [query, offset]);
  return (
    <ModalBackdrop>
      <section
        className="modal profile-picker"
        role="dialog"
        aria-label="Choose symbol"
      >
        <h2>Choose symbol</h2>
        <p>
          Choose a saved symbol. Later edits in Military Symbols will not change
          this copy.
        </p>
        {error && <p role="alert">{error}</p>}
        <Field
          label="Search symbols"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setOffset(0);
          }}
        />
        <div className="two-columns">
          <div>
            {items.map((v) => (
              <button
                className={`browse-row symbol-browse-row ${selected === v.versionId ? "selected" : ""}`}
                aria-pressed={selected === v.versionId}
                key={v.versionId}
                onClick={() => void select(v.versionId)}
              >
                <SavedSymbolThumbnail
                  id={v.versionId}
                  contentVersion={v.contentVersion}
                />
                <b>{v.name}</b>
              </button>
            ))}
            {!items.length && (
              <p className="muted">
                {query
                  ? "No symbols match this search."
                  : "Create a saved symbol in Military Symbols to choose it here."}
              </p>
            )}
            <div className="button-row">
              <button
                disabled={!offset}
                onClick={() => setOffset((v) => Math.max(0, v - 20))}
              >
                Previous
              </button>
              <span>{countLabel(total, "symbol")}</span>
              <button
                disabled={offset + 20 >= total}
                onClick={() => setOffset((v) => v + 20)}
              >
                Next
              </button>
            </div>
          </div>
          <div>
            {loading && <p role="status">Loading symbol…</p>}
            {!pin && !loading && (
              <p className="muted">Select a symbol to preview it.</p>
            )}
            {pin && (
              <>
                <GraphicPreview
                  request={{
                    kind: "SYMBOL",
                    input: {
                      definition: pin.definition,
                      size: 100,
                      context: "SYMBOL",
                      labelSide: "RIGHT",
                    },
                  }}
                />
              </>
            )}
          </div>
        </div>
        <div className="button-row">
          <button
            className="primary"
            disabled={!pin || loading}
            onClick={() =>
              pin &&
              onSelect(
                pin,
                items.find((item) => item.versionId === selected)?.name ??
                  "Unit",
              )
            }
          >
            Use symbol
          </button>
          <button data-dialog-cancel onClick={onCancel}>
            Cancel symbol selection
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
