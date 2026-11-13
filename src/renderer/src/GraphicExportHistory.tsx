import { editorError } from "./editor-error";
import { displayDateTime } from "./ui-text";
import { useWorkspaceApi } from "./WorkspaceContext";
import { useState } from "react";
import type { GraphicExportSummary } from "../../application/symbology-ports";
import type { GraphicStaleness } from "../../application/graphic-staleness";

export function GraphicExportHistory({
  expanded = false,
}: {
  expanded?: boolean;
}) {
  const desktop = useWorkspaceApi();
  const [rows, setRows] = useState<GraphicExportSummary[]>([]),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [statuses, setStatuses] = useState<Record<string, GraphicStaleness>>(
    {},
  );
  const refresh = async () => {
    setBusy(true);
    setMessage("");
    setStatuses({});
    try {
      setRows(await desktop.graphicExports());
    } catch (e) {
      setMessage(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (
    row: GraphicExportSummary,
    action: "check" | "save" | "copy",
  ) => {
    setBusy(true);
    setMessage("");
    try {
      if (action === "check") {
        const result = await desktop.graphicStaleness(row.id);
        setStatuses((s) => ({ ...s, [row.id]: result }));
      } else
        setMessage(
          (await desktop.saveGraphic(row.id, action === "copy")) ??
            "Save canceled. The export remains available in Ordo.",
        );
    } catch (e) {
      setMessage(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      open={expanded || undefined}
      onToggle={(e) => {
        if (e.currentTarget.open) void refresh();
      }}
    >
      <summary>Saved image and data exports</summary>
      <p>
        The latest 100 exports in this workspace. Check whether their source
        content has changed, or save another copy of the original export.
      </p>
      <button disabled={busy} onClick={() => void refresh()}>
        Refresh exports
      </button>
      {!rows.length && !busy && (
        <p>
          No image or data exports yet. Export a symbol or ORBAT to see it here.
        </p>
      )}
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <strong>{row.name}</strong> · {row.format} ·{" "}
            <time dateTime={row.generatedAt} title={row.generatedAt}>
              {displayDateTime(row.generatedAt)}
            </time>
            <details>
              <summary>Export details</summary>
              <small>
                Profile v{row.profileVersion} · SHA-256{" "}
                {row.contentHash.slice(0, 16)}… ·{" "}
                {row.byteLength.toLocaleString()} bytes
              </small>
            </details>
            <div className="button-row">
              <button disabled={busy} onClick={() => void act(row, "check")}>
                Check status
              </button>
              <button disabled={busy} onClick={() => void act(row, "save")}>
                Save {row.format} copy
              </button>
              <button disabled={busy} onClick={() => void act(row, "copy")}>
                Copy {row.format}
              </button>
            </div>
            {statuses[row.id] && (
              <p>
                {statuses[row.id].outdated === null
                  ? `Cannot assess: ${statuses[row.id].reason}`
                  : statuses[row.id].outdated
                    ? `Outdated (${statuses[row.id].changedPaths.length} changed fields).`
                    : "Matches the saved source content."}
              </p>
            )}
          </li>
        ))}
      </ul>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
