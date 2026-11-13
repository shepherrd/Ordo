import { useState } from "react";
import type { Operation } from "../../domain/model";
import {
  newDocumentLayout,
  type DocumentLayout,
} from "../../domain/document-layout";
import {
  documentHeader,
  documentLayoutCss,
} from "../../export/document-layout-html";
import { Panel } from "./Fields";
import { useWorkspaceApi } from "./WorkspaceContext";

export function DocumentLayoutEditor({
  operation,
  change,
  assets,
  onAsset,
}: {
  operation: Operation;
  change: (mutate: (op: Operation) => void) => void;
  assets: Record<string, string>;
  onAsset: (id: string, data: string) => void;
}) {
  const desktop = useWorkspaceApi();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const layout = operation.metadata.documentLayout ?? newDocumentLayout();
  const edit = (mutate: (layout: DocumentLayout) => void) =>
    change((op) => {
      op.metadata.documentLayout ??= newDocumentLayout();
      mutate(op.metadata.documentLayout);
    });
  const importLogo = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await desktop.files({
        type: "asset-import",
        owner: { kind: "operation", id: operation.id },
      });
      if (!result?.asset) return;
      if (!result.asset.mimeType.startsWith("image/") || !result.data)
        throw Error("Choose a PNG, JPEG, GIF, or WebP image for the logo.");
      onAsset(result.asset.assetId, result.data);
      edit((l) => {
        l.header.logo = result.asset!;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  let preview = "",
    previewError = "";
  try {
    preview = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${documentLayoutCss}<style>body{padding:20px;margin:0;background:white}</style></head><body>${documentHeader(layout, "Operation order", assets)}</body></html>`;
  } catch (e) {
    previewError = e instanceof Error ? e.message : String(e);
  }
  return (
    <Panel
      title="Document header & footer"
      subtitle="Set the text and logo for this operation’s documents. Save the operation to keep your changes."
    >
      <fieldset disabled={busy} className="document-layout-fields">
        <legend>Header</legend>
        <div className="form-grid">
          {(
            [
              ["title", "Document title", "OPERATION ORDER"],
              ["unit", "Unit / first line", "38th Mobile Infantry Division"],
              [
                "organization",
                "Organization / second line",
                "Cascadian Defense Directorate",
              ],
              ["location", "Location / third line", "Arcadia, GCR"],
              [
                "dateTime",
                "Date and time / fourth line",
                "24 MAY 2036, 1200 GMT",
              ],
              [
                "classification",
                "Classification / right label",
                "Unclassified",
              ],
            ] as const
          ).map(([key, label, placeholder]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                maxLength={240}
                value={layout.header[key]}
                placeholder={placeholder}
                onChange={(e) =>
                  edit((l) => {
                    l.header[key] = e.target.value;
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="hint">
          Enter the date and time as you want them printed. Blank lines are
          omitted.
        </p>
        <div className="document-logo-controls">
          {layout.header.logo && assets[layout.header.logo.assetId] && (
            <img
              src={assets[layout.header.logo.assetId]}
              alt="Selected header logo"
            />
          )}
          <button type="button" onClick={() => void importLogo()}>
            {busy
              ? "Choosing logo…"
              : layout.header.logo
                ? "Change header logo"
                : "Choose header logo"}
          </button>
          {layout.header.logo && (
            <button
              type="button"
              onClick={() =>
                edit((l) => {
                  l.header.logo = null;
                })
              }
            >
              Remove header logo
            </button>
          )}
        </div>
      </fieldset>
      <fieldset className="document-layout-fields" disabled={busy}>
        <legend>Footer</legend>
        <div className="form-grid">
          {(["left", "centre", "right"] as const).map((key) => (
            <label className="field" key={key}>
              <span>{key[0].toUpperCase() + key.slice(1)} footer text</span>
              <input
                maxLength={240}
                value={layout.footer[key]}
                onChange={(e) =>
                  edit((l) => {
                    l.footer[key] = e.target.value;
                  })
                }
              />
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={layout.footer.pageNumbers}
            onChange={(e) =>
              edit((l) => {
                l.footer.pageNumbers = e.target.checked;
              })
            }
          />
          Include page numbers on the right
        </label>
        <p className="hint">
          Footer text and page numbers repeat on each PDF page. HTML shows the
          footer text at the end of the document.
        </p>
      </fieldset>
      {!operation.metadata.documentLayout && (
        <button type="button" onClick={() => edit(() => {})}>
          Use this header & footer
        </button>
      )}
      {(error || previewError) && (
        <p role="alert" className="notice error">
          {error || previewError}
        </p>
      )}
      {preview && (
        <iframe
          sandbox=""
          title="Document header preview"
          className="document-header-preview"
          srcDoc={preview}
        />
      )}
    </Panel>
  );
}
