import { OrganizationOrbatPanel } from "./OrganizationOrbatPanel";
import { useAssignedOrbat } from "./useAssignedOrbat";
import {
  useCatalogSearch,
  useSearchOpen,
  focusSearchField,
} from "./SearchProvider";
import { OrganizationIdentityEditor } from "./OrganizationIdentityEditor";
import {
  organizationProfileSchema,
  type OrganizationProfile as UnitProfile,
} from "../../domain/organization-orbat";
import { ModalBackdrop } from "./ModalBackdrop";
import { countLabel, roleLabel, displayDateTime } from "./ui-text";
import { editorError, fieldIssue } from "./editor-error";
import { DeleteItemButton } from "./DeleteItemButton";
import {
  BusyBoundary,
  useWorkspaceApi,
  useEditorProtection,
} from "./WorkspaceContext";
import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Field, Panel } from "./Fields";
import { UnitProfilePicker } from "./UnitProfilePicker";
import { functionalRoles } from "../../domain/unit-profiles";
import type {
  UnitProfileSummary,
  DoctrineSummary,
} from "../../application/workspace-ports";
import { canonical } from "../../export/projection";
import { useWorkingCopy, useRecoveryOpen } from "./WorkingCopies";
const uid = () => crypto.randomUUID();
const ProfileSymbolEditor = lazy(() => import("./ProfileSymbolEditor"));
const tabs = [
  "Identity",
  "ORBAT",
  "Symbol",
  "Structure",
  "Staff & roles",
  "Defaults",
  "Assets",
] as const;
export function OrganizationWorkspace({
  active,
  newRequest = 0,
}: {
  active: boolean;
  newRequest?: number;
}) {
  const desktop = useWorkspaceApi();
  const [items, setItems] = useState<UnitProfileSummary[]>([]),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(""),
    [echelon, setEchelon] = useState(""),
    [sort, setSort] = useState<"updated" | "name">("updated"),
    [offset, setOffset] = useState(0);
  const [saved, setSaved] = useState<UnitProfile | null>(null),
    [draft, setDraft] = useState<UnitProfile | null>(null),
    [tab, setTab] = useState<(typeof tabs)[number]>("Identity"),
    [newName, setNewName] = useState(""),
    [newOpen, setNewOpen] = useState(false),
    [picker, setPicker] = useState(false),
    [doctrines, setDoctrines] = useState<DoctrineSummary[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [previewImage, setPreviewImage] = useState(""),
    [hierarchy, setHierarchy] = useState<{ name: string; id: string }[]>([]);
  const savedText = useMemo(() => canonical(saved), [saved]);
  const assigned = useAssignedOrbat(
    draft?.orbatWorkspace?.orbatId ?? null,
    active,
  );
  useSearchOpen("catalog", (target) => {
    if (target.area !== "catalog" || target.catalogKind !== "ORGANIZATION")
      return;
    void run(async () => {
      if (draft?.unitProfileVersionId !== target.catalogId) {
        if (dirty)
          throw Error(
            "Save or discard this organization's edits before opening another organization.",
          );
        accept(
          await desktop.organizations({ type: "get", id: target.catalogId }),
        );
      }
      setTab(
        target.positionId || target.sectionId
          ? "Staff & roles"
          : target.nodeId
            ? "ORBAT"
            : "Identity",
      );
      if (!target.nodeId && !target.positionId && !target.sectionId)
        focusSearchField(
          (target.field ?? "fullDesignation")
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase()),
        );
    });
  });
  const dirty = useMemo(
    () => !!draft && !!saved && canonical(draft) !== savedText,
    [draft, saved, savedText],
  );
  // An inactive saved editor must not mask the live catalog after its ORBAT changes elsewhere.
  useCatalogSearch(
    "ORGANIZATION",
    active || dirty ? draft : null,
    assigned.orbat,
  );
  const validation = useMemo(
    () => (draft ? organizationProfileSchema.safeParse(draft) : null),
    [draft],
  );
  const recovery = useWorkingCopy({
    kind: "unit-profile",
    id: saved?.unitProfileVersionId,
    label: saved?.identity.fullDesignation ?? "Organization profile",
    source: saved,
    value: draft,
    dirty,
    busy,
    apply: setDraft,
  });
  useRecoveryOpen("unit-profile", (d) => {
    void run(async () => {
      if (dirty)
        throw Error(
          "Save or discard these organization edits before opening a recovery copy.",
        );
      accept(await desktop.organizations({ type: "get", id: d.id }));
    });
  });
  useEditorProtection({
    name: `Organizations${draft ? ` — ${draft.identity.fullDesignation}` : ""}`,
    dirty,
    busy,
  });
  const refresh = async () => {
    const r = await desktop.workspace({
      type: "browse-unit-profiles",
      query: { search, status: "", echelon, sort, offset, limit: 20 },
    });
    setItems(r.organizations!.items);
    setTotal(r.organizations!.total);
  };
  useEffect(() => {
    if (active) void refresh().catch((e) => setError(editorError(e)));
  }, [active, search, echelon, sort, offset]);
  useEffect(() => {
    if (newRequest) {
      setNewOpen(true);
      setNewName("");
    }
  }, [newRequest]);
  useEffect(() => {
    if (active)
      desktop
        .workspace({ type: "doctrine-summaries", includeStaff: true })
        .then((r) => setDoctrines(r.doctrines!))
        .catch((e) => setError(editorError(e)));
  }, [active]);

  useEffect(() => {
    if (!draft) return;
    let alive = true;
    // This legacy panel only displays direct relationships. Descendants may use their own ORBAT.
    if (tab === "Structure" && !draft.orbatWorkspace?.orbatId)
      Promise.all(
        draft.standingSubordinates.map(async (r) => {
          const child = (
            await desktop.workspace({
              type: "unit-profile-get",
              id: r.unitProfileVersionId,
            })
          ).profile!;
          return {
            id: child.unitProfileVersionId,
            name: child.identity.fullDesignation,
          };
        }),
      )
        .then((r) => {
          if (alive) setHierarchy(r);
        })
        .catch((e) => {
          if (alive) setError(editorError(e));
        });
    return () => {
      alive = false;
    };
  }, [draft, tab]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  const accept = (v: UnitProfile) => {
    setSaved(v);
    setDraft(structuredClone(v));
    setPreviewImage("");
  };
  const edit = (fn: (v: UnitProfile) => void) => {
    setDraft((v) => {
      if (!v) return v;
      const next = structuredClone(v);
      fn(next);
      return next;
    });
  };
  const move = <T,>(items: T[], index: number, direction: number) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
  };
  return (
    <BusyBoundary busy={busy} className="organizations-area" inert={busy}>
      {recovery}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}
      <Panel
        title="Organizations"
        subtitle="Manage organizations, their assigned ORBATs, and unit personnel."
        action={
          <button className="primary" onClick={() => setNewOpen(true)}>
            New organization
          </button>
        }
      >
        <div className="browse-filters">
          <Field
            label="Search organizations"
            value={search}
            onChange={(v) => {
              setSearch(v);
              setOffset(0);
            }}
          />

          <Field
            label="Echelon filter"
            value={echelon}
            onChange={(v) => {
              setEchelon(v);
              setOffset(0);
            }}
          />
          <label className="field">
            <span>Sort organizations</span>
            <select
              aria-label="Sort organizations"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              <option value="updated">Last updated</option>
              <option value="name">Designation</option>
            </select>
          </label>
        </div>
        <div className="browse-list">
          {items.map((v) => (
            <button
              className={`browse-row ${draft?.unitProfileVersionId === v.unitProfileVersionId ? "selected" : ""}`}
              key={v.unitProfileVersionId}
              data-unit-profile-version={v.unitProfileVersionId}
              disabled={dirty || busy}
              onClick={() =>
                run(async () => {
                  accept(
                    await desktop.organizations({
                      type: "get",
                      id: v.unitProfileVersionId,
                    }),
                  );
                  setTab("Identity");
                })
              }
            >
              <OrganizationInsignia assetId={v.insigniaAssetId} />
              <strong>
                {v.name} <small>{v.shortDesignation}</small>
              </strong>
              <span>
                {v.echelon || "Echelon not set"} · {v.unitType || "Custom type"}
              </span>
              <small>
                {v.parentNames ? `Standing parent: ${v.parentNames} · ` : ""}
                {v.defaultDoctrineName
                  ? `Default doctrine: ${v.defaultDoctrineName} · `
                  : ""}
                <time dateTime={v.updatedAt} title={v.updatedAt}>
                  Updated {displayDateTime(v.updatedAt)}
                </time>
              </small>
            </button>
          ))}
        </div>
        {!items.length && (
          <p>No organizations found. Create one or change your search.</p>
        )}
        <div className="button-row">
          <button disabled={!offset} onClick={() => setOffset((v) => v - 20)}>
            Previous organizations
          </button>
          <span>{countLabel(total, "organization")}</span>
          <button
            disabled={offset + 20 >= total}
            onClick={() => setOffset((v) => v + 20)}
          >
            More organizations
          </button>
        </div>
      </Panel>
      {draft && (
        <Panel
          title={draft.identity.fullDesignation}
          subtitle={dirty ? "Unsaved changes" : "Saved organization"}
          action={
            <div className="button-row">
              <button
                disabled={!dirty || busy || validation?.success === false}
                onClick={() =>
                  run(async () => {
                    accept(
                      await desktop.organizations({
                        type: "save",
                        profile: organizationProfileSchema.parse(draft),
                        expectedContentVersion: saved!.contentVersion,
                      }),
                    );
                    await refresh();
                    setNotice("Organization saved.");
                  })
                }
              >
                Save organization
              </button>
              <button disabled={!dirty} onClick={() => accept(saved!)}>
                Discard edits
              </button>
              <DeleteItemButton
                target={{
                  kind: "unit-profile",
                  id: draft.unitProfileVersionId,
                }}
                label="Delete organization"
                disabled={busy || dirty}
                onDeleted={async () => {
                  setDraft(null);
                  setSaved(null);
                  await refresh();
                }}
              />
            </div>
          }
        >
          <div
            className="tabs organization-tabs"
            role="group"
            aria-label="Organization pages"
          >
            {tabs
              .filter(
                (t) =>
                  t !== "Structure" ||
                  (draft.standingSubordinates.length > 0 &&
                    !draft.orbatWorkspace?.orbatId),
              )
              .map((t) => (
                <button
                  key={t}
                  aria-pressed={tab === t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
          </div>
          {tab === "Identity" && (
            <fieldset>
              <OrganizationIdentityEditor
                identity={draft.identity}
                onChange={(identity) =>
                  edit((d) => {
                    d.identity = identity;
                  })
                }
              />
            </fieldset>
          )}
          <div hidden={tab !== "ORBAT" && tab !== "Staff & roles"}>
            <OrganizationOrbatPanel
              key={draft.unitProfileVersionId}
              profile={draft}
              assigned={assigned}
              active={active && (tab === "ORBAT" || tab === "Staff & roles")}
              staffPage={tab === "Staff & roles"}
              onEditStaff={() => setTab("Staff & roles")}
              onViewOrbat={() => setTab("ORBAT")}
              onChange={setDraft}
            />
          </div>
          {tab === "Symbol" && (
            <Suspense fallback={<p>Loading symbol selection…</p>}>
              <ProfileSymbolEditor
                profile={draft}
                onChange={(v) =>
                  setDraft({
                    ...v,
                    ...(draft.orbatWorkspace
                      ? { orbatWorkspace: draft.orbatWorkspace }
                      : {}),
                  })
                }
                active={active}
              />
            </Suspense>
          )}
          {tab === "Structure" && (
            <>
              <p>
                Choose the organizations that belong in this structure. They are
                separate from operation Task Organization.
              </p>
              <button onClick={() => setPicker(true)}>
                Add standing subordinate
              </button>
              {draft.standingSubordinates.map((r, i) => (
                <div className="browse-row" key={r.relationshipId}>
                  <strong>
                    {hierarchy.find((h) => h.id === r.unitProfileVersionId)
                      ?.name ?? r.unitProfileVersionId}
                  </strong>
                  <details>
                    <summary>Reference details</summary>
                    <small>Organization ID: {r.unitProfileVersionId}</small>
                  </details>
                  <div className="button-row">
                    <button
                      onClick={() =>
                        edit((d) => move(d.standingSubordinates, i, -1))
                      }
                    >
                      Move subordinate up
                    </button>
                    <button
                      onClick={() =>
                        edit((d) => move(d.standingSubordinates, i, 1))
                      }
                    >
                      Move subordinate down
                    </button>
                    <button
                      onClick={() =>
                        edit((d) => {
                          d.standingSubordinates.splice(i, 1);
                        })
                      }
                    >
                      Remove subordinate
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          {tab === "Defaults" && (
            <fieldset>
              <label className="field">
                <span>Default doctrine recommendation</span>
                <select
                  aria-label="Default doctrine recommendation"
                  value={draft.defaultDoctrine?.doctrineVersionId ?? ""}
                  onChange={(e) =>
                    edit((d) => {
                      const v = doctrines.find((v) => v.id === e.target.value);
                      d.defaultDoctrine = v
                        ? {
                            doctrineFamilyId: v.familyId,
                            doctrineVersionId: v.id,
                            profileVersion: v.profileVersion,
                            configuration: v.configuration,
                          }
                        : null;
                    })
                  }
                >
                  <option value="">No recommendation</option>
                  {doctrines.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Suggested when creating a new operation. Existing operations
                keep their chosen doctrine.
              </p>
              <h3>Doctrine staff assignments</h3>
              <p className="hint">
                Assign a functional role to each doctrine staff position.
              </p>
              {doctrines.map((d) => (
                <details key={d.id}>
                  <summary>{d.name}</summary>
                  {d.staff.map((s) => {
                    const value = draft.roleMappings.find(
                      (m) =>
                        m.doctrineFamilyId === d.familyId &&
                        m.doctrineVersion === d.profileVersion &&
                        m.staffId === s.id,
                    );
                    return (
                      <label className="field" key={s.id}>
                        <span>{s.name}</span>
                        <select
                          value={value?.functionalRole ?? ""}
                          onChange={(e) =>
                            edit((v) => {
                              v.roleMappings = v.roleMappings.filter(
                                (m) =>
                                  !(
                                    m.doctrineFamilyId === d.familyId &&
                                    m.doctrineVersion === d.profileVersion &&
                                    m.staffId === s.id
                                  ),
                              );
                              if (e.target.value)
                                v.roleMappings.push({
                                  doctrineFamilyId: d.familyId,
                                  doctrineVersion: d.profileVersion,
                                  staffId: s.id,
                                  functionalRole: e.target
                                    .value as (typeof functionalRoles)[number],
                                });
                            })
                          }
                        >
                          <option value="">
                            Use suggested assignment if available
                          </option>
                          {functionalRoles.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </details>
              ))}
            </fieldset>
          )}
          {tab === "Assets" && (
            <>
              <p>
                Choose an insignia image to identify this organization in the
                catalog.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await desktop.files({
                      type: "asset-import",
                      owner: {
                        kind: "unit-profile",
                        id: draft.unitProfileVersionId,
                      },
                    });
                    if (r?.asset) {
                      if (!r.asset.mimeType.startsWith("image/"))
                        throw Error("Select a raster image for insignia");
                      edit((d) => (d.insigniaAssetId = r.asset!.assetId));
                      setPreviewImage(r.data ?? "");
                    }
                  })
                }
              >
                Import insignia image
              </button>
              {draft.insigniaAssetId && (
                <>
                  <p>Organization insignia</p>
                  <button
                    onClick={() =>
                      run(async () => {
                        setPreviewImage(
                          (
                            await desktop.files({
                              type: "asset-preview",
                              assetId: draft.insigniaAssetId!,
                            })
                          )?.data ?? "",
                        );
                      })
                    }
                  >
                    Preview insignia
                  </button>
                  <button
                    onClick={() => edit((d) => (d.insigniaAssetId = null))}
                  >
                    Remove insignia
                  </button>
                </>
              )}
              {previewImage && (
                <img
                  className="insignia-preview"
                  src={previewImage}
                  alt="Organization insignia"
                />
              )}
            </>
          )}
          {validation && !validation.success && (
            <div className="notice error" role="alert">
              <div>
                <strong>Review organization</strong>
                <ul>
                  {[
                    ...new Map(
                      validation.error.issues.map((issue) => {
                        const key = JSON.stringify(issue.path) + issue.message;
                        const index =
                          issue.path[0] === "orbatWorkspace" &&
                          issue.path[1] === "profiles"
                            ? issue.path[2]
                            : undefined;
                        const unit =
                          typeof index === "number"
                            ? draft.orbatWorkspace?.profiles[index]
                            : null;
                        const message = unit
                          ? `${unit.identity.fullDesignation}: ${fieldIssue({ ...issue, path: issue.path.slice(3) })}`
                          : fieldIssue(issue);
                        return [key, message] as const;
                      }),
                    ),
                  ].map(([key, message]) => (
                    <li key={key}>{message}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      )}
      {newOpen && (
        <ModalBackdrop>
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await desktop.workspace({
                  type: "unit-profile-new",
                  name: newName,
                });
                accept(result.profile!);
                await refresh();
                setNewOpen(false);
                setTab("Identity");
              });
            }}
          >
            <h2>New Organization</h2>
            <Field
              label="Organization designation"
              value={newName}
              onChange={setNewName}
            />
            {dirty && (
              <p>
                Save or discard the current organization edits before creating
                another.
              </p>
            )}
            <div className="button-row">
              <button
                data-dialog-cancel
                type="button"
                onClick={() => setNewOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={!newName.trim() || dirty || busy}
              >
                Create organization
              </button>
            </div>
          </form>
        </ModalBackdrop>
      )}
      {picker && (
        <UnitProfilePicker
          title="Add standing subordinate"
          onCancel={() => setPicker(false)}
          onSelect={(v) => {
            edit((d) =>
              d.standingSubordinates.push({
                relationshipId: uid(),
                unitProfileFamilyId: v.unitProfileFamilyId,
                unitProfileVersionId: v.unitProfileVersionId,
              }),
            );
            setPicker(false);
          }}
        />
      )}
    </BusyBoundary>
  );
}

function OrganizationInsignia({ assetId }: { assetId?: string | null }) {
  const desktop = useWorkspaceApi(),
    [data, setData] = useState("");
  useEffect(() => {
    let alive = true;
    setData("");
    if (assetId)
      desktop
        .files({ type: "asset-preview", assetId })
        .then((r) => {
          if (alive) setData(r?.data ?? "");
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [assetId]);
  return data ? (
    <img className="catalog-insignia" src={data} alt="Unit insignia" />
  ) : null;
}
