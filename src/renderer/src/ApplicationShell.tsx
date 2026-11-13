import { ModalBackdrop } from "./ModalBackdrop";
import { SearchDialog } from "./SearchDialog";
import { focusSearchTarget } from "./SearchProvider";
import { editorError } from "./editor-error";
import { countLabel } from "./ui-text";
import { DeleteItemButton } from "./DeleteItemButton";
import {
  BusyBoundary,
  useWorkspaceApi,
  useEditorProtection,
  useWorkspaceSession,
  EditorScope,
  ApplicationVersion,
} from "./WorkspaceContext";
import {
  useEffect,
  useState,
  useRef,
  useCallback,
  lazy,
  Suspense,
  useSyncExternalStore,
} from "react";
import {
  newOperationTab,
  restoreOperationTabs,
  operationTabsKey,
  type OperationEditorHandle,
  type OperationEditorStatus,
} from "./operation-tabs";
import { App } from "./App";
import { DoctrineBuilder } from "./DoctrineBuilder";
import { OrganizationWorkspace } from "./OrganizationWorkspace";
import { UnitProfilePicker } from "./UnitProfilePicker";
import { Field, Panel } from "./Fields";
import {
  globalPages,
  startupLocation,
  enterOperation,
  leaveOperation,
  type GlobalPage,
  type WorkspaceLocation,
} from "../../domain/workspace-navigation";
import type {
  DashboardSummary,
  GlobalOperationSummary,
  DoctrineSummary,
} from "../../application/workspace-ports";
import type { AppState } from "../../application/service";
import type { Preferences } from "../../domain/model";
import type { ManagedAsset } from "../../domain/modules";
import type { UnitProfile } from "../../domain/unit-profiles";
import { WorkingCopies, useWorkingCopy } from "./WorkingCopies";
import {
  preferencesDraftId,
  editablePreferences,
} from "../../application/working-drafts";
import { WorkspaceStorage } from "./WorkspaceStorage";
import { ThemeSettings } from "./ThemeSettings";
const SymbolsAndOrbatsWorkspace = lazy(
  () => import("./SymbolsAndOrbatsWorkspace"),
);
export function ApplicationShell() {
  const desktop = useWorkspaceApi();
  const session = useWorkspaceSession();
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useSyncExternalStore(session.subscribe, session.getRevision);
  const [location, setLocation] = useState<WorkspaceLocation>(startupLocation),
    [openOperations, setOpenOperations] = useState(() =>
      session.restored ? [] : restoreOperationTabs(),
    ),
    [generation, setGeneration] = useState(0),
    [catalogGeneration, setCatalogGeneration] = useState(0);
  const editors = useRef(new Map<string, OperationEditorHandle>());
  const [closingId, setClosingId] = useState<string | null>(null),
    [closeBusy, setCloseBusy] = useState(false),
    [closeError, setCloseError] = useState("");
  const closingOperation = openOperations.find((o) => o.id === closingId);
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null),
    [operations, setOperations] = useState<GlobalOperationSummary[]>([]),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [sort, setSort] = useState<"updated" | "name">("updated"),
    [offset, setOffset] = useState(0),
    [doctrineState, setDoctrineState] = useState<AppState | null>(null);
  const [organizationVisited, setOrganizationVisited] = useState(false),
    [symbolsVisited, setSymbolsVisited] = useState(false),
    [organizationNew, setOrganizationNew] = useState(0),
    [preferences, setPreferences] = useState<Preferences | null>(null),
    [savedPreferences, setSavedPreferences] = useState<Preferences | null>(
      null,
    ),
    [assets, setAssets] = useState<ManagedAsset[]>([]),
    [assetTotal, setAssetTotal] = useState(0),
    [assetSearch, setAssetSearch] = useState(""),
    [assetOffset, setAssetOffset] = useState(0),
    [assetPreview, setAssetPreview] = useState("");
  const [newOpen, setNewOpen] = useState(false),
    [newName, setNewName] = useState(""),
    [newDemo, setNewDemo] = useState(false),
    [newProfile, setNewProfile] = useState<UnitProfile | null>(null),
    [picker, setPicker] = useState(false),
    [initialize, setInitialize] = useState(false),
    [doctrines, setDoctrines] = useState<DoctrineSummary[]>([]),
    [doctrineId, setDoctrineId] = useState("");
  const [error, setError] = useState(""),
    [message, setMessage] = useState(
      session.restored
        ? "Workspace restored. A recovery backup of the previous workspace was retained."
        : "",
    ),
    [busy, setBusy] = useState(false);
  useEditorProtection({ name: "Workspace action", dirty: false, busy });
  useEditorProtection({
    name: "Local preferences",
    dirty:
      !!preferences &&
      JSON.stringify(preferences) !== JSON.stringify(savedPreferences),
    busy: false,
  });
  useEditorProtection({
    name: "New operation",
    dirty: newOpen && !!newName.trim(),
    busy: false,
  });
  const page = location.area === "global" ? location.page : null;
  const preferencesRecovery = useWorkingCopy({
    kind: "preferences",
    id: savedPreferences ? preferencesDraftId : undefined,
    label: "Local preferences",
    source: editablePreferences(savedPreferences),
    value: editablePreferences(preferences),
    dirty:
      !!preferences &&
      JSON.stringify(preferences) !== JSON.stringify(savedPreferences),
    busy,
    apply: (value) =>
      setPreferences((previous) =>
        previous && value ? { ...previous, ...value } : previous,
      ),
  });
  const recoveryTarget = session.recoveryTarget;
  useEffect(() => {
    if (!recoveryTarget) return;
    const t = recoveryTarget;
    if (t.kind === "operation") openOperation(t.id);
    else if (t.kind === "export-profile" && t.scope)
      openOperation(t.scope, "exports");
    else if ((t.kind === "review" || t.kind === "review-new") && t.scope)
      openOperation(t.scope, "history");
    else
      navigate(
        (
          {
            symbol: "Military Symbols",
            orbat: "ORBATs",
            doctrine: "Doctrines",
            "unit-profile": "Organizations",
            preferences: "Settings",
          } as const
        )[t.kind as "symbol"] ?? "Dashboard",
      );
  }, [recoveryTarget?.nonce]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  const navigate = (p: GlobalPage) => {
    setLocation(leaveOperation(p));
    if (p === "Organizations") setOrganizationVisited(true);
    if (p === "Military Symbols" || p === "ORBATs") setSymbolsVisited(true);
    setError("");
  };
  const openOperation = (id: string, p?: string) => {
    setOpenOperations((tabs) => {
      if (!tabs.some((o) => o.id === id))
        return [...tabs, newOperationTab(id, p)];
      return p
        ? tabs.map((o) =>
            o.id === id
              ? { ...o, requestPage: p, requestNonce: o.requestNonce + 1 }
              : o,
          )
        : tabs;
    });
    setLocation(enterOperation(id, p));
    void desktop
      .workspace({ type: "remember-operation", operationId: id })
      .catch((e) => setError(editorError(e)));
  };
  const updateEditorStatus = useCallback(
    (id: string, status: OperationEditorStatus) => {
      setOpenOperations((tabs) => {
        const tab = tabs.find((o) => o.id === id);
        if (
          !tab ||
          (tab.name === status.name &&
            tab.dirty === status.dirty &&
            tab.busy === status.busy)
        )
          return tabs;
        return tabs.map((o) => (o.id === id ? { ...o, ...status } : o));
      });
    },
    [],
  );
  const openIds = JSON.stringify(openOperations.map((o) => o.id));
  useEffect(() => {
    try {
      localStorage.setItem(operationTabsKey, openIds);
    } catch {
      /* A restricted local store does not prevent using open editors. */
    }
  }, [openIds]);
  const finishClose = (id: string) => {
    const index = openOperations.findIndex((o) => o.id === id);
    const remaining = openOperations.filter((o) => o.id !== id);
    setOpenOperations((tabs) => tabs.filter((o) => o.id !== id));
    setClosingId(null);
    setCloseError("");
    if (location.area === "operation" && location.operationId === id) {
      const next = remaining[Math.min(index, remaining.length - 1)];
      if (next) openOperation(next.id);
      else setLocation(leaveOperation("Operations"));
    }
    setCatalogGeneration((n) => n + 1);
  };
  const requestClose = (id: string) => {
    const tab = openOperations.find((o) => o.id === id);
    const protection = session.protectionFor(id);
    if (
      !tab ||
      tab.busy ||
      protection.pending ||
      protection.editors.some((e) => e.busy)
    )
      return;
    if (tab.dirty || protection.editors.some((e) => e.dirty)) {
      setCloseError("");
      setClosingId(id);
    } else finishClose(id);
  };
  const saveAndClose = async () => {
    if (!closingId || closeBusy) return;
    setCloseBusy(true);
    setCloseError("");
    try {
      const editor = editors.current.get(closingId);
      if (!editor)
        throw Error("Operation editor is not ready. Please try again.");
      const unresolved = session
        .protectionFor(closingId)
        .editors.filter((e) => e.dirty && !e.primary);
      if (unresolved.length)
        throw Error(
          `Apply or discard these editor changes before saving and closing: ${unresolved.map((e) => e.name).join(", ")}.`,
        );
      await editor.save();
      finishClose(closingId);
    } catch (e) {
      setCloseError(editorError(e));
    } finally {
      setCloseBusy(false);
    }
  };
  useEffect(() => {
    if (!closingId) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeBusy) setClosingId(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [closingId, closeBusy]);
  const newOperationTrigger = useRef<HTMLElement | null>(null);
  const showNew = () => {
    newOperationTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    void run(async () => {
      const r = await desktop.workspace({ type: "doctrine-summaries" });
      setDoctrines(r.doctrines!);
      setDoctrineId(r.doctrines![0]?.id ?? "");
      setNewName("");
      setNewDemo(false);
      setNewProfile(null);
      setInitialize(false);
      setNewOpen(true);
    });
  };
  useEffect(() => {
    if (page === "Dashboard")
      desktop
        .workspace({ type: "dashboard" })
        .then((r) => setDashboard(r.dashboard!))
        .catch((e) => setError(editorError(e)));
  }, [page, generation, catalogGeneration]);
  useEffect(() => {
    if (page === "Operations")
      desktop
        .workspace({
          type: "browse-operations",
          query: { search, status, echelon: "", sort, offset, limit: 30 },
        })
        .then((r) => {
          setOperations(r.operations!.items);
          setTotal(r.operations!.total);
        })
        .catch((e) => setError(editorError(e)));
  }, [page, search, status, sort, offset, generation, catalogGeneration]);
  useEffect(() => {
    if (page === "Doctrines" && !doctrineState)
      desktop
        .execute({ type: "load" })
        .then(setDoctrineState)
        .catch((e) => setError(editorError(e)));
    if (page === "Settings" && !preferences)
      desktop
        .workspace({ type: "preferences" })
        .then((r) => {
          setPreferences(r.preferences!);
          setSavedPreferences(r.preferences!);
        })
        .catch((e) => setError(editorError(e)));
  }, [page, generation]);
  useEffect(() => {
    if (page === "Library")
      desktop
        .workspace({
          type: "library",
          query: {
            search: assetSearch,
            status: "",
            echelon: "",
            sort: "updated",
            offset: assetOffset,
            limit: 30,
          },
        })
        .then((r) => {
          setAssets(r.assets!.items);
          setAssetTotal(r.assets!.total);
        })
        .catch((e) => setError(editorError(e)));
  }, [page, assetSearch, assetOffset, generation, catalogGeneration]);
  const openedFile = useRef<typeof session.search.target>(null);
  useEffect(() => {
    const request = session.search.target;
    const target = request?.value;
    if (
      page !== "Library" ||
      target?.area !== "file" ||
      openedFile.current === request
    )
      return;
    openedFile.current = request;
    return focusSearchTarget(() =>
      document.querySelector<HTMLElement>(
        `[data-asset-id="${CSS.escape(target.assetId)}"]`,
      ),
    );
  }, [page, session.search.target?.nonce]);
  const nav = (
    <nav className="global-nav" aria-label="Global navigation">
      <button
        className="nav-item"
        onClick={() => setSearchOpen(true)}
        title="Search (Ctrl+K)"
      >
        ⌕ <span className="global-nav-label">Search</span>
      </button>
      {globalPages.map((p, i) =>
        p === "ORBATs" ? null : (
          <button
            key={p}
            className={`nav-item ${page === p || (p === "Military Symbols" && page === "ORBATs") ? "active" : ""}`}
            aria-label={p === "Military Symbols" ? "Symbols & ORBATs" : p}
            title={p === "Military Symbols" ? "Symbols & ORBATs" : p}
            onClick={() => navigate(p)}
          >
            <span aria-hidden="true">
              {["◈", "☷", "⊞", "▤", "◇", "⑂", "▦", "⚙"][i]}
            </span>
            <span className="global-nav-label">
              {p === "Military Symbols" ? "Symbols & ORBATs" : p}
            </span>
          </button>
        ),
      )}
      <section className="open-operations" aria-label="Open operations">
        <h2>
          Open operations <span>{openOperations.length}</span>
        </h2>
        {openOperations.length === 0 && (
          <p>Open an operation from the catalog to keep it here.</p>
        )}
        {openOperations.map((o) => (
          <div
            key={o.id}
            data-open-operation-id={o.id}
            className={`open-operation ${location.area === "operation" && location.operationId === o.id ? "active" : ""}`}
          >
            <button
              className="open-operation-name"
              aria-label={`Open operation: ${o.name}`}
              aria-current={
                location.area === "operation" && location.operationId === o.id
                  ? "page"
                  : undefined
              }
              title={`${o.name}${o.dirty ? " · Unsaved changes" : ""}`}
              onClick={() => openOperation(o.id)}
            >
              <span className="open-operation-label">{o.name}</span>
              {o.dirty && (
                <span className="operation-dirty" aria-label="Unsaved changes">
                  ●
                </span>
              )}
            </button>
            <button
              className="close-operation"
              disabled={o.busy}
              aria-label={`Close operation: ${o.name}`}
              title={`Close ${o.name}`}
              onClick={() => requestClose(o.id)}
            >
              ×
            </button>
          </div>
        ))}
      </section>
    </nav>
  );
  const operationRows = (rows: GlobalOperationSummary[]) =>
    rows.map((o) => (
      <div className="catalog-item-actions" key={o.id}>
        <button
          data-operation-id={o.id}
          className="browse-row"
          onClick={() => openOperation(o.id)}
        >
          <strong>{o.name}</strong>
          <span>
            {o.organization || "No organization selected"} · {o.doctrine}
          </span>
          <small>
            Revision {o.revision} · {o.status} ·{" "}
            {countLabel(o.publicationCount, "publication")} ·{" "}
            {countLabel(o.openReviews, "open review")} ·{" "}
            {new Date(o.updatedAt).toLocaleString()}
          </small>
        </button>
        {page === "Operations" && (
          <DeleteItemButton
            target={{ kind: "operation", id: o.id }}
            label="Delete"
            ariaLabel={`Delete operation: ${o.name}`}
            disabled={
              busy ||
              session.protectionFor(o.id).pending ||
              session.protectionFor(o.id).editors.some((e) => e.busy)
            }
            onDeleted={() => {
              if (
                session.recoveryTarget?.scope === o.id ||
                session.recoveryTarget?.id === o.id
              )
                session.recoveryTarget = null;
              finishClose(o.id);
            }}
          />
        )}
      </div>
    ));
  return (
    <>
      {searchOpen && (
        <SearchDialog
          operationId={
            location.area === "operation" ? location.operationId : null
          }
          onClose={() => setSearchOpen(false)}
          onOpen={(target, title) => {
            if (target.area === "operation") openOperation(target.operationId);
            else if (target.area === "catalog")
              navigate(
                (
                  {
                    ORGANIZATION: "Organizations",
                    DOCTRINE: "Doctrines",
                    SYMBOL: "Military Symbols",
                    ORBAT: "ORBATs",
                  } as const
                )[target.catalogKind],
              );
            else {
              setAssetSearch(title);
              setAssetOffset(0);
              navigate("Library");
            }
            session.search.open(target);
          }}
        />
      )}
      {openOperations.map((o) => (
        <div
          key={o.id}
          data-operation-editor={o.id}
          inert={!!closingOperation}
          hidden={
            location.area !== "operation" || location.operationId !== o.id
          }
        >
          <EditorScope id={o.id}>
            <App
              active={
                location.area === "operation" && location.operationId === o.id
              }
              operationId={o.id}
              requestPage={o.requestPage}
              requestNonce={o.requestNonce}
              globalNavigation={nav}
              onGlobal={navigate}
              onNewOperation={showNew}
              onSearch={() => setSearchOpen(true)}
              onOperation={openOperation}
              onEditorStatus={updateEditorStatus}
              editorRef={(handle) => {
                if (handle) editors.current.set(o.id, handle);
                else editors.current.delete(o.id);
              }}
            />
          </EditorScope>
        </div>
      ))}
      <BusyBoundary
        busy={busy}
        className="app-shell global-shell"
        inert={!!closingOperation || busy}
        hidden={location.area !== "global"}
      >
        <aside className="sidebar">
          <div className="global-brand">
            <b>ORDO</b>
            <span>Libertas Optima Rerum</span>
          </div>
          {nav}
          <div className="sidebar-bottom">
            <div className="offline">
              <span /> Offline workspace <ApplicationVersion />
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div>
              <span className="breadcrumb">ORDO / GLOBAL WORKSPACE</span>
              <h1>
                {page === "Military Symbols" || page === "ORBATs"
                  ? "Symbols & ORBATs"
                  : (page ?? "Dashboard")}
              </h1>
            </div>
          </header>
          {(error || message) && !newOpen && (
            <p
              role={error ? "alert" : "status"}
              className={`notice ${error ? "error" : "success"}`}
            >
              {error || message}
            </p>
          )}
          <main className="workspace global-workspace">
            {symbolsVisited && (
              <div hidden={page !== "Military Symbols" && page !== "ORBATs"}>
                <Suspense fallback={<p>Loading Symbols &amp; ORBATs…</p>}>
                  <SymbolsAndOrbatsWorkspace
                    active={page === "Military Symbols" || page === "ORBATs"}
                    requestedMode={page === "ORBATs" ? "ORBAT" : "SYMBOL"}
                  />
                </Suspense>
              </div>
            )}
            {page === "Dashboard" && (
              <>
                <WorkingCopies />
                <div className="dashboard-intro">
                  <div>
                    <span className="eyebrow">YOUR LOCAL WORKSPACE</span>
                    <h2>
                      {dashboard?.recentOperations.length
                        ? "Continue planning"
                        : "Welcome to Ordo"}
                    </h2>
                    <p>
                      Open a plan, maintain your organizations, or shape the
                      doctrine your team uses.
                    </p>
                  </div>
                  <div className="button-row">
                    <button className="primary" onClick={showNew}>
                      Create operation
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const result = await desktop.execute({
                            type: "create-testify-example",
                          });
                          openOperation(result.operation!.id);
                        })
                      }
                    >
                      Create Testify example
                    </button>
                    <button
                      onClick={() => {
                        navigate("Organizations");
                        setOrganizationNew((n) => n + 1);
                      }}
                    >
                      Create organization
                    </button>
                    <button onClick={() => navigate("Doctrines")}>
                      Create doctrine
                    </button>
                  </div>
                </div>
                {dashboard?.preferences.lastOpenedOperationId && (
                  <button
                    className="resume-banner"
                    onClick={() =>
                      openOperation(
                        dashboard.preferences.lastOpenedOperationId!,
                      )
                    }
                  >
                    Resume last operation →
                  </button>
                )}
                <div className="dashboard-grid">
                  <Panel title="Recent operations">
                    {dashboard && operationRows(dashboard.recentOperations)}
                    {!dashboard?.recentOperations.length && (
                      <p>Create an operation to begin planning.</p>
                    )}
                  </Panel>
                  <Panel title="Draft operations">
                    {dashboard && operationRows(dashboard.draftOperations)}
                    {!dashboard?.draftOperations.length && (
                      <p>No draft operations.</p>
                    )}
                  </Panel>
                  <Panel title="Recent publications">
                    {dashboard?.publications.map((p) => (
                      <button
                        className="browse-row"
                        key={p.id}
                        onClick={() =>
                          openOperation(p.operationId, "publications")
                        }
                      >
                        <strong>{p.name}</strong>
                        <span>
                          Publication {p.version} ·{" "}
                          {new Date(p.publishedAt).toLocaleString()}
                        </span>
                      </button>
                    ))}
                    {!dashboard?.publications.length && (
                      <p>No publications yet.</p>
                    )}
                  </Panel>
                  <Panel title="Open change reviews">
                    {dashboard?.reviews.map((r) => (
                      <button
                        className="browse-row"
                        key={r.id}
                        onClick={() => openOperation(r.operationId, "history")}
                      >
                        <strong>{r.title}</strong>
                        <span>{new Date(r.createdAt).toLocaleString()}</span>
                      </button>
                    ))}
                    {!dashboard?.reviews.length && <p>No open reviews.</p>}
                  </Panel>
                  <Panel title="Organizations">
                    {dashboard?.organizations.map((v) => (
                      <button
                        key={v.unitProfileVersionId}
                        className="browse-row"
                        onClick={() => navigate("Organizations")}
                      >
                        <strong>{v.name}</strong>
                        <span></span>
                      </button>
                    ))}
                    {!dashboard?.organizations.length && (
                      <p>Create a reusable organization and staff structure.</p>
                    )}
                  </Panel>
                  <Panel title="Doctrines">
                    {dashboard?.doctrines.map((v) => (
                      <button
                        key={v.id}
                        className="browse-row"
                        onClick={() => navigate("Doctrines")}
                      >
                        <strong>{v.name}</strong>
                        <span></span>
                      </button>
                    ))}
                  </Panel>
                </div>
              </>
            )}
            {page === "Operations" && (
              <Panel
                title="Operations"
                subtitle="Open a saved operation to continue planning. Each operation keeps its own units, order content, and chosen doctrine."
                action={<button onClick={showNew}>Create operation</button>}
              >
                <div className="browse-filters">
                  <Field
                    label="Search operations"
                    value={search}
                    onChange={(v) => {
                      setSearch(v);
                      setOffset(0);
                    }}
                  />
                  <Field
                    label="Workflow status filter"
                    value={status}
                    onChange={(v) => {
                      setStatus(v);
                      setOffset(0);
                    }}
                  />
                  <label className="field">
                    <span>Sort operations</span>
                    <select
                      aria-label="Sort operations"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as typeof sort)}
                    >
                      <option value="updated">Last modified</option>
                      <option value="name">Name</option>
                    </select>
                  </label>
                </div>
                {operationRows(operations)}
                {!operations.length && <p>No operations match your search.</p>}
                <div className="button-row">
                  <button
                    disabled={!offset}
                    onClick={() => setOffset((v) => v - 30)}
                  >
                    Previous operations
                  </button>
                  <span>{countLabel(total, "operation")}</span>
                  <button
                    disabled={offset + 30 >= total}
                    onClick={() => setOffset((v) => v + 30)}
                  >
                    Next operations
                  </button>
                </div>
              </Panel>
            )}
            {organizationVisited && (
              <div hidden={page !== "Organizations"}>
                <OrganizationWorkspace
                  key={generation}
                  active={page === "Organizations"}
                  newRequest={organizationNew}
                />
              </div>
            )}
            {doctrineState && (
              <div hidden={page !== "Doctrines"}>
                <DoctrineBuilder
                  key={generation}
                  state={doctrineState}
                  onState={setDoctrineState}
                />
              </div>
            )}
            {page === "Library" && (
              <Panel
                title="Files and images"
                subtitle="Files attached to operations, doctrines, and organizations. Preview them or save a copy."
              >
                <Field
                  label="Search files"
                  value={assetSearch}
                  onChange={(v) => {
                    setAssetSearch(v);
                    setAssetOffset(0);
                  }}
                />
                {assets.map((a) => (
                  <div
                    className="browse-row"
                    key={a.assetId}
                    data-asset-id={a.assetId}
                    tabIndex={-1}
                  >
                    <strong>{a.originalFilename}</strong>
                    <span>
                      {a.mimeType} · {a.sizeBytes.toLocaleString()} bytes ·{" "}
                      {a.unitProfileVersionId
                        ? "Organization"
                        : a.operationId
                          ? "Operation"
                          : "Doctrine"}
                    </span>
                    <details>
                      <summary>File details</summary>
                      <small>
                        ID: {a.assetId} · SHA-256 {a.sha256}
                      </small>
                    </details>
                    <div className="button-row">
                      <DeleteItemButton
                        target={{ kind: "asset", id: a.assetId }}
                        label="Delete file"
                        disabled={busy}
                        onDeleted={() => {
                          setAssetPreview("");
                          setCatalogGeneration((n) => n + 1);
                        }}
                      />
                      {a.mimeType.startsWith("image/") && (
                        <button
                          onClick={() =>
                            run(async () => {
                              setAssetPreview(
                                (
                                  await desktop.files({
                                    type: "asset-preview",
                                    assetId: a.assetId,
                                  })
                                )?.data ?? "",
                              );
                            })
                          }
                        >
                          Preview image
                        </button>
                      )}
                      <button
                        onClick={() =>
                          run(async () => {
                            await desktop.files({
                              type: "asset-save",
                              assetId: a.assetId,
                            });
                          })
                        }
                      >
                        Save a copy
                      </button>
                    </div>
                  </div>
                ))}
                {!assets.length && (
                  <p>
                    No files found. Add files from an operation, doctrine, or
                    organization, or change your search.
                  </p>
                )}
                <div className="button-row">
                  <button
                    disabled={!assetOffset}
                    onClick={() => setAssetOffset((v) => v - 30)}
                  >
                    Previous files
                  </button>
                  <span>{countLabel(assetTotal, "file")}</span>
                  <button
                    disabled={assetOffset + 30 >= assetTotal}
                    onClick={() => setAssetOffset((v) => v + 30)}
                  >
                    Next files
                  </button>
                </div>
                {assetPreview && (
                  <div>
                    <img
                      className="asset-preview"
                      src={assetPreview}
                      alt="Image preview"
                    />
                    <button onClick={() => setAssetPreview("")}>
                      Close preview
                    </button>
                  </div>
                )}
              </Panel>
            )}
            {page === "Settings" && preferences && (
              <>
                <ThemeSettings />
                {preferencesRecovery}
                <Panel
                  title="Local preferences"
                  subtitle="These preferences apply to Ordo on this computer."
                >
                  <Field
                    label="Planner name"
                    value={preferences.localActor ?? "Local planner"}
                    onChange={(v) =>
                      setPreferences({ ...preferences, localActor: v })
                    }
                  />
                  <label className="field">
                    <span>Time display</span>
                    <select
                      aria-label="Time display"
                      value={preferences.timeDisplay}
                      onChange={(e) =>
                        setPreferences({
                          ...preferences,
                          timeDisplay: e.target.value as "utc" | "local",
                        })
                      }
                    >
                      <option value="utc">UTC</option>
                      <option value="local">Local time</option>
                    </select>
                  </label>
                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={() =>
                        run(async () => {
                          const current = await desktop.workspace({
                            type: "preferences",
                          });
                          const result = await desktop.workspace({
                            type: "preferences",
                            preferences: {
                              ...current.preferences!,
                              localActor: preferences.localActor,
                              timeDisplay: preferences.timeDisplay,
                            },
                          });
                          setPreferences(result.preferences!);
                          setSavedPreferences(result.preferences!);
                          setMessage(
                            "Preferences saved. New history entries will use this planner name.",
                          );
                        })
                      }
                    >
                      Save preferences
                    </button>
                    <button
                      onClick={() => setPreferences(savedPreferences)}
                      disabled={
                        JSON.stringify(preferences) ===
                        JSON.stringify(savedPreferences)
                      }
                    >
                      Discard preference changes
                    </button>
                  </div>
                </Panel>
                <Panel
                  title="Local backup & restore"
                  subtitle="Backups include saved work and available recovery copies. Save your edits before backing up or transferring your workspace."
                >
                  <div className="button-row">
                    <button
                      onClick={() =>
                        run(async () => {
                          const path = await desktop.backup();
                          if (path) setMessage(`Backup saved: ${path}`);
                        })
                      }
                    >
                      Back up workspace
                    </button>
                    <button
                      onClick={() =>
                        run(async () => {
                          const next = await desktop.restore();
                          if (next) {
                            setGeneration((n) => n + 1);
                            setOpenOperations([]);
                            setDoctrineState(null);
                            setOrganizationVisited(false);
                            setOrganizationNew(0);
                            setLocation(startupLocation());
                            setMessage(
                              "Workspace restored. A recovery backup of the previous workspace was retained.",
                            );
                          }
                        })
                      }
                    >
                      Restore backup
                    </button>
                  </div>
                </Panel>
                <WorkspaceStorage />
              </>
            )}
          </main>
          <footer className="statusbar">
            <span>Local storage · Offline ready</span>
            <span>Ordo · Global workspace</span>
          </footer>
        </div>
      </BusyBoundary>
      {closingOperation && (
        <ModalBackdrop>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-operation-title"
          >
            <h2 id="close-operation-title">Close {closingOperation.name}?</h2>
            <p>
              This operation workspace has unsaved edits. The saved operation
              will remain in the Operations catalog.
            </p>
            {closeError && <p role="alert">{closeError}</p>}
            <div className="button-row">
              <button
                data-dialog-cancel
                autoFocus
                disabled={closeBusy}
                onClick={() => setClosingId(null)}
              >
                Cancel
              </button>
              <button
                disabled={closeBusy}
                onClick={() => {
                  setCloseBusy(true);
                  void desktop
                    .recovery({
                      type: "discard-session",
                      scope: closingOperation.id,
                    })
                    .then(() => finishClose(closingOperation.id))
                    .catch((e) => setCloseError(editorError(e)))
                    .finally(() => setCloseBusy(false));
                }}
              >
                Discard changes and close
              </button>
              <button
                className="primary"
                disabled={closeBusy}
                onClick={() => void saveAndClose()}
              >
                {closeBusy ? "Saving…" : "Save and close"}
              </button>
            </div>
          </section>
        </ModalBackdrop>
      )}
      {newOpen && (
        <ModalBackdrop returnFocus={newOperationTrigger.current}>
          <form
            className="modal create-operation"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const d = doctrines.find((d) => d.id === doctrineId);
                if (!d) throw Error("Choose a doctrine");
                const r = await desktop.execute({
                  type: "create",
                  name: newName,
                  demo: newDemo,
                  configuration: d.configuration,
                  ...(newProfile
                    ? {
                        unitProfileVersionId: newProfile.unitProfileVersionId,
                        initializeTaskOrganization: initialize,
                      }
                    : {}),
                });
                setNewOpen(false);
                openOperation(r.operation!.id);
              });
            }}
          >
            <span className="eyebrow">NEW OPERATION</span>
            <h2>Create an operation</h2>
            <Field
              label="New operation name"
              value={newName}
              onChange={setNewName}
            />
            <div className="selection-preview">
              <strong>Organization</strong>
              <p>
                {newProfile
                  ? newProfile.identity.fullDesignation
                  : "No organization selected"}
              </p>
              <div className="button-row">
                <button type="button" onClick={() => setPicker(true)}>
                  Choose organization
                </button>
                {newProfile && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewProfile(null);
                      setInitialize(false);
                    }}
                  >
                    No organization selected
                  </button>
                )}
              </div>
            </div>
            <label className="field">
              <span>Doctrine</span>
              <select
                aria-label="Doctrine"
                value={doctrineId}
                onChange={(e) => setDoctrineId(e.target.value)}
              >
                {doctrines.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {newProfile?.defaultDoctrine && (
              <p className="hint">
                Organization recommendation:{" "}
                {doctrines.find(
                  (d) => d.id === newProfile.defaultDoctrine!.doctrineVersionId,
                )?.name ?? "Unavailable"}
                . You may choose another doctrine.
              </p>
            )}
            {newProfile && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={initialize}
                  onChange={(e) => {
                    setInitialize(e.target.checked);
                    if (e.target.checked) setNewDemo(false);
                  }}
                />
                Add this organization and its subordinate units to Task
                organization
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={newDemo}
                onChange={(e) => {
                  setNewDemo(e.target.checked);
                  if (e.target.checked) {
                    setInitialize(false);
                    if (!newName) setNewName("DEMO OPERATION");
                  }
                }}
              />
              Include clearly labeled fictional demo data
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="button-row">
              <button
                data-dialog-cancel
                type="button"
                onClick={() => setNewOpen(false)}
              >
                Cancel
              </button>
              <button className="primary" disabled={!newName.trim() || busy}>
                Create operation
              </button>
            </div>
          </form>
        </ModalBackdrop>
      )}
      {picker && (
        <UnitProfilePicker
          title="Choose organization"
          onCancel={() => setPicker(false)}
          onSelect={(v) => {
            setNewProfile(v);
            setPicker(false);
            if (
              v.defaultDoctrine &&
              doctrines.some(
                (d) => d.id === v.defaultDoctrine!.doctrineVersionId,
              )
            )
              setDoctrineId(v.defaultDoctrine.doctrineVersionId);
          }}
        />
      )}
    </>
  );
}
