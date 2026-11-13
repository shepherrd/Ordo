import { useEffect, useRef, useState } from "react";
import { ModalBackdrop } from "./ModalBackdrop";
import { useWorkspaceApi, useEditorProtection } from "./WorkspaceContext";
import { editorError } from "./editor-error";
import "./retained-products.css";
export function RetainedProduct({
  id,
  name,
  kind,
  html,
}: {
  id: string;
  name: string;
  kind: "order" | "whiteboard" | "office";
  html?: string;
}) {
  const api = useWorkspaceApi();
  const opener = useRef<HTMLButtonElement>(null),
    close = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<{
      html?: string;
      image?: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEditorProtection({
    name: "Saved output preview",
    dirty: false,
    busy: busy || !!preview,
  });
  // Disabling the save control during the native dialog can leave focus on body.
  useEffect(() => {
    if (
      preview &&
      !busy &&
      (!document.activeElement || document.activeElement === document.body)
    )
      close.current?.focus({ preventScroll: true });
  }, [preview, busy]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        ref={opener}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            setMessage("");
            if (kind === "order") setPreview({ html });
            else if (kind === "whiteboard")
              setPreview({
                image: (await api.whiteboards({ type: "preview", id })).data,
              });
            else
              setPreview({
                html: (await api.office({ type: "inspect", id })).html,
              });
          })
        }
      >
        Open saved{" "}
        {kind === "order"
          ? "order"
          : kind === "whiteboard"
            ? "snapshot"
            : "Word export"}
      </button>
      {error && !preview && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {preview && (
        <ModalBackdrop returnFocus={opener.current}>
          <section
            className="modal retained-product-preview"
            aria-label={`Saved output: ${name}`}
          >
            <h2>{name}</h2>
            <p>
              This is the retained source. Later edits do not change it.
              {kind === "office"
                ? " Word pagination may differ from this source preview."
                : ""}
            </p>
            <div className="button-row">
              <button
                ref={close}
                data-dialog-cancel
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Close preview
              </button>
              {kind !== "order" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r =
                        kind === "office"
                          ? await api.office({ type: "save", id })
                          : await api.whiteboards({
                              type: "save",
                              id,
                              format: "PNG",
                            });
                      setMessage(r.path ? `Saved ${r.path}` : "Save canceled.");
                    })
                  }
                >
                  Save {kind === "whiteboard" ? "PNG" : "DOCX"}
                </button>
              )}
            </div>
            {message && <p role="status">{message}</p>}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {preview.image ? (
              <img src={preview.image} alt={name} />
            ) : (
              <iframe
                title="Saved output preview"
                srcDoc={preview.html}
                sandbox=""
              />
            )}
          </section>
        </ModalBackdrop>
      )}
    </>
  );
}
