import { useEffect, useState } from "react";
import type { OfficeSummary } from "../../application/office-service";
import { RetainedProduct } from "./RetainedProduct";
import { useWorkspaceApi, useEditorProtection } from "./WorkspaceContext";
import { editorError } from "./editor-error";

export function WordExportHistory({
  operationId,
  revision,
}: {
  operationId: string;
  revision: number;
}) {
  const api = useWorkspaceApi();
  const [records, setRecords] = useState<OfficeSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEditorProtection({ name: "Word export", dirty: false, busy });
  useEffect(() => {
    let live = true;
    setError("");
    setMessage("");
    void api
      .office({ type: "list", operationId, offset })
      .then((r) => {
        if (live) setRecords(r.records ?? []);
      })
      .catch((e) => {
        if (live) setError(editorError(e));
      });
    return () => {
      live = false;
    };
  }, [api, operationId, revision, offset]);
  if (!error && !records.length && !offset) return null;
  return (
    <section className="panel word-exports">
      <h3>Saved Word exports</h3>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {records.slice(0, 30).map((r) => (
        <div key={r.id} className="history-row">
          <div>
            <strong>{r.name}</strong>
            <small>
              DOCX · Revision {r.sourceRevision} ·{" "}
              {new Date(r.generatedAt).toLocaleString()} ·{" "}
              {Math.ceil(r.byteLength / 1024)} KB
            </small>
          </div>
          <span className="pill">{r.superseded ? "Superseded" : r.status}</span>
          <RetainedProduct id={r.id} kind="office" name={r.name} />
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setMessage("");
              try {
                const result = await api.office({ type: "save", id: r.id });
                setMessage(
                  result.path
                    ? `Saved ${result.path}`
                    : "Save canceled. The Word file is available here.",
                );
              } catch (e) {
                setError(editorError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save DOCX
          </button>
        </div>
      ))}
      {(offset > 0 || records.length > 30) && (
        <div className="button-row">
          <button
            disabled={!offset || busy}
            onClick={() => setOffset((v) => Math.max(0, v - 30))}
          >
            Previous Word exports
          </button>
          <button
            disabled={records.length <= 30 || busy}
            onClick={() => setOffset((v) => v + 30)}
          >
            More Word exports
          </button>
        </div>
      )}
    </section>
  );
}
