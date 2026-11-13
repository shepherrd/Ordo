import { countLabel } from "./ui-text";
import { editorError } from "./editor-error";
import { GraphicPreview } from "./GraphicPreview";
import { useWorkspaceApi, useEditorProtection } from "./WorkspaceContext";
import { useEffect, useRef, useState } from "react";
import type {
  ExchangePolicy,
  ExchangePreview,
} from "../../application/exchange-service";
import type {
  ConversionField,
  ExchangeImportReceipt,
} from "../../domain/library-exchange";
const conversionActionLabels: Record<ConversionField["action"], string> = {
  COPIED: "Copied",
  DEFAULTED: "Default applied",
  REMAPPED: "Converted",
  REUSED: "Existing item reused",
  DETACHED: "Independent copy",
  OMITTED: "Omitted",
  UNSUPPORTED: "Unsupported",
  INVALID: "Invalid",
  CONFLICT: "Conflict",
  MISSING: "Missing",
  INFO: "Information",
};
const needsAttention = new Set([
  "INVALID",
  "MISSING",
  "CONFLICT",
  "OMITTED",
  "UNSUPPORTED",
  "DETACHED",
]);
export function ConversionReport({
  fields,
  initialFilter = "",
}: {
  fields: ConversionField[];
  initialFilter?: string;
}) {
  const [page, setPage] = useState(0),
    [filter, setFilter] = useState(initialFilter);
  const shown =
    filter === "ATTENTION"
      ? fields.filter((f) => needsAttention.has(f.action))
      : filter
        ? fields.filter((f) => f.action === filter)
        : fields;
  return (
    <div className="exchange-report">
      <label>
        Report filter{" "}
        <select
          aria-label="Report filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All fields ({fields.length})</option>
          <option value="ATTENTION">
            Needs review (
            {fields.filter((f) => needsAttention.has(f.action)).length})
          </option>
          {[...new Set(fields.map((f) => f.action))].map((a) => (
            <option key={a} value={a}>
              {conversionActionLabels[a]}
            </option>
          ))}
        </select>
      </label>
      <p>
        {countLabel(shown.length, "field")} · page {page + 1} of{" "}
        {Math.max(1, Math.ceil(shown.length / 40))}
      </p>
      <div className="exchange-table">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Action</th>
              <th>Source → result</th>
              <th>Explanation</th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(page * 40, (page + 1) * 40).map((f, i) => (
              <tr key={page * 40 + i}>
                <td>{f.path}</td>
                <td>{conversionActionLabels[f.action]}</td>
                <td>
                  <code>{f.source}</code>
                  <br />→ <code>{f.target}</code>
                </td>
                <td>{f.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="button-row">
        <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
          Previous report page
        </button>
        <button
          disabled={(page + 1) * 40 >= shown.length}
          onClick={() => setPage((p) => p + 1)}
        >
          Next report page
        </button>
      </div>
    </div>
  );
}
export function ImportReceiptView({ id }: { id: string }) {
  const desktop = useWorkspaceApi();
  const [receipt, setReceipt] = useState<ExchangeImportReceipt | null>(null),
    [error, setError] = useState(""),
    [sourcePage, setSourcePage] = useState(0);
  useEffect(() => {
    setReceipt(null);
    setSourcePage(0);
    setError("");
  }, [id]);
  return (
    <details
      className="library-import"
      onToggle={(e) => {
        if (e.currentTarget.open && !receipt)
          void desktop
            .libraryImportReceipt(id)
            .then(setReceipt)
            .catch((e) => setError(editorError(e)));
      }}
    >
      <summary>Import source and conversion report</summary>
      {error && <p role="alert">{error}</p>}
      {receipt && (
        <>
          <p>
            {receipt.sourceName} ·{" "}
            {receipt.importer === "ordo-exchange-v1"
              ? "Ordo JSON"
              : "Archived import"}{" "}
            · {receipt.policy} · {receipt.at}
          </p>
          <p>
            Source SHA-256 <code>{receipt.sourceHash}</code>.{" "}
            {countLabel(receipt.targets.length, "imported item")} and{" "}
            {countLabel(receipt.mappings.length, "identity mapping")} retained.
          </p>
          <ConversionReport fields={receipt.fields} />
          <details>
            <summary>Original JSON (read only)</summary>
            <pre>
              {receipt.sourceText.slice(
                sourcePage * 10000,
                (sourcePage + 1) * 10000,
              )}
            </pre>
            <p>
              Characters {sourcePage * 10000 + 1}–
              {Math.min((sourcePage + 1) * 10000, receipt.sourceText.length)} of{" "}
              {receipt.sourceText.length}
            </p>
            <button
              disabled={!sourcePage}
              onClick={() => setSourcePage((p) => p - 1)}
            >
              Previous source page
            </button>
            <button
              disabled={(sourcePage + 1) * 10000 >= receipt.sourceText.length}
              onClick={() => setSourcePage((p) => p + 1)}
            >
              Next source page
            </button>
          </details>
          <details>
            <summary>Identity mappings</summary>
            <pre>{JSON.stringify(receipt.mappings, null, 2)}</pre>
          </details>
        </>
      )}
    </details>
  );
}
export function LibraryImportPanel({
  disabled,
  onImported,
  expanded = false,
  onBusyChange,
}: {
  disabled: boolean;
  onImported: (targets: ExchangePreview["targets"]) => Promise<void>;
  expanded?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const desktop = useWorkspaceApi();
  const [preview, setPreview] = useState<ExchangePreview | null>(null),
    [visualIndex, setVisualIndex] = useState(0),
    [policy, setPolicy] = useState<ExchangePolicy>("REUSE_EXACT"),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const current = useRef<{ requestId: string; token?: string } | null>(null);
  useEditorProtection({ name: "Library import", dirty: false, busy });
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(
    () => () => {
      if (current.current)
        void desktop
          .cancelLibraryImport(current.current.requestId, current.current.token)
          .catch(() => {});
    },
    [],
  );
  const cancel = async () => {
    const c = current.current;
    current.current = null;
    setPreview(null);
    setVisualIndex(0);
    setAck(false);
    setBusy(true);
    try {
      if (c) await desktop.cancelLibraryImport(c.requestId, c.token);
    } finally {
      if (!current.current) setBusy(false);
    }
  };
  const prepare = async (revise: boolean, nextPolicy = policy, file?: File) => {
    const previous = revise ? preview?.token : undefined;
    if (current.current && !revise)
      await desktop.cancelLibraryImport(
        current.current.requestId,
        current.current.token,
      );
    const requestId = crypto.randomUUID();
    current.current = { requestId };
    setBusy(true);
    setError("");
    setMessage("");
    setAck(false);
    setPreview(null);
    try {
      if (file && file.size > 10 * 1024 * 1024)
        throw Error("Select a JSON or TXT file no larger than 10 MiB");
      const droppedFile = file
        ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
        : undefined;
      if (current.current?.requestId !== requestId) return;
      const next = await desktop.previewLibraryImport(
        requestId,
        nextPolicy,
        previous,
        droppedFile,
      );
      if (current.current?.requestId !== requestId) {
        if (next) await desktop.cancelLibraryImport(requestId, next.token);
        return;
      }
      setPreview(next);
      if (next) current.current.token = next.token;
    } catch (e) {
      if (current.current?.requestId === requestId) setError(editorError(e));
    } finally {
      if (current.current?.requestId === requestId) setBusy(false);
    }
  };
  const commit = async () => {
    if (
      !preview ||
      busy ||
      disabled ||
      preview.policy !== policy ||
      !preview.canCommit ||
      (preview.requiresAcknowledgement && !ack)
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await desktop.commitLibraryImport(preview.token, ack);
      setMessage(
        `Imported ${result.targets.length} new item${result.targets.length === 1 ? "" : "s"}. Source and conversion report retained.`,
      );
      await onImported(result.targets);
      await cancel();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="library-import"
      open={expanded || undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = disabled || busy ? "none" : "copy";
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        if (disabled || busy) return;
        e.currentTarget.open = true;
        if (e.dataTransfer.files.length !== 1) {
          setError("Drop one JSON or TXT file at a time");
          return;
        }
        void prepare(false, policy, e.dataTransfer.files[0]);
      }}
    >
      <summary>Import Ordo JSON</summary>
      <p>
        Choose or drop a JSON/TXT file here to preview the items to import.
        Existing items stay unchanged.
      </p>
      <details className="import-options">
        <summary>Linked item options</summary>
        <label className="field">
          <span>Linked symbols and organizations</span>
          <select
            aria-label="Linked symbols and organizations"
            disabled={busy || disabled}
            value={policy}
            onChange={(e) => {
              const next = e.target.value as ExchangePolicy;
              setPolicy(next);
              if (preview) void prepare(true, next);
            }}
          >
            <option value="REUSE_EXACT">Reuse matching local items</option>
            <option value="DETACHED_COPIES">
              Create independent copies where source content is available
            </option>
          </select>
        </label>
      </details>
      <div className="button-row">
        <button disabled={busy || disabled} onClick={() => void prepare(false)}>
          Choose file and preview
        </button>
        {preview && (
          <button
            disabled={busy || disabled}
            onClick={() => void prepare(true)}
          >
            Refresh preview
          </button>
        )}
        {(preview || busy) && (
          <button onClick={() => void cancel()}>Cancel import</button>
        )}
      </div>
      {disabled && <p>Save or discard the current edits before importing.</p>}
      {busy && <p role="status">Checking import…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {preview && (
        <>
          {!!preview.visuals?.length && (
            <section className="import-visual" aria-label="Import preview">
              <label className="field">
                <span>Preview item</span>
                <select
                  value={Math.min(visualIndex, preview.visuals.length - 1)}
                  onChange={(e) => setVisualIndex(Number(e.target.value))}
                >
                  {preview.visuals.map((v, i) => (
                    <option value={i} key={i}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <GraphicPreview
                fitToWidth={
                  preview.visuals[
                    Math.min(visualIndex, preview.visuals.length - 1)
                  ].request.kind === "SYMBOL"
                }
                fitMaxHeight={240}
                request={
                  preview.visuals[
                    Math.min(visualIndex, preview.visuals.length - 1)
                  ].request
                }
              />
              {preview.targets.length > preview.visuals.length && (
                <p className="muted">
                  Showing the first {preview.visuals.length} items. All{" "}
                  {preview.targets.length} items will be imported.
                </p>
              )}
            </section>
          )}
          <section className="import-summary" aria-label="Import summary">
            <h3>
              {preview.canCommit
                ? "Ready to review"
                : "Changes needed before import"}
            </h3>
            <p>
              {countLabel(
                preview.targets.filter((t) => t.kind === "SYMBOL").length,
                "symbol",
              )}{" "}
              and{" "}
              {countLabel(
                preview.targets.filter((t) => t.kind === "ORBAT").length,
                "ORBAT",
              )}{" "}
              will be added as editable copies. Existing items will stay
              unchanged.
            </p>
            <ul>
              <li>
                {countLabel(
                  preview.fields.filter(
                    (f) => f.action === "OMITTED" || f.action === "UNSUPPORTED",
                  ).length,
                  "field",
                )}{" "}
                cannot be carried into the editable result. Original values
                remain in the import record.
              </li>
              <li>
                {countLabel(
                  preview.fields.filter((f) => f.action === "DEFAULTED").length,
                  "field",
                )}{" "}
                will use an Ordo default.
              </li>
              <li>
                {countLabel(
                  preview.fields.filter((f) => f.action === "DETACHED").length,
                  "field",
                )}{" "}
                will be copied independently of its original linked item.
              </li>
            </ul>
            {preview.canCommit && !preview.requiresAcknowledgement && (
              <p>
                No conversion changes need your acknowledgement. You can import
                below.
              </p>
            )}
          </section>
          <p>
            {preview.sourceName} ·{" "}
            {countLabel(preview.targets.length, "new item")} to import
          </p>
          <p>
            {preview.targets
              .slice(0, 20)
              .map((t) => t.name)
              .join(", ")}
            {preview.targets.length > 20
              ? `, and ${preview.targets.length - 20} more (available in the gallery after import)`
              : ""}
          </p>
          {!preview.canCommit && (
            <section className="notice error" role="alert">
              <strong>Import needs a correction</strong>
              <ul>
                {preview.fields
                  .filter(
                    (f) =>
                      f.action === "INVALID" ||
                      (preview.policy === "REUSE_EXACT" &&
                        (f.action === "MISSING" || f.action === "CONFLICT")),
                  )
                  .slice(0, 8)
                  .map((f, i) => (
                    <li key={i}>
                      <b>{f.path}</b>: {f.detail}
                    </li>
                  ))}
              </ul>
              <p>
                Correct invalid fields in the source file and choose it again.
                For missing or conflicting linked items, choose independent
                copies if the file contains their content.
              </p>
            </section>
          )}
          <details
            className="import-field-report"
            open={preview.requiresAcknowledgement || !preview.canCommit}
          >
            <summary>Field-by-field conversion report</summary>
            <ConversionReport
              key={preview.token}
              fields={preview.fields}
              initialFilter="ATTENTION"
            />
          </details>
          {preview.requiresAcknowledgement && (
            <label>
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />{" "}
              I reviewed the fields that were omitted, are unsupported, or were
              copied independently. Their original values will remain in the
              import record.
            </label>
          )}
          {preview.policy !== policy && (
            <p>Checking the updated import choice…</p>
          )}
          {preview.canCommit && preview.requiresAcknowledgement && !ack && (
            <p role="status">
              Next: review the conversion report, then check the acknowledgement
              above to enable import.
            </p>
          )}
          <button
            disabled={
              disabled ||
              busy ||
              !preview.canCommit ||
              preview.policy !== policy ||
              (preview.requiresAcknowledgement && !ack)
            }
            onClick={() => void commit()}
          >
            Import {countLabel(preview.targets.length, "new item")}
          </button>
        </>
      )}
    </details>
  );
}
