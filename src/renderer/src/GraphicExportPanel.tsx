import { editorError } from "./editor-error";
import { useWorkspaceApi, useEditorProtection } from "./WorkspaceContext";
import { useEffect, useState } from "react";
import type { GraphicStaleness } from "../../application/graphic-staleness";
import type { GraphicExportCommand } from "../../application/graphic-export-service";
import type {
  GraphicExportProfile,
  GraphicExportRecord,
} from "../../domain/graphic-exports";
import { Field } from "./Fields";
export function GraphicExportPanel({
  source,
  product,
  disabled = false,
  units = [],
  expanded = false,
  onBusyChange,
}: {
  source: GraphicExportCommand["source"];
  product: "SYMBOL" | "ORBAT";
  disabled?: boolean;
  units?: { id: string; name: string }[];
  expanded?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const desktop = useWorkspaceApi();
  const [profile, setProfile] = useState<GraphicExportProfile>(() => ({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    version: 1,
    name: product === "SYMBOL" ? "Symbol export" : "ORBAT export",
    product,
    format: "SVG",
    scale: 1,
    background: "TRANSPARENT",
    size: product === "SYMBOL" ? 100 : 30,
    foldPolicy: "AS_SHOWN",
    ancestorPolicy: "BOUNDARY",
    selectedUnitIds: null,
    renderProfile: { id: "ordo-symbol", version: 1 },
  }));
  const [record, setRecord] = useState<GraphicExportRecord | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [staleness, setStaleness] = useState<GraphicStaleness | null>(null);
  useEditorProtection({ name: "Graphic export", dirty: false, busy });
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    let current = true;
    setStaleness(null);
    if (record)
      void desktop
        .graphicStaleness(record.id)
        .then((s) => {
          if (current) setStaleness(s);
        })
        .catch((e) => {
          if (current) setMessage(editorError(e));
        });
    return () => {
      current = false;
    };
  }, [record, sourceKey]);
  const edit = (patch: Partial<GraphicExportProfile>) => {
    setProfile((p) => ({
      ...p,
      ...patch,
      version: record ? p.version + 1 : p.version,
    }));
    setRecord(null);
  };
  const generate = async (copy: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await desktop.exportGraphic({
        source,
        profile,
      });
      setRecord(r);
      setMessage(
        (await desktop.saveGraphic(r.id, copy)) ??
          "Export created and kept in this workspace.",
      );
    } catch (e) {
      setMessage(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="graphic-export" open={expanded || undefined}>
      <summary>Export image or data</summary>
      <fieldset disabled={disabled || busy}>
        <Field
          label="Export name"
          value={profile.name}
          onChange={(name) => edit({ name })}
        />
        <div className="field-grid">
          <label className="field">
            <span>Format</span>
            <select
              value={
                profile.jsonMode === "NATIVE_EXCHANGE"
                  ? profile.jsonMode
                  : profile.format
              }
              onChange={(e) =>
                e.target.value === "NATIVE_EXCHANGE"
                  ? edit({
                      format: "JSON",
                      jsonMode: "NATIVE_EXCHANGE",
                      selectedUnitIds: null,
                      foldPolicy: "AS_SHOWN",
                    })
                  : edit({
                      format: e.target.value as GraphicExportProfile["format"],
                      jsonMode: "DERIVED",
                    })
              }
            >
              {(source.kind === "OPERATION"
                ? ["SVG", "PNG", "JSON"]
                : ["SVG", "PNG"]
              ).map((f) => (
                <option key={f}>{f}</option>
              ))}
              {source.kind !== "OPERATION" && (
                <option value="NATIVE_EXCHANGE">
                  Ordo JSON (reimportable)
                </option>
              )}
            </select>
          </label>
          <fieldset
            className="graphic-image-options"
            disabled={profile.jsonMode === "NATIVE_EXCHANGE"}
          >
            <Field
              label="Symbol size"
              type="number"
              value={String(profile.size)}
              onChange={(v) => edit({ size: Number(v) })}
            />
            <Field
              label="Output scale"
              type="number"
              value={String(profile.scale)}
              onChange={(v) => edit({ scale: Number(v) })}
            />
            <label className="field">
              <span>Background</span>
              <select
                value={profile.background}
                onChange={(e) =>
                  edit({
                    background: e.target
                      .value as GraphicExportProfile["background"],
                  })
                }
              >
                <option value="TRANSPARENT">Transparent</option>
                <option value="WHITE">White</option>
              </select>
            </label>
          </fieldset>
        </div>
        {profile.jsonMode === "NATIVE_EXCHANGE" && (
          <p>
            Exports the saved item, its layout, and the symbols and
            organizations it uses. Import the file to create editable copies in
            Ordo. Image size, background, and scale do not affect this data.
          </p>
        )}
        {product === "ORBAT" && profile.jsonMode !== "NATIVE_EXCHANGE" && (
          <>
            <label className="field">
              <span>Folded branches</span>
              <select
                value={profile.foldPolicy}
                onChange={(e) =>
                  edit({
                    foldPolicy: e.target
                      .value as GraphicExportProfile["foldPolicy"],
                  })
                }
              >
                <option value="AS_SHOWN">As shown</option>
                <option value="EXPANDED">Expand all</option>
              </select>
            </label>
            <label className="field">
              <span>Parent units</span>
              <select
                value={profile.ancestorPolicy}
                onChange={(e) =>
                  edit({
                    ancestorPolicy: e.target
                      .value as GraphicExportProfile["ancestorPolicy"],
                  })
                }
              >
                <option value="BOUNDARY">Show connection only</option>
                <option value="INCLUDE_CONTEXT">
                  Include parent names and symbols
                </option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={profile.selectedUnitIds !== null}
                onChange={(e) =>
                  edit({ selectedUnitIds: e.target.checked ? [] : null })
                }
              />{" "}
              Export selected units
            </label>
            {profile.selectedUnitIds !== null && (
              <div className="export-unit-selection">
                {units.map((u) => (
                  <label key={u.id}>
                    <input
                      type="checkbox"
                      checked={profile.selectedUnitIds!.includes(u.id)}
                      onChange={(e) =>
                        edit({
                          selectedUnitIds: e.target.checked
                            ? [...profile.selectedUnitIds!, u.id]
                            : profile.selectedUnitIds!.filter(
                                (id) => id !== u.id,
                              ),
                        })
                      }
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <div className="button-row">
          <button onClick={() => void generate(false)}>
            Generate and save {profile.format}
          </button>
          <button onClick={() => void generate(true)}>
            Copy {profile.format}
          </button>
        </div>
      </fieldset>
      {disabled && <p>Save or discard your edits before exporting.</p>}
      {record && (
        <details>
          <summary>Export details</summary>
          <small>
            Retained export {record.id} · profile version{" "}
            {record.profile.version} · SHA-256 {record.contentHash.slice(0, 16)}
            …
          </small>
        </details>
      )}
      {record && staleness && (
        <p role="status">
          {staleness.outdated === null
            ? `Cannot assess this export: ${staleness.reason}`
            : staleness.outdated
              ? "Source content has changed. Generate a new export to include those changes."
              : "Matches the saved source content."}
          {staleness.comparedWith === "EXACT_LIBRARY_VERSION" &&
            " Checked against the saved copy used for this export."}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
