import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MilitarySymbolDefinition } from "../../domain/symbology";
import { useEditorProtection, useWorkspaceApi } from "./WorkspaceContext";
import { ModalBackdrop } from "./ModalBackdrop";
import { editorError } from "./editor-error";

/** Copy the displayed symbol, including resolved labels, without editing its unit. */
export function SaveUnitSymbol({
  definition,
  name,
  disabled,
  onSaved,
}: {
  definition: MilitarySymbolDefinition | null | undefined;
  name: string;
  disabled?: boolean;
  onSaved: () => void;
}) {
  const desktop = useWorkspaceApi();
  const [copy, setCopy] = useState<MilitarySymbolDefinition | null>(null);
  const [copyName, setCopyName] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEditorProtection({ name: "Save unit symbol", dirty: false, busy });
  const save = async () => {
    if (!copy || !copyName.trim() || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await desktop.symbols({
        type: "new-symbol-from-definition",
        name: copyName.trim(),
        definition: copy,
      });
      setCopy(null);
      setMessage(`Saved “${copyName.trim()}” to military symbols.`);
      onSaved();
    } catch (e) {
      setError(editorError(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <button
        disabled={disabled || !definition || busy}
        onClick={() => {
          if (!definition) return;
          setCopy(structuredClone(definition));
          setCopyName(name.slice(0, 160));
          setError("");
          setMessage("");
        }}
      >
        Save to symbols
      </button>
      {message && <p role="status">{message}</p>}
      {copy &&
        createPortal(
          <ModalBackdrop>
            <section
              className="modal builder-dialog"
              role="dialog"
              aria-label="Save unit symbol"
            >
              <h2>Save unit symbol</h2>
              <p>
                Save an independent copy of this unit’s symbol and current
                labels. The unit and its subordinates stay unchanged.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <label className="field">
                  <span>Symbol name</span>
                  <input
                    data-dialog-initial
                    value={copyName}
                    maxLength={160}
                    required
                    disabled={busy}
                    onChange={(event) => setCopyName(event.target.value)}
                  />
                </label>
                {error && (
                  <p className="notice error" role="alert">
                    {error}
                  </p>
                )}
                <div className="button-row">
                  <button
                    className="primary"
                    type="submit"
                    disabled={busy || !copyName.trim()}
                  >
                    Save symbol copy
                  </button>
                  <button
                    type="button"
                    data-dialog-cancel
                    disabled={busy}
                    onClick={() => setCopy(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          </ModalBackdrop>,
          document.body,
        )}
    </>
  );
}
