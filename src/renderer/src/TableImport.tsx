import { useEffect, useMemo, useRef, useState } from "react";
import type { Operation, ResolvedConfig } from "../../domain/model";
import {
  importFields,
  importKinds,
  importKindLabels,
  previewTableImport,
  suggestImportMapping,
  type ImportFile,
  type ImportKind,
  type ImportMapping,
  type TableImportPreview,
} from "../../domain/table-import";
import { canonical } from "../../export/projection";
import { useEditorProtection } from "./WorkspaceContext";
import { editorError } from "./editor-error";
import "./office.css";
export function TableImport({
  op,
  config,
  change,
  readFile,
}: {
  op: Operation;
  config: ResolvedConfig;
  change: (fn: (d: Operation) => void) => void;
  readFile: () => Promise<ImportFile | null>;
}) {
  const [file, setFile] = useState<ImportFile | null>(null),
    [sheet, setSheet] = useState(0),
    [kind, setKind] = useState<ImportKind>("units"),
    [mapping, setMapping] = useState<ImportMapping>({}),
    [skipRows, setSkipRows] = useState<number[]>([]),
    [clearBlankCells, setClearBlankCells] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [page, setPage] = useState(0),
    [preview, setPreview] = useState<{
      basis: string;
      result: TableImportPreview;
    } | null>(null);
  const ids = useRef(new Map<number, string>()),
    table = file?.tables[sheet],
    basis = useMemo(() => canonical(op), [op]);
  useEditorProtection({
    name: "Spreadsheet import — apply or discard the pending import",
    dirty: !!file,
    busy,
  });
  useEffect(() => {
    setPreview(null);
    setPage(0);
  }, [basis, mapping, clearBlankCells, kind, sheet]);
  const remap = (value: ImportKind, index = sheet) => {
    setKind(value);
    setSheet(index);
    setMapping(suggestImportMapping(value, file?.tables[index]?.rows[0] ?? []));
    setSkipRows([]);
    ids.current.clear();
    setPreview(null);
    setError("");
  };
  const discard = () => {
    setFile(null);
    setPreview(null);
    setMapping({});
    setSkipRows([]);
    setError("");
    ids.current.clear();
  };
  const readable = (value: string) => {
    const source = preview?.result.operation ?? op;
    return (
      [
        ...source.units,
        ...source.tasks,
        ...source.objectives,
        ...source.phases,
        ...source.events,
        ...config.doctrine.staff,
      ].find((v) => v.id === value)?.name ?? value
    );
  };
  const refreshPreview = (skipped = skipRows) => {
    if (!file || !table) return;
    try {
      const result = previewTableImport(
        op,
        config,
        {
          kind,
          table,
          mapping,
          filename: file.filename,
          sha256: file.sha256,
          skipRows: skipped,
          clearBlankCells,
        },
        (row) => {
          if (!ids.current.has(row)) ids.current.set(row, crypto.randomUUID());
          return ids.current.get(row)!;
        },
      );
      setPreview({ basis, result });
      setError("");
    } catch (e) {
      setPreview(null);
      setError(editorError(e));
    }
  };
  const previewRows = preview?.result.rows ?? [];
  return (
    <section className="office-import">
      <h3>Import spreadsheet</h3>
      <p>
        Choose XLSX, UTF-8 CSV, or TSV. Map the columns, review the changes,
        then apply them to this operation’s draft. Save revision when ready.
      </p>
      <p className="muted">
        The first row contains column headings. Up to 1,000 data rows and 64
        columns per sheet. Replace formulas with values before importing.
      </p>
      <div className="button-row">
        <button
          disabled={busy || !!file}
          onClick={() => {
            setBusy(true);
            setError("");
            setMessage("");
            void readFile()
              .then((selected) => {
                if (!selected) return;
                setFile(selected);
                setSheet(0);
                setMapping(
                  suggestImportMapping(kind, selected.tables[0].rows[0] ?? []),
                );
                setPreview(null);
                ids.current.clear();
              })
              .catch((e) => setError(editorError(e)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Reading…" : "Choose spreadsheet"}
        </button>
        {file && <button onClick={discard}>Discard import</button>}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {file && table && (
        <>
          <p>
            <strong>{file.filename}</strong> ·{" "}
            {Math.max(0, table.rows.length - 1)} data rows
          </p>
          <div className="office-controls">
            <label className="field">
              <span>Worksheet</span>
              <select
                aria-label="Import worksheet"
                value={sheet}
                onChange={(e) => remap(kind, Number(e.target.value))}
              >
                {file.tables.map((t, i) => (
                  <option key={i} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Record type</span>
              <select
                aria-label="Import record type"
                value={kind}
                onChange={(e) => remap(e.target.value as ImportKind)}
              >
                {importKinds.map((k) => (
                  <option key={k} value={k}>
                    {importKindLabels[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {table.warnings.map((w) => (
            <p className="notice warning" key={w}>
              {w}
            </p>
          ))}
          <div className="office-mapping">
            {importFields[kind].map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <select
                  aria-label={`Map ${f.label}`}
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (e.target.value === "") delete next[f.key];
                      else next[f.key] = Number(e.target.value);
                      return next;
                    })
                  }
                >
                  <option value="">Do not import</option>
                  {(table.rows[0] ?? []).map((h, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {h || "Untitled column"}
                    </option>
                  ))}
                </select>
                {f.help && <small>{f.help}</small>}
              </label>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={clearBlankCells}
              onChange={(e) => setClearBlankCells(e.target.checked)}
            />
            Use blank mapped cells to clear existing values
          </label>
          <p className="muted">
            Updates require an existing Ordo ID of the selected type. Blank IDs
            create records. Names never cause an update. Unmapped fields keep
            their existing values.
          </p>
          <div className="button-row">
            <button
              onClick={() => {
                refreshPreview();
                setPage(0);
              }}
            >
              Preview import
            </button>
            <button
              className="primary"
              disabled={
                !preview?.result.operation ||
                preview.basis !== basis ||
                !(preview.result.created + preview.result.updated)
              }
              onClick={() => {
                if (!preview?.result.operation || preview.basis !== basis)
                  return;
                const result = preview.result;
                change((d) => {
                  Object.assign(d, {
                    [kind]: structuredClone(result.operation![kind]),
                  });
                });
                discard();
                setMessage(
                  `Applied ${result.created} new and ${result.updated} updated records to the draft. Save revision to keep them.`,
                );
              }}
            >
              Apply import to draft
            </button>
          </div>
          {preview && (
            <>
              <p role="status">
                {preview.result.created} new · {preview.result.updated} updates
                · {previewRows.filter((r) => r.action === "unchanged").length}{" "}
                unchanged ·{" "}
                {previewRows.filter((r) => r.action === "error").length} rows
                need correction
              </p>
              {preview.result.errors.map((e, i) => (
                <p key={i} role="alert" className="notice error">
                  {e}
                </p>
              ))}
              <div className="office-table-scroll">
                <table className="office-import-preview">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Record</th>
                      <th>Action</th>
                      <th>Changes</th>
                      <th>Include</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(page * 40, page * 40 + 40).map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>{r.name || "Unnamed"}</td>
                        <td>{r.action}</td>
                        <td>
                          {r.errors.map((e, i) => (
                            <p role="alert" key={i}>
                              {e}
                            </p>
                          ))}
                          {r.changes.map((c, i) => (
                            <p key={i}>
                              <strong>{c.field}:</strong>{" "}
                              {c.before ? `${readable(c.before)} → ` : ""}
                              {readable(c.after) || "(empty)"}
                            </p>
                          ))}
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Include row ${r.row}`}
                            checked={!skipRows.includes(r.row)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? skipRows.filter((n) => n !== r.row)
                                : [...skipRows, r.row];
                              setSkipRows(next);
                              refreshPreview(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="button-row">
                <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
                  Previous rows
                </button>
                <span>
                  Page {page + 1} of{" "}
                  {Math.max(1, Math.ceil(previewRows.length / 40))}
                </span>
                <button
                  disabled={(page + 1) * 40 >= previewRows.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  More rows
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
