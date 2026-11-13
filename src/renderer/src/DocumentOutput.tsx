import { editorError } from "./editor-error";
import { useEffect, useState, useRef } from "react";
import type {
  DocumentExport,
  PaperOptions,
} from "../../domain/document-exports";
import { useWorkspaceApi } from "./WorkspaceContext";
import { PaperFields } from "./ExportFileControls";
export function DocumentOutput({
  operationId,
  exportId,
  paper,
  onExportWord,
}: {
  operationId: string;
  exportId: string;
  paper: "a4" | "letter";
  onExportWord: (options: PaperOptions) => void;
}) {
  const api = useWorkspaceApi();
  const [options, setOptions] = useState<PaperOptions>({
      paper: paper === "a4" ? "A4" : "Letter",
      orientation: "portrait",
    }),
    [records, setRecords] = useState<DocumentExport[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const selection = useRef("");
  selection.current = `${operationId}/${exportId}`;
  const refresh = async () => {
    const key = `${operationId}/${exportId}`;
    const r = await api.documents({ type: "list", operationId });
    if (selection.current !== key) return;
    setRecords((r.records ?? []).filter((d) => d.sourceExportId === exportId));
  };
  useEffect(() => {
    setRecords([]);
    setError("");
    setMessage("");
    void refresh().catch((e) => setError(editorError(e)));
  }, [operationId, exportId, api]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="document-output">
      <summary>Word / PDF / print</summary>
      <p>Use this saved revision and its export settings.</p>
      <div className="button-row">
        <PaperFields
          label="Saved export"
          options={options}
          onChange={setOptions}
        />
        <button disabled={busy} onClick={() => onExportWord(options)}>
          Export Word
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.documents({
                type: "generate",
                operationId,
                exportId,
                options,
              });
              await refresh();
              setMessage(
                "PDF created. Save a copy to review it before printing.",
              );
            })
          }
        >
          {busy ? "Working…" : "Generate PDF"}
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {records.map((r) => (
        <div className="document-record" key={r.id}>
          <small>
            {new Date(r.generatedAt).toLocaleString()} · {r.options.paper}{" "}
            {r.options.orientation} · {Math.ceil(r.byteLength / 1024)} KB
          </small>
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.documents({
                    type: "save",
                    id: r.id,
                  });
                  setMessage(
                    result.path
                      ? `Saved ${result.path}`
                      : "Save canceled. The PDF remains available in Ordo.",
                  );
                })
              }
            >
              Save PDF
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.documents({
                    type: "print",
                    id: r.id,
                  });
                  setMessage(
                    result.printed
                      ? "Document sent to the selected printer."
                      : "Printing canceled.",
                  );
                })
              }
            >
              Print document
            </button>
          </div>
        </div>
      ))}
    </details>
  );
}
