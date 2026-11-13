import { useEffect, useMemo, useRef, useState } from "react";
import type { useAssignedOrbat } from "./useAssignedOrbat";
import {
  organizationUnit,
  organizationDiagram,
  organizationUnits,
  type OrganizationProfile,
  type OrganizationUnit,
} from "../../domain/organization-orbat";
import type { SymbolLibrarySummary } from "../../application/symbology-ports";
import { useWorkspaceApi } from "./WorkspaceContext";
import { GraphicPreview } from "./GraphicPreview";
import { OrganizationIdentityEditor } from "./OrganizationIdentityEditor";
import { OrganizationStaffEditor } from "./OrganizationStaffEditor";
import { OrganizationStaffView } from "./OrganizationStaffView";
import { editorError } from "./editor-error";
import "./symbology.css";
import "./organization-orbat.css";
import { useSearchOpen, focusSearchField } from "./SearchProvider";

export function OrganizationOrbatPanel({
  profile,
  active,
  onChange,
  staffPage,
  onEditStaff,
  onViewOrbat,
  assigned,
}: {
  profile: OrganizationProfile;
  active: boolean;
  onChange: (profile: OrganizationProfile) => void;
  staffPage: boolean;
  onEditStaff: () => void;
  onViewOrbat: () => void;
  assigned: ReturnType<typeof useAssignedOrbat>;
}) {
  const desktop = useWorkspaceApi();
  const staffSelector = useRef<HTMLSelectElement>(null);
  const pendingStaffFocus = useRef(false);
  const [maps, setMaps] = useState<SymbolLibrarySummary[]>([]),
    [selected, setSelected] = useState(""),
    [tab, setTab] = useState<"Information" | "Staff & roles">("Information"),
    [listError, setError] = useState(""),
    [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { orbat, generation, refresh } = assigned;
  const loading = assigned.loading && !orbat;
  const error = assigned.error || listError;
  const orbatId = profile.orbatWorkspace?.orbatId ?? null;
  useEffect(() => {
    pendingStaffFocus.current = active && staffPage;
  }, [active, staffPage]);
  useEffect(() => {
    if (pendingStaffFocus.current && !loading && staffSelector.current) {
      pendingStaffFocus.current = false;
      staffSelector.current?.focus({ preventScroll: true });
      staffSelector.current
        ?.closest(".organization-orbat")
        ?.scrollIntoView({ block: "start" });
    }
  }, [active, staffPage, loading]);
  useEffect(() => {
    if (!active) return;
    setError("");
    let alive = true;
    void (async () => {
      const all: SymbolLibrarySummary[] = [];
      for (let offset = 0; ; offset += 100) {
        const { page } = await desktop.symbols({
          type: "browse",
          kind: "ORBAT",
          query: { search: "", status: "", offset, limit: 100 },
        });
        all.push(...page!.items);
        if (all.length >= page!.total) break;
      }
      if (alive) setMaps(all);
    })().catch((e) => {
      if (alive) setError(editorError(e));
    });
    return () => {
      alive = false;
    };
  }, [active, generation, desktop]);
  const rootKey = "organization";
  const { active: units, retained } = useMemo(
    () =>
      organizationUnits(
        profile.orbatWorkspace,
        orbat ? { id: orbat.versionId, nodes: orbat.nodes } : null,
      ),
    [profile.orbatWorkspace, orbat],
  );
  const activeNodes = useMemo(
    () => new Set(units.map((u) => `${u.orbatId}:${u.nodeId}`)),
    [units],
  );
  const chosen =
    selected === "organization"
      ? rootKey
      : activeNodes.has(selected) ||
          retained.some((p) => `retained:${p.orbatId}:${p.nodeId}` === selected)
        ? selected
        : rootKey;
  const node = orbat?.nodes.find(
    (n) => `${orbat.versionId}:${n.nodeId}` === chosen,
  );
  const isRoot = chosen === rootKey;
  const unit = isRoot
    ? profile
    : node && orbat
      ? organizationUnit(profile.orbatWorkspace, orbat.versionId, node)
      : retained.find((p) => `retained:${p.orbatId}:${p.nodeId}` === chosen);
  const scope = isRoot ? "organization" : chosen.replace(/^retained:/, "");
  useSearchOpen(
    "catalog",
    (target) => {
      if (
        target.area !== "catalog" ||
        target.catalogId !== profile.unitProfileVersionId
      )
        return;
      const requested = target.nodeId
        ? `${target.orbatId}:${target.nodeId}`
        : rootKey;
      const next = activeNodes.has(requested)
        ? requested
        : target.nodeId
          ? `retained:${requested}`
          : rootKey;
      const nextScope = next === rootKey ? "organization" : requested;
      setSelected(next);
      setTab("Information");
      if (target.field)
        focusSearchField(
          target.field
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase()),
        );
      setExpanded((values) => ({
        ...values,
        ...(target.sectionId
          ? { [`${nextScope}:section:${target.sectionId}`]: true }
          : {}),
        ...(target.positionId
          ? { [`${nextScope}:edit-position:${target.positionId}`]: true }
          : {}),
      }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const id = target.positionId ?? target.sectionId;
          const container = id
            ? document.querySelector(`[data-staff-id="${CSS.escape(id)}"]`)
            : document.querySelector(".organization-orbat");
          container?.scrollIntoView({ block: "center" });
          container
            ?.querySelector<HTMLElement>(
              "input,textarea,[contenteditable=true],button",
            )
            ?.focus({ preventScroll: true });
        }),
      );
    },
    active && !loading && (!orbatId || !!orbat)
      ? `${profile.unitProfileVersionId}:${orbat?.versionId ?? "root"}`
      : false,
  );
  const disclosure = {
    isOpen: (key: string, initiallyOpen = false) =>
      expanded[`${scope}:${key}`] ?? initiallyOpen,
    setOpen: (key: string, open: boolean) =>
      setExpanded((values) => ({ ...values, [`${scope}:${key}`]: open })),
  };
  const anyStaffOpen =
    unit?.staff.sections.some((s) =>
      disclosure.isOpen(`section:${s.sectionId}`, true),
    ) ||
    unit?.staff.positions.some(
      (p) =>
        disclosure.isOpen(`edit-position:${p.positionId}`) ||
        disclosure.isOpen(`view-position:${p.positionId}`),
    );
  const toggleStaff = () =>
    setExpanded((values) => ({
      ...values,
      ...Object.fromEntries(
        [
          ...(unit?.staff.sections.map((s) => `section:${s.sectionId}`) ?? []),
          ...(unit?.staff.positions.flatMap((p) => [
            `edit-position:${p.positionId}`,
            `view-position:${p.positionId}`,
          ]) ?? []),
        ].map((key) => [`${scope}:${key}`, !anyStaffOpen]),
      ),
    }));
  const collapseButton = (
    <button
      disabled={!unit?.staff.sections.length && !unit?.staff.positions.length}
      onClick={toggleStaff}
    >
      {anyStaffOpen ? "Collapse all" : "Expand all"}
    </button>
  );
  const diagram = useMemo(
    () =>
      active && !staffPage && orbat?.nodes.length
        ? organizationDiagram(profile, orbat)
        : null,
    [active, staffPage, profile, orbat],
  );
  const editUnit = (
    fn: (unit: Pick<OrganizationUnit, "identity" | "staff">) => void,
  ) => {
    if (!unit) return;
    const next = structuredClone(profile);
    if (isRoot) fn(next);
    else {
      next.orbatWorkspace ??= { orbatId, profiles: [] };
      const record = structuredClone(unit as OrganizationUnit);
      fn(record);
      const index = next.orbatWorkspace.profiles.findIndex(
        (p) => p.orbatId === record.orbatId && p.nodeId === record.nodeId,
      );
      if (index < 0) next.orbatWorkspace.profiles.push(record);
      else next.orbatWorkspace.profiles[index] = record;
    }
    onChange(next);
  };
  return (
    <section
      className={`organization-orbat${staffPage ? " organization-staff-page" : ""}`}
      aria-label={
        staffPage ? "Organization staff and roles" : "Organization ORBAT"
      }
    >
      {!staffPage && (
        <>
          <div className="organization-orbat-assignment">
            <label className="field">
              <span>Assigned ORBAT</span>
              <select
                aria-label="Assigned ORBAT"
                value={orbatId ?? ""}
                onChange={(e) => {
                  onChange({
                    ...profile,
                    orbatWorkspace: {
                      orbatId: e.target.value || null,
                      profiles: profile.orbatWorkspace?.profiles ?? [],
                    },
                  });
                  setSelected("");
                }}
              >
                <option value="">No ORBAT assigned</option>
                {maps.map((m) => (
                  <option key={m.versionId} value={m.versionId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={refresh} disabled={loading}>
              Refresh ORBAT
            </button>
          </div>
          <p className="hint">
            All units in this ORBAT are subordinate to this organization. Saved
            ORBAT changes update their hierarchy here. Edit the diagram in
            Symbols &amp; ORBATs.
          </p>
          {profile.standingSubordinates.length > 0 && orbatId && (
            <p className="notice">
              The assigned ORBAT supplies this organization’s structure.
              Previous standing relationships are retained and become available
              again if you unassign it.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading assigned ORBAT…</p>}
      {!staffPage && !orbatId && (
        <p className="empty-state">
          Choose a saved ORBAT to manage its units and staff here.
        </p>
      )}
      {!staffPage && orbat && !orbat.nodes.length && (
        <p className="notice">
          This ORBAT is empty. Add a root unit in the ORBAT editor. Existing
          personnel records remain below.
        </p>
      )}
      {!loading && !error && (staffPage || diagram || retained.length > 0) && (
        <div className="organization-orbat-grid">
          {!staffPage && (
            <div className="organization-orbat-map">
              {diagram && (
                <button
                  className="organization-master-unit"
                  aria-label="Select master organization"
                  aria-pressed={isRoot}
                  onClick={() => setSelected(rootKey)}
                >
                  <span>Master organization</span>
                  <strong>{profile.identity.fullDesignation}</strong>
                  <span>
                    {orbat!.nodes.length} subordinate{" "}
                    {orbat!.nodes.length === 1 ? "unit" : "units"} in assigned
                    ORBAT
                  </span>
                </button>
              )}
              {diagram && (
                <GraphicPreview
                  request={{ kind: "ORBAT", input: diagram }}
                  active={active}
                  compactControls
                  fitToViewport
                  selectedId={node?.nodeId}
                  onNodeSelect={(id) => setSelected(`${orbatId}:${id}`)}
                />
              )}
              {retained.length > 0 && (
                <section className="organization-retained-profiles">
                  <h3>Retained unit profiles</h3>
                  <p className="hint">
                    These profiles are outside the current diagram. Reassigning
                    their original ORBAT or restoring the same unit brings them
                    back.
                  </p>
                  {retained.map((p) => (
                    <button
                      key={`${p.orbatId}:${p.nodeId}`}
                      aria-pressed={
                        chosen === `retained:${p.orbatId}:${p.nodeId}`
                      }
                      onClick={() =>
                        setSelected(`retained:${p.orbatId}:${p.nodeId}`)
                      }
                    >
                      {p.identity.fullDesignation}
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
          <section
            className="organization-unit-profile"
            aria-label="Selected unit profile"
          >
            {staffPage && (
              <label className="field organization-staff-unit">
                <span>Staff unit</span>
                <select
                  ref={staffSelector}
                  aria-label="Staff unit"
                  value={chosen}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value={rootKey}>
                    {profile.identity.fullDesignation} — Master organization
                  </option>
                  {orbat?.nodes.map((n) => (
                    <option
                      key={n.nodeId}
                      value={`${orbat.versionId}:${n.nodeId}`}
                    >
                      {
                        organizationUnit(
                          profile.orbatWorkspace,
                          orbat.versionId,
                          n,
                        ).identity.fullDesignation
                      }
                    </option>
                  ))}
                  {retained.length > 0 && (
                    <optgroup label="Retained unit profiles">
                      {retained.map((p) => (
                        <option
                          key={`${p.orbatId}:${p.nodeId}`}
                          value={`retained:${p.orbatId}:${p.nodeId}`}
                        >
                          {p.identity.fullDesignation}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
            {unit ? (
              <>
                <h3>{unit.identity.fullDesignation}</h3>
                <p className="hint">
                  {isRoot
                    ? "Master organization"
                    : node
                      ? `Subordinate unit of ${profile.identity.fullDesignation}`
                      : "Retained profile — outside the current diagram"}
                </p>
                {staffPage ? (
                  <>
                    <div className="button-row">
                      {(!!orbat?.nodes.length || retained.length > 0) && (
                        <button
                          onClick={() => {
                            setTab("Staff & roles");
                            onViewOrbat();
                          }}
                        >
                          View in ORBAT
                        </button>
                      )}
                      {collapseButton}
                    </div>
                    <OrganizationStaffEditor
                      draft={unit}
                      edit={editUnit}
                      disclosure={disclosure}
                    />
                  </>
                ) : (
                  <>
                    <div
                      className="tabs organization-tabs"
                      role="tablist"
                      aria-label="Unit profile pages"
                    >
                      {(["Information", "Staff & roles"] as const).map((t) => (
                        <button
                          key={t}
                          role="tab"
                          aria-selected={tab === t}
                          className={tab === t ? "active" : ""}
                          onClick={() => setTab(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    {tab === "Information" ? (
                      <OrganizationIdentityEditor
                        identity={unit.identity}
                        onChange={(identity) =>
                          editUnit((u) => {
                            u.identity = identity;
                          })
                        }
                      />
                    ) : (
                      <>
                        <div className="button-row">
                          <button className="primary" onClick={onEditStaff}>
                            Edit staff &amp; roles
                          </button>
                          {collapseButton}
                        </div>
                        <OrganizationStaffView
                          staff={unit.staff}
                          disclosure={disclosure}
                        />
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <p>Select a unit in the ORBAT to open its profile.</p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
