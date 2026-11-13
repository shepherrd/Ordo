import { ModalBackdrop } from "./ModalBackdrop";
import { editorError } from "./editor-error";
import { countLabel } from "./ui-text";
import { useWorkspaceApi } from "./WorkspaceContext";
import { NarrativeContent } from "./NarrativeContent";
import { useEffect, useState } from "react";
import type { UnitProfile } from "../../domain/unit-profiles";
import type { UnitProfileSummary } from "../../application/workspace-ports";
import type { WorkspaceResult } from "../../application/workspace-service";
export function UnitProfilePicker({
  onSelect,
  onCancel,
  title = "Choose organization",
}: {
  onSelect: (v: UnitProfile) => void;
  onCancel: () => void;
  title?: string;
}) {
  const desktop = useWorkspaceApi();
  const [search, setSearch] = useState(""),
    [echelon, setEchelon] = useState(""),
    [offset, setOffset] = useState(0),
    [items, setItems] = useState<UnitProfileSummary[]>([]),
    [total, setTotal] = useState(0),
    [selectedId, setSelectedId] = useState(""),
    [preview, setPreview] = useState<UnitProfile | null>(null),
    [assignedOrbat, setAssignedOrbat] =
      useState<WorkspaceResult["assignedOrbat"]>(),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    desktop
      .workspace({
        type: "browse-unit-profiles",
        query: {
          search,
          echelon,
          status: "",
          sort: "name",
          offset,
          limit: 20,
        },
      })
      .then((r) => {
        if (active) {
          setItems(r.organizations!.items);
          setTotal(r.organizations!.total);
        }
      })
      .catch((e) => setError(editorError(e)));
    return () => {
      active = false;
    };
  }, [search, echelon, offset]);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setPreview(null);
    setAssignedOrbat(undefined);
    setError("");
    desktop
      .workspace({ type: "unit-profile-get", id: selectedId })
      .then((r) => {
        if (!active) return;
        setPreview(r.profile!);
        setAssignedOrbat(r.assignedOrbat);
      })
      .catch((e) => {
        if (active) setError(editorError(e));
      });
    return () => {
      active = false;
    };
  }, [selectedId, desktop]);
  return (
    <ModalBackdrop>
      <section
        className="modal profile-picker"
        role="dialog"
        aria-label={title}
      >
        <h2>{title}</h2>
        {error && <p role="alert">{error}</p>}
        <div className="two-columns">
          <label className="field">
            <span>Search organizations</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          <label className="field">
            <span>Echelon filter</span>
            <input
              value={echelon}
              onChange={(e) => {
                setEchelon(e.target.value);
                setOffset(0);
              }}
            />
          </label>
        </div>
        <div className="profile-picker-list">
          {items.map((v) => (
            <button
              key={v.unitProfileVersionId}
              className={`browse-row${selectedId === v.unitProfileVersionId ? " selected" : ""}`}
              aria-pressed={selectedId === v.unitProfileVersionId}
              onClick={() => setSelectedId(v.unitProfileVersionId)}
            >
              <strong>{v.name}</strong>
              <span>{v.echelon || "Echelon not set"}</span>
            </button>
          ))}
        </div>
        <div className="button-row">
          <button disabled={!offset} onClick={() => setOffset((v) => v - 20)}>
            Previous organizations
          </button>
          <span>
            {total ? offset + 1 : 0}–{Math.min(offset + 20, total)} of {total}
          </span>
          <button
            disabled={offset + 20 >= total}
            onClick={() => setOffset((v) => v + 20)}
          >
            Next organizations
          </button>
        </div>
        {selectedId && !preview && !error && (
          <p role="status">Loading organization…</p>
        )}
        {preview && preview.unitProfileVersionId === selectedId && (
          <div className="selection-preview">
            <h3>{preview.identity.fullDesignation}</h3>
            <NarrativeContent
              value={preview.identity.description || "No description"}
            />
            <p>
              {countLabel(preview.staff.sections.length, "staff section")} ·{" "}
              {countLabel(preview.staff.positions.length, "position")} ·{" "}
              {countLabel(
                assignedOrbat?.unitCount ?? preview.standingSubordinates.length,
                assignedOrbat ? "subordinate unit" : "standing subordinate",
              )}
              {assignedOrbat && (
                <>
                  <br />
                  <span className="hint">
                    Assigned ORBAT: {assignedOrbat.name}
                  </span>
                </>
              )}
            </p>
            <button className="primary" onClick={() => onSelect(preview)}>
              Use organization
            </button>
          </div>
        )}
        <button data-dialog-cancel onClick={onCancel}>
          Cancel selection
        </button>
      </section>
    </ModalBackdrop>
  );
}
