import { UnitTasks } from "./UnitTasks";
import { OverviewInspector } from "./OverviewInspector";
import { DocumentLayoutEditor } from "./DocumentLayoutEditor";
import { ModalBackdrop } from "./ModalBackdrop";
import { DeleteItemButton } from "./DeleteItemButton";
import { createExportProfile } from "../../domain/factories";
import {
  BusyBoundary,
  useWorkspaceApi,
  useEditorProtection,
  useUnappliedSymbolEdits,
  unappliedSymbolMessage,
  ApplicationVersion,
} from "./WorkspaceContext";
import {
  GraphicalProductPreview,
  type GraphicalPreviewProps,
} from "./GraphicalProductPreview";
import { Field, Select, Checks, Panel, Icon } from "./Fields";
import {
  useEffect,
  useState,
  useMemo,
  useRef,
  useImperativeHandle,
  lazy,
  Suspense,
  type ReactNode,
  type Ref,
} from "react";
import type {
  OperationEditorHandle,
  OperationEditorStatus,
} from "./operation-tabs";
import type { DesktopApi } from "../../application/bridge";
import type { AppState, Command } from "../../application/service";
import {
  metadata,
  cardFields,
  type Operation,
  type ExportProfile,
  type Attachment,
} from "../../domain/model";
import { canonical } from "../../export/projection";
import {
  projectConnectedPreview as projectReadableOrder,
  cardDocumentCss,
  hasPlanningBlocks,
} from "../../export/planning-cards";
import { catalogNodes } from "../../domain/authoring";
import { orderProgress } from "./order-progress";
import { PlanningTimeline } from "./PlanningTimeline";
import { newEventSchedule } from "../../domain/planning-schedule";
import { WhiteboardWorkspace } from "./WhiteboardWorkspace";
import { WordExportHistory } from "./WordExportHistory";
import {
  ExportFileControls,
  type ExportFileFormat,
} from "./ExportFileControls";
import type { PaperOptions } from "../../domain/document-exports";
import { PlanningProgress } from "./PlanningProgress";
import { refreshPlanningReadiness } from "../../domain/planning-progress";
import {
  DoctrineTree,
  DoctrineProduct,
  BaseAuthoring,
  PackageComposer,
  displayProductCode,
} from "./DoctrineWorkspace";
import { newDocumentLayout } from "../../domain/document-layout";
import { renderDocumentHtml } from "../../export/document-layout-html";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { ModuleWorkspace } from "./ModuleWorkspace";
import { templateFor } from "../../export/templates";
import { validate } from "../../validation/engine";
import { UnitProfilePicker } from "./UnitProfilePicker";
import { ResponsibleStaff } from "./ResponsibleStaff";
import type { UnitProfile } from "../../domain/unit-profiles";
import type { GlobalPage } from "../../domain/workspace-navigation";
import { useDraftHistory } from "./useDraftHistory";
import { useWorkingCopy, useRecoveryOpen } from "./WorkingCopies";
import { DocumentOutput } from "./DocumentOutput";
import { findingLocation } from "./validation-navigation";
import {
  focusSearchTarget,
  useOperationSearch,
  useSearchOpen,
} from "./SearchProvider";
import { searchLocation } from "./search-navigation";
import { removedCardSources } from "../../domain/planning-card-actions";
import { CardSourceDeletion } from "./CardSourceDeletion";
import {
  deleteOperationUnit,
  reparentOperationUnit,
} from "../../domain/organization-actions";
declare global {
  interface Window {
    ordo: DesktopApi;
  }
}
type Page =
  | "history"
  | "builder"
  | "overview"
  | "base"
  | "units"
  | "tasks"
  | "phases"
  | "events"
  | "progress"
  | "whiteboards"
  | "signal"
  | "exports"
  | "publications"
  | "validation"
  | "settings"
  | "doctrine"
  | "package"
  | "attachment";
const uid = () => crypto.randomUUID();
const OperationSymbolEditor = lazy(() => import("./OperationSymbolEditor"));
const OperationOrbatPanel = lazy(() => import("./OperationOrbatPanel"));
const titles: Record<Page, string> = {
  history: "History & changes",
  builder: "Doctrine Builder",
  overview: "Operation overview",
  base: "Base order",
  units: "Task organization",
  tasks: "Tasks & objectives",
  phases: "Operational phases",
  events: "Timeline",
  progress: "Planning progress",
  whiteboards: "Planning whiteboard",
  signal: "Signal workspace",
  exports: "Export studio",
  publications: "Publication history",
  validation: "Validation",
  settings: "Configuration",
  attachment: "Attachment",
  doctrine: "Doctrine product",
  package: "Package composer",
};
export function App({
  active,
  operationId,
  requestPage = "overview",
  onSearch,
  requestNonce = 0,
  globalNavigation,
  onGlobal,
  onNewOperation,
  onOperation,
  editorRef,
  onEditorStatus,
}: {
  active: boolean;
  operationId: string;
  requestPage?: string;
  onSearch: () => void;
  requestNonce?: number;
  globalNavigation: ReactNode;
  onGlobal: (page: GlobalPage) => void;
  onNewOperation: () => void;
  onOperation: (id: string) => void;
  editorRef: Ref<OperationEditorHandle>;
  onEditorStatus: (id: string, status: OperationEditorStatus) => void;
}) {
  const requestedPage = Object.hasOwn(titles, requestPage)
    ? (requestPage as Page)
    : "overview";
  const desktop = useWorkspaceApi();
  const unapplied = useUnappliedSymbolEdits();
  const workspaceRef = useRef<HTMLElement>(null);
  const [profilePicker, setProfilePicker] = useState(false),
    [importProfile, setImportProfile] = useState<UnitProfile | null>(null),
    [importSubtree, setImportSubtree] = useState(false),
    [confirmDuplicate, setConfirmDuplicate] = useState(false),
    [importId, setImportId] = useState("");
  const [findingTarget, setFindingTarget] = useState<{
    page: string;
    id: string;
    anchor: string;
    label: string;
    timelineItem?: { moduleId: string; itemId: string };
  } | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [cardDeletion, setCardDeletion] = useState<{
    before: Operation;
    after: Operation;
  } | null>(null);
  const draftHistory = useDraftHistory<Operation | null>(null),
    op = draftHistory.value,
    setOp = draftHistory.replace;
  useOperationSearch(
    op,
    state?.config,
    state?.operation ?? undefined,
    state?.cardOrigins,
  );
  useSearchOpen(
    "operation",
    (target) => {
      if (
        target.area !== "operation" ||
        target.operationId !== op?.id ||
        !state
      )
        return;
      if (unapplied) {
        setError(unappliedSymbolMessage);
        return;
      }
      const destination = searchLocation(target, op, state.config);
      navigate(destination.page as Page, destination.id);
      setFindingTarget(destination);
    },
    !!op && !!state,
  );
  const [unitView, setUnitView] = useState<"TREE" | "ORBAT">("TREE");
  const [page, setPage] = useState<Page>("overview"),
    [symbolUnitId, setSymbolUnitId] = useState(""),
    [selectedId, setSelectedId] = useState(""),
    [mode, setMode] = useState<"edit" | "preview">("edit");
  const [latestWordId, setLatestWordId] = useState("");
  const [profile, setProfile] = useState<ExportProfile | null>(null),
    [sourcePublication, setSourcePublication] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!unapplied)
      setError((current) =>
        current === unappliedSymbolMessage ? "" : current,
      );
  }, [unapplied]);
  const [newOpen, setNewOpen] = useState(false),
    [newName, setNewName] = useState(""),
    [newDemo, setNewDemo] = useState(false);
  const [newConfiguration, setNewConfiguration] = useState("");
  const [workspaceGeneration, setWorkspaceGeneration] = useState(0);
  const [publishedPreview, setPublishedPreview] = useState(""),
    [recordPreview, setRecordPreview] = useState(""),
    [approvalNote, setApprovalNote] = useState("");
  const navigationKey = ["attachment", "doctrine"].includes(page)
    ? `${page}:${selectedId}`
    : page;
  useEffect(() => {
    workspaceRef.current?.scrollTo({ top: 0 });
  }, [navigationKey]);
  useEffect(() => {
    if (!findingTarget) return;
    return focusSearchTarget(
      () => {
        const root = workspaceRef.current;
        if (!root) return;
        const anchors = [
          ...root.querySelectorAll<HTMLElement>(findingTarget.anchor),
        ].filter((e) => e.getClientRects().length);
        const anchor =
          findingTarget.page === "tasks"
            ? anchors.find((e) => e.querySelector(".task-record-editor"))
            : (anchors[0] ?? (findingTarget.timelineItem ? undefined : root));
        if (!anchor) return;
        const controls = [
          ...anchor.querySelectorAll<HTMLElement>(
            'input,textarea,select,[contenteditable="true"]',
          ),
        ].filter((e) => e.getClientRects().length);
        const control =
          controls.find(
            (e) => e.getAttribute("aria-label") === findingTarget.label,
          ) ??
          [
            ...anchor.querySelectorAll<HTMLFieldSetElement>(
              "fieldset[aria-label]",
            ),
          ]
            .find(
              (e) =>
                e.getAttribute("aria-label") === findingTarget.label &&
                e.getClientRects().length,
            )
            ?.querySelector<HTMLElement>("input,select,textarea") ??
          controls[0];
        return control;
      },
      () => setFindingTarget(null),
    );
  }, [findingTarget, navigationKey]);
  const accept = (next: AppState, keepProfile = true) => {
    setState(next);
    setOp(next.operation);
    if (!keepProfile || !profile || profile.operationId !== next.operation?.id)
      setProfile(
        next.profiles.find((p) => p.product === "communications-card") ??
          next.profiles[0] ??
          null,
      );
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    desktop
      .execute({ type: "load", operationId })
      .then((next) => {
        if (cancelled) return;
        setState(next);
        setOp(next.operation);
        setProfile(
          next.profiles.find((p) => p.product === "communications-card") ??
            next.profiles[0] ??
            null,
        );
        setPage(requestedPage);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (active)
      desktop
        .workspace({ type: "preferences" })
        .then((r) =>
          setState((s) => (s ? { ...s, preferences: r.preferences! } : s)),
        )
        .catch((e) => setError(String(e)));
  }, [active]);
  const dirty = useMemo(
    () =>
      !!op &&
      !!state?.operation &&
      canonical(op) !== canonical(state.operation),
    [op, state?.operation],
  );
  const profileDirty = useMemo(
    () =>
      !!profile &&
      canonical(profile) !==
        canonical(state?.profiles.find((p) => p.id === profile.id)),
    [profile, state?.profiles],
  );
  useEffect(() => {
    if (!active || !state || dirty || profileDirty || unapplied || busy) return;
    // Returning from catalog editors refreshes compatible doctrine and staff changes.
    // Unsaved editors are left intact and adopt changes after their next save.
    void run(async () => {
      accept(await desktop.execute({ type: "load", operationId }));
    });
  }, [active]);
  const operationRecovery = useWorkingCopy({
    kind: "operation",
    id: state?.operation?.id,
    scope: operationId,
    label: state?.operation?.name ?? "Operation",
    source: state?.operation ?? null,
    value: op,
    dirty,
    busy: busy || unapplied,
    apply: setOp,
  });
  const profileRecovery = useWorkingCopy({
    kind: "export-profile",
    id: profile?.id,
    scope: operationId,
    label: profile?.name ?? "Export profile",
    source: state?.profiles.find((p) => p.id === profile?.id) ?? null,
    value: profile,
    dirty: profileDirty,
    busy,
    apply: setProfile,
  });
  useRecoveryOpen(
    "export-profile",
    (d) => {
      if (d.scope === operationId && state && !profileDirty) {
        setProfile(state.profiles.find((p) => p.id === d.id) ?? null);
        setPage("exports");
      }
    },
    !!state,
  );
  useEditorProtection({
    name: op?.name || "Operation",
    dirty: dirty || profileDirty,
    busy,
    primary: true,
  });
  useEffect(() => {
    onEditorStatus(operationId, {
      name:
        op?.name ||
        (error && !state ? "Operation unavailable" : "Opening operation…"),
      dirty: dirty || profileDirty,
      busy: busy || (!state && !error),
    });
  }, [
    operationId,
    op?.name,
    dirty,
    profileDirty,
    busy,
    !!state,
    !!error,
    onEditorStatus,
  ]);

  const change = (edit: (draft: Operation) => void) => {
    if (!op) return;
    try {
      const draft = structuredClone(op);
      edit(draft);
      commitOperation(draft);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const commitOperation = (next: Operation) => {
    if (op) next = refreshPlanningReadiness(op, next, state?.config);
    if (op && removedCardSources(op, next).length)
      setCardDeletion({ before: op, after: next });
    else draftHistory.commit(next);
  };
  const organizationChange = (fn: () => Operation) => {
    try {
      commitOperation(fn());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const changeProfile = (edit: (draft: ExportProfile) => void) => {
    setRecordPreview("");
    setProfile((current) => {
      if (!current) return current;
      const draft = structuredClone(current);
      edit(draft);
      return draft;
    });
  };
  const taskOrganizationNode = state
    ? catalogNodes(state.config).find(
        (n) =>
          n.status === "ACTIVE" &&
          (n.editorHint === "TASK_ORGANIZATION_TREE" ||
            n.formatType === "TASK_ORGANIZATION" ||
            state.config.doctrine.modules?.layouts.some(
              (l) =>
                l.productId === n.id &&
                l.definitions.some((d) => d.moduleType === "TASK_ORGANIZATION"),
            )),
      )
    : undefined;
  const taskOrganizationAttachment = op?.attachments.find((a) =>
    state?.config.doctrine.annexCatalog.some(
      (c) => c.id === a.catalogId && c.editor === "task-organization",
    ),
  );
  const taskOrganizationDestination = taskOrganizationNode
    ? { page: "doctrine" as const, id: taskOrganizationNode.id }
    : taskOrganizationAttachment
      ? { page: "attachment" as const, id: taskOrganizationAttachment.id }
      : null;
  useEffect(() => {
    if (page === "units" && taskOrganizationDestination) {
      setPage(taskOrganizationDestination.page);
      setSelectedId(taskOrganizationDestination.id);
    }
  }, [
    page,
    taskOrganizationDestination?.page,
    taskOrganizationDestination?.id,
  ]);
  const navigate = (next: Page, id = "") => {
    if (unapplied) {
      setError(unappliedSymbolMessage);
      return;
    }
    const destination = next === "units" ? taskOrganizationDestination : null;
    setPage(destination?.page ?? next);
    setSelectedId(destination?.id ?? id);
    setMode("edit");
    setRecordPreview("");
    setPublishedPreview("");
  };
  const save = async () => {
    if (unapplied) throw Error(unappliedSymbolMessage);
    if (!op || !state?.operation) throw Error("No operation open");
    if (!dirty) return state;
    const next = await desktop.execute({
      type: "save",
      operation: op,
      expectedRevision: state.operation.revision,
    });
    accept(next);
    return next;
  };
  const doCommand = async (command: Command, note: string) => {
    const next = await desktop.execute(command);
    accept(next);
    setMessage(note);
    return next;
  };
  const saveAll = async () => {
    let next = await save();
    if (profile && profileDirty) {
      next = await desktop.execute({
        type: "save-profile",
        profile,
        isNew: false,
      });
      accept(next);
      setProfile(next.profiles.find((p) => p.id === profile.id) ?? null);
    }
    return next;
  };
  const exportWord = async (
    exportId: string,
    expectedRevision: number,
    options: PaperOptions,
  ) => {
    const { record } = await desktop.office({
      type: "generate",
      operationId,
      expectedRevision,
      source: { kind: "order", exportId, options },
    });
    if (!record) throw Error("Word export could not be created.");
    try {
      const { path } = await desktop.office({ type: "save", id: record.id });
      setMessage(
        path
          ? `Saved ${path}`
          : "Your Word file is available under Saved Word exports.",
      );
    } finally {
      setLatestWordId(record.id);
    }
  };
  const generateExport = async (
    format: ExportFileFormat,
    options: PaperOptions,
  ) => {
    if (!profile) return;
    const current = await saveAll();
    const savedProfile = current.profiles.find((p) => p.id === profile.id)!;
    const next = await desktop.execute({
      type: "generate",
      operationId,
      expectedRevision: current.operation!.revision,
      profileRef: { id: savedProfile.id, version: savedProfile.version },
      publicationId: sourcePublication || null,
    });
    const exportId = next.exports[0].id;
    try {
      if (format === "DOCX") {
        await exportWord(exportId, next.operation!.revision, options);
      } else if (format === "PDF") {
        const { record } = await desktop.documents({
          type: "generate",
          operationId,
          exportId,
          options,
        });
        if (!record) throw Error("PDF could not be created.");
        const { path } = await desktop.documents({
          type: "save",
          id: record.id,
        });
        setMessage(
          path
            ? `Saved ${path}`
            : "Your PDF is available under Generated products.",
        );
      } else {
        setMessage(
          "Export created. Its source and settings have been saved with it.",
        );
      }
    } finally {
      accept(next);
      setRecordPreview(exportId);
    }
  };
  useImperativeHandle(editorRef, () => ({
    save: async () => {
      setBusy(true);
      try {
        await saveAll();
      } finally {
        setBusy(false);
      }
    },
  }));
  useEffect(() => {
    if (requestNonce) navigate(requestedPage);
  }, [requestNonce]);
  const newEntity = (
    kind: "unit" | "phase" | "objective" | "task" | "event" | "net" | "pace",
    { unitId = null, laneId }: { unitId?: string | null; laneId?: string } = {},
  ) => {
    const id = uid();
    change((d) => {
      const common = {
        id,
        name: `New ${kind}`,
        metadata: metadata(state!.config.doctrine.editingStatus),
      };
      if (kind === "unit")
        d.units.push({
          ...common,
          parentUnitId: null,
          inTaskOrganization: true,
        });
      if (kind === "phase")
        d.phases.push({ ...common, sequence: d.phases.length + 1 });
      if (kind === "objective")
        d.objectives.push({ ...common, description: "" });
      if (kind === "task")
        d.tasks.push({
          ...common,
          unitId,
          objectiveId: null,
          phaseId: null,
          purpose: "",
        });
      if (kind === "event")
        d.events.push({
          ...common,
          ...(laneId ? { schedule: { ...newEventSchedule(), laneId } } : {}),
          at: null,
          relativeToEventId: null,
          offsetMinutes: 0,
          phaseId: null,
        });
      if (kind === "net")
        d.signal.nets.push({
          ...common,
          purpose: "",
          participantUnitIds: [],
          phaseIds: [],
          system: "",
          channel: "",
          callsign: "",
        });
      if (kind === "pace")
        d.signal.pacePlans.push({
          ...common,
          unitIds: [],
          phaseIds: [],
          primary: "",
          alternate: "",
          contingency: "",
          emergency: "",
          lostCommunications: "",
        });
    });
    if (page !== "doctrine" && page !== "attachment") setSelectedId(id);
    return id;
  };
  const addAttachment = (parent: Attachment | null, catalogId?: string) => {
    if (!op || !state) return;
    const id = uid(),
      catalog = state.config.doctrine.annexCatalog.find(
        (c) => c.id === catalogId,
      );
    const kind = parent
      ? (
          {
            annex: "appendix",
            appendix: "tab",
            tab: "exhibit",
            exhibit: null,
          } as const
        )[parent.kind]
      : "annex";
    if (!kind) return;
    const siblings = op.attachments.filter(
      (a) => a.parentId === (parent?.id ?? op.orderId),
    );
    let code = catalog?.code ?? String(siblings.length + 1);
    while (siblings.some((s) => s.code === code)) code += "+";
    change((d) =>
      d.attachments.push({
        id,
        kind,
        parentId: parent?.id ?? d.orderId,
        name: catalog?.title ?? `New ${kind}`,
        code,
        catalogId: catalog?.id ?? null,
        narrative: "",
        phaseIds: [],
        unitIds: [],
        required: false,
        metadata: {
          ...metadata(state.config.doctrine.editingStatus),
          ownerId: catalog?.ownerId ?? null,
        },
      }),
    );
    navigate("attachment", id);
  };
  const remove = (
    collection:
      | "units"
      | "tasks"
      | "phases"
      | "objectives"
      | "events"
      | "nets"
      | "pacePlans",
    id: string,
  ) => {
    if (collection === "units" && unapplied) {
      setError(unappliedSymbolMessage);
      return;
    }
    if (collection === "units" && op && state) {
      organizationChange(() => deleteOperationUnit(op, id, state.config));
      return;
    }
    change((d) => {
      if (collection === "nets" || collection === "pacePlans")
        d.signal[collection] = d.signal[collection].filter(
          (v) => v.id !== id,
        ) as never;
      else d[collection] = d[collection].filter((v) => v.id !== id) as never;
      if (page !== "doctrine" && page !== "attachment") setSelectedId("");
    });
  };
  const findings = useMemo(
    () =>
      op && state
        ? [
            ...validate(op, state.config),
            ...state.findings.filter((f) => f.ruleId === "managed-asset"),
          ]
        : [],
    [op, state?.config, state?.findings],
  );
  const attachment = op?.attachments.find((a) => a.id === selectedId);
  const doctrineNode = state
    ? catalogNodes(state.config).find((n) => n.id === selectedId)
    : undefined;
  const attachmentEditor = state?.config.doctrine.annexCatalog.find(
    (c) => c.id === attachment?.catalogId,
  )?.editor;
  const source = state?.publications.find((p) => p.id === sourcePublication);
  const displayTime = (time: string) =>
    state?.preferences.timeDisplay === "local"
      ? new Date(time).toLocaleString()
      : new Date(time).toISOString().replace("T", " ").slice(0, 19) + "Z";
  const needsPreview =
    active &&
    (page === "exports"
      ? !state?.exports.some((entry) => entry.id === recordPreview)
      : mode === "preview" &&
        ["base", "attachment", "doctrine", "package"].includes(page));
  const { previewJob, preview, previewError } = useMemo(() => {
    let previewJob: GraphicalPreviewProps | undefined;
    let preview = "",
      previewError = "";
    if (needsPreview && op && state) {
      try {
        let chosen = profile;
        if (page !== "exports") {
          const full = state.profiles.find((p) => p.product === "opord");
          chosen = full
            ? {
                ...full,
                inclusion: {
                  ...full.inclusion,
                  paragraphIds: op.sections.map((s) => s.id),
                  attachmentIds: op.attachments.map((a) => a.id),
                  ...(op.schemaVersion === 2
                    ? { packageScope: "included" as const }
                    : {}),
                },
              }
            : null;
        }
        if (chosen) {
          const view = (
            page === "doctrine"
              ? projectReadableOrder(op, chosen, state.config, doctrineNode?.id)
              : projectReadableOrder(
                  page === "exports" && source ? source.snapshot : op,
                  chosen,
                  page === "exports" && source ? source.config : state.config,
                )
          ).view;
          const provenance = `${source && page === "exports" ? `Publication v${source.version}` : dirty ? "UNSAVED PLANNING PREVIEW" : "LIVE PLANNING PREVIEW"} · revision ${source && page === "exports" ? source.sourceRevision : op.revision} · ${chosen.name} v${chosen.version}${profileDirty && page === "exports" ? " (unsaved settings)" : ""}`;
          if (view.sections.some((s) => "graphic" in s && s.graphic))
            previewJob = {
              view,
              provenance,
              template: templateFor(chosen.product),
              assets: state.assetPreviews,
              layout:
                (page === "exports" && source ? source.snapshot : op).metadata
                  .documentLayout ??
                (hasPlanningBlocks(op) ? newDocumentLayout() : undefined),
            };
          else
            preview = renderDocumentHtml(
              view,
              provenance,
              templateFor(chosen.product),
              state.assetPreviews,
              [],
              (page === "exports" && source ? source.snapshot : op).metadata
                .documentLayout ??
                (hasPlanningBlocks(
                  page === "exports" && source ? source.snapshot : op,
                )
                  ? newDocumentLayout()
                  : undefined),
            );
        }
      } catch (e) {
        previewError = String(e);
      }
    }
    return {
      previewJob,
      preview: preview.replace("</head>", cardDocumentCss + "</head>"),
      previewError,
    };
  }, [
    needsPreview,
    op,
    profile,
    state?.config,
    state?.profiles,
    state?.assetPreviews,
    source,
    page,
    doctrineNode,
    dirty,
    profileDirty,
  ]);
  const frame = (html: string, label = "Product preview") => (
    <iframe className="document-frame" title={label} srcDoc={html} sandbox="" />
  );
  const entityHeader = (title: string, action: ReactNode) => (
    <div className="entity-heading">
      <h3>{title}</h3>
      {action}
    </div>
  );
  const unitEditor = () => (
    <Panel
      title="Units & relationships"
      subtitle="Manage the units in this operation and their command relationships."
      action={
        <div className="button-row">
          <button onClick={() => newEntity("unit")}>+ Add unit</button>
          <button onClick={() => setProfilePicker(true)}>
            Add from organizations
          </button>
        </div>
      }
    >
      <div className="button-row" aria-label="Task organization views">
        <button
          className={unitView === "TREE" ? "active" : ""}
          disabled={unapplied}
          onClick={() => setUnitView("TREE")}
        >
          Tree view
        </button>
        <button
          className={unitView === "ORBAT" ? "active" : ""}
          disabled={unapplied}
          onClick={() => setUnitView("ORBAT")}
        >
          ORBAT view
        </button>
        <button
          disabled={unapplied || !draftHistory.canUndo || busy}
          onClick={draftHistory.undo}
        >
          Undo draft edit
        </button>
        <button
          disabled={unapplied || !draftHistory.canRedo || busy}
          onClick={draftHistory.redo}
        >
          Redo draft edit
        </button>
      </div>
      {unitView === "ORBAT" && op && (
        <Suspense fallback={<p>Loading operation ORBAT…</p>}>
          <OperationOrbatPanel
            operation={op}
            config={state!.config}
            active={active}
            dirty={dirty}
            onChange={commitOperation}
            onDelete={(id) => remove("units", id)}
            onImported={async () =>
              accept(
                await desktop.execute({ type: "load", operationId: op.id }),
              )
            }
          />
        </Suspense>
      )}
      {!op?.units.length && (
        <p className="empty-small">
          Add the units participating in this operation.
        </p>
      )}
      {unitView === "TREE" &&
        op?.units.map((u, i) => (
          <div
            className={`entity ${selectedId === u.id ? "selected" : ""}`}
            key={u.id}
            data-entity-id={u.id}
            onClick={() => {
              if (page !== "doctrine" && page !== "attachment")
                setSelectedId(u.id);
            }}
          >
            {entityHeader(
              u.name,
              <button
                className="text-button danger"
                onClick={() => remove("units", u.id)}
              >
                Remove
              </button>,
            )}
            <div className="two-columns">
              <Field
                label={`Unit name ${i + 1}`}
                value={u.name}
                onChange={(v) =>
                  change((d) => {
                    d.units[i].name = v;
                  })
                }
              />
              <Select
                label="Parent unit"
                value={u.parentUnitId}
                options={op.units.filter((p) => p.id !== u.id)}
                onChange={(v) =>
                  organizationChange(() => reparentOperationUnit(op, u.id, v))
                }
              />
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={u.inTaskOrganization}
                onChange={(e) =>
                  change((d) => {
                    d.units[i].inTaskOrganization = e.target.checked;
                  })
                }
              />
              Included in task organization
            </label>
            {u.sourceUnitProfile && (
              <details>
                <summary>Original organization details</summary>
                <p>
                  Family {u.sourceUnitProfile.sourceUnitProfileFamilyId}
                  <br />
                  Version {u.sourceUnitProfile.sourceUnitProfileVersionId}
                </p>
                <small>
                  Independent operation unit {u.id} · Source SHA-256{" "}
                  {u.sourceUnitProfile.sourceContentHash}
                </small>
              </details>
            )}
            {u.profileIdentity && (
              <details>
                <summary>Operational unit identity</summary>
                <div className="two-columns">
                  {(
                    [
                      "shortDesignation",
                      "abbreviation",
                      "unitType",
                      "echelon",
                      "service",
                      "component",
                      "callsign",
                      "headquarters",
                      "description",
                      "notes",
                    ] as const
                  ).map((key) => (
                    <Field
                      key={key}
                      label={`Unit ${i + 1} ${key}`}
                      value={u.profileIdentity![key]}
                      onChange={(v) =>
                        change((d) => {
                          d.units[i].profileIdentity![key] = v;
                        })
                      }
                    />
                  ))}
                </div>
              </details>
            )}
            <details
              open={symbolUnitId === u.id}
              onToggle={(e) => {
                if (e.currentTarget.open) setSymbolUnitId(u.id);
                else if (symbolUnitId === u.id) setSymbolUnitId("");
              }}
            >
              <summary
                onClick={(e) => {
                  if (unapplied) {
                    e.preventDefault();
                    setError(unappliedSymbolMessage);
                  }
                }}
              >
                Military symbol
              </summary>
              {symbolUnitId === u.id && (
                <Suspense fallback={<p>Loading symbol editor…</p>}>
                  <OperationSymbolEditor
                    active={active}
                    unit={u}
                    parentName={
                      op.units.find((p) => p.id === u.parentUnitId)?.name ??
                      null
                    }
                    onChange={(symbol) =>
                      change((d) => {
                        d.units[i].symbol = symbol;
                      })
                    }
                  />
                </Suspense>
              )}
            </details>
          </div>
        ))}
    </Panel>
  );
  const taskEditor = () =>
    op && (
      <UnitTasks
        op={op}
        selectedId={page === "tasks" ? selectedId : ""}
        reveal={findingTarget?.page === "tasks" ? findingTarget : null}
        change={change}
        addTask={(unitId) => newEntity("task", { unitId })}
        addObjective={() => newEntity("objective")}
        remove={remove}
      />
    );
  const signalEditor = () => (
    <>
      <Panel
        title="Signal concept & detailed source"
        subtitle="These details belong to the operation. Card fields are selected in Export studio."
      >
        {(
          [
            "concept",
            "architecture",
            "spectrumNotes",
            "maintenanceNotes",
          ] as const
        ).map((key) => (
          <Field
            key={key}
            label={
              {
                concept: "Concept of support",
                architecture: "Network architecture",
                spectrumNotes: "Spectrum notes",
                maintenanceNotes: "Maintenance notes",
              }[key]
            }
            area
            value={op!.signal[key]}
            onChange={(v) =>
              change((d) => {
                d.signal[key] = v;
              })
            }
          />
        ))}
      </Panel>
      <Panel
        title="Radio nets"
        subtitle="One source for the full order and communications card."
        action={<button onClick={() => newEntity("net")}>+ Add net</button>}
      >
        {op?.signal.nets.map((n, i) => (
          <div
            className={`entity ${selectedId === n.id ? "selected" : ""}`}
            key={n.id}
            data-entity-id={n.id}
            onClick={() => {
              if (page !== "doctrine" && page !== "attachment")
                setSelectedId(n.id);
            }}
          >
            {entityHeader(
              n.name,
              <button
                className="text-button danger"
                onClick={() => remove("nets", n.id)}
              >
                Remove
              </button>,
            )}
            <div className="two-columns">
              <Field
                label={`Net name ${i + 1}`}
                value={n.name}
                onChange={(v) =>
                  change((d) => {
                    d.signal.nets[i].name = v;
                  })
                }
              />
              <Field
                label="Net purpose"
                value={n.purpose}
                onChange={(v) =>
                  change((d) => {
                    d.signal.nets[i].purpose = v;
                  })
                }
              />
            </div>
            <div className="three-columns">
              {(["system", "channel", "callsign"] as const).map((key) => (
                <Field
                  key={key}
                  label={`${{ system: "System", channel: "Channel / frequency", callsign: "Callsign" }[key]} ${i + 1}`}
                  value={n[key]}
                  onChange={(v) =>
                    change((d) => {
                      d.signal.nets[i][key] = v;
                    })
                  }
                />
              ))}
            </div>
            <div className="two-columns">
              <Checks
                label="Participants"
                options={op.units}
                values={n.participantUnitIds}
                onChange={(v) =>
                  change((d) => {
                    d.signal.nets[i].participantUnitIds = v;
                  })
                }
              />
              <Checks
                label="Applicable phases"
                hint="No selection means all phases."
                options={op.phases}
                values={n.phaseIds}
                onChange={(v) =>
                  change((d) => {
                    d.signal.nets[i].phaseIds = v;
                  })
                }
              />
            </div>
          </div>
        ))}
      </Panel>
      <Panel
        title="PACE & lost communications"
        action={
          <button onClick={() => newEntity("pace")}>+ Add PACE plan</button>
        }
      >
        {op?.signal.pacePlans.map((p, i) => (
          <div
            className="entity"
            key={p.id}
            data-entity-id={p.id}
            onClick={() => {
              if (page !== "doctrine" && page !== "attachment")
                setSelectedId(p.id);
            }}
          >
            {entityHeader(
              p.name,
              <button
                className="text-button danger"
                onClick={() => remove("pacePlans", p.id)}
              >
                Remove
              </button>,
            )}
            <Field
              label="PACE plan name"
              value={p.name}
              onChange={(v) =>
                change((d) => {
                  d.signal.pacePlans[i].name = v;
                })
              }
            />
            <div className="two-columns">
              {(
                ["primary", "alternate", "contingency", "emergency"] as const
              ).map((key) => (
                <Field
                  key={key}
                  label={key.charAt(0).toUpperCase() + key.slice(1)}
                  value={p[key]}
                  onChange={(v) =>
                    change((d) => {
                      d.signal.pacePlans[i][key] = v;
                    })
                  }
                />
              ))}
            </div>
            <Field
              label="Lost communications"
              area
              value={p.lostCommunications}
              onChange={(v) =>
                change((d) => {
                  d.signal.pacePlans[i].lostCommunications = v;
                })
              }
            />
            <div className="two-columns">
              <Checks
                label="Audience"
                hint="No selection means entire force."
                options={op.units}
                values={p.unitIds}
                onChange={(v) =>
                  change((d) => {
                    d.signal.pacePlans[i].unitIds = v;
                  })
                }
              />
              <Checks
                label="Phases"
                hint="No selection means all phases."
                options={op.phases}
                values={p.phaseIds}
                onChange={(v) =>
                  change((d) => {
                    d.signal.pacePlans[i].phaseIds = v;
                  })
                }
              />
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
  const tree = (parentId: string, depth = 0): ReactNode =>
    op?.attachments
      .filter((a) => a.parentId === parentId)
      .map((a) => (
        <div key={a.id}>
          <button
            className={`tree-item ${selectedId === a.id && page === "attachment" ? "active" : ""}`}
            style={{ paddingLeft: 20 + depth * 14 }}
            onClick={() => navigate("attachment", a.id)}
          >
            <span className="tree-code">{a.code}</span>
            <span>{a.name}</span>
          </button>
          {tree(a.id, depth + 1)}
        </div>
      ));
  if (!state)
    return (
      <div className="app-shell">
        <aside className="sidebar">{globalNavigation}</aside>
        <div className="loading">
          <strong>ORDO</strong>
          <p role={error ? "alert" : "status"}>
            {error || "Opening your local workspace…"}
          </p>
        </div>
      </div>
    );
  return (
    <BusyBoundary
      busy={busy}
      className="app-shell operation-shell"
      inert={busy}
    >
      {cardDeletion && (
        <CardSourceDeletion
          {...cardDeletion}
          config={state.config}
          onCancel={() => setCardDeletion(null)}
          onCommit={(next) => {
            if (op !== cardDeletion.before)
              throw Error(
                "The operation changed. Cancel and try the deletion again.",
              );
            draftHistory.commit(next);
            setCardDeletion(null);
          }}
        />
      )}
      <aside
        className="sidebar operation-global-sidebar"
        aria-label="Application"
      >
        <div className="brand">
          <span className="brand-mark">O</span>
          <div className="brand-name">
            ORDO<small>Libertas Optima Rerum</small>
          </div>
        </div>
        {globalNavigation}
        <div className="sidebar-bottom">
          <div className="offline" title="Offline workspace">
            <span aria-hidden="true" />
            <span className="offline-label">Offline workspace</span>
            <ApplicationVersion />
          </div>
        </div>
      </aside>
      <aside
        className="sidebar operation-sidebar"
        aria-label="Operation workspace"
      >
        <div className="operation-picker">
          <h2>Operation workspace</h2>
          <span className="eyebrow">ACTIVE OPERATION</span>
          <select
            aria-label="Active operation"
            value={op?.id ?? ""}
            onChange={(e) => onOperation(e.target.value)}
          >
            <option value="" disabled>
              Select operation
            </option>
            {state.operations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button className="text-button" onClick={onNewOperation}>
            + New operation
          </button>
        </div>
        <nav aria-label="Operation navigation">
          <span className="nav-label">WORKSPACE</span>
          {(
            [
              ["overview", "◈", "Overview"],
              ["tasks", "☷", "Tasks & objectives"],
              ["phases", "▥", "Phases"],
              ["events", "◷", "Timeline"],
              ["whiteboards", "▧", "Whiteboards"],
              ["progress", "✓", "Planning progress"],
            ] as [Page, string, string][]
          ).map(([key, symbol, label]) => (
            <button
              key={key}
              className={`nav-item ${page === key ? "active" : ""}`}
              onClick={() => navigate(key)}
            >
              <Icon symbol={symbol} />
              {label}
            </button>
          ))}
          <span className="nav-label">OPERATION ORDER</span>
          <button
            className={`nav-item ${page === "base" ? "active" : ""}`}
            onClick={() => navigate("base")}
          >
            <Icon symbol="▤" />
            Base order<span className="nav-count">5</span>
          </button>
          <div className="tree-heading">
            ANNEXES
            {!state.config.doctrine.catalog && (
              <button
                aria-label="Add custom annex"
                onClick={() => addAttachment(null)}
                disabled={!op}
              >
                +
              </button>
            )}
          </div>
          {!taskOrganizationDestination && (
            <button
              className={`nav-item ${page === "units" ? "active" : ""}`}
              onClick={() => navigate("units")}
            >
              <Icon symbol="⊞" />
              Task organization
            </button>
          )}
          {op &&
            (state.config.doctrine.catalog ? (
              <DoctrineTree
                key={op.id}
                op={op}
                config={state.config}
                selectedId={page === "doctrine" ? selectedId : ""}
                onSelect={(id) => navigate("doctrine", id)}
              />
            ) : (
              tree(op.orderId)
            ))}
          {!state.config.doctrine.catalog && !op?.attachments.length && (
            <p className="sidebar-hint">Add annexes from the base order.</p>
          )}
          <button
            className={`nav-item ${page === "signal" ? "active" : ""}`}
            onClick={() => navigate("signal")}
          >
            <Icon symbol="⌁" />
            Signal data
          </button>
          <span className="nav-label">PRODUCTS & CONTROL</span>
          {op && state.config.doctrine.catalog && (
            <button
              className={`nav-item ${page === "package" ? "active" : ""}`}
              onClick={() => navigate("package")}
            >
              <Icon symbol="▦" />
              Package composer
            </button>
          )}
          {(
            [
              ["exports", "↗", "Export studio"],
              ["publications", "▣", "Publications"],
              ["history", "◷", "History & changes"],
              ["validation", "✓", "Validation"],
            ] as [Page, string, string][]
          ).map(([key, symbol, label]) => (
            <button
              key={key}
              className={`nav-item ${page === key ? "active" : ""}`}
              onClick={() => navigate(key)}
            >
              <Icon symbol={symbol} />
              {label}
              {key === "validation" && findings.length > 0 && (
                <span className="nav-count warning">{findings.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => navigate("settings")}>
            <Icon symbol="⚙" />
            Configuration
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              WORKSPACE <span>/</span> {op?.orderNumber ?? "WELCOME"}
            </span>
            <h1>
              {page === "doctrine" && doctrineNode
                ? `${displayProductCode(doctrineNode, state.config)} · ${doctrineNode.canonicalTitle}`
                : page === "attachment" && attachment
                  ? `${attachment.kind.charAt(0).toUpperCase() + attachment.kind.slice(1)} ${attachment.code} · ${attachment.name}`
                  : titles[page]}
            </h1>
            {op && (
              <div className="operation-identity">
                <strong>{op.name}</strong>
                <span>
                  {op.operationOrganizationBinding
                    ? op.operationOrganizationBinding.identity
                        .shortDesignation ||
                      op.operationOrganizationBinding.identity.fullDesignation
                    : "No organization selected"}
                </span>
                <span>{state.config.doctrine.name}</span>
                <span>
                  Revision {op.revision} · {op.metadata.statusId}
                </span>
                <button
                  className="text-button"
                  onClick={() => onGlobal("Operations")}
                >
                  Back to Operations
                </button>
              </div>
            )}
          </div>
          <div className="top-actions">
            <button onClick={onSearch} title="Search (Ctrl+K)">
              Search
            </button>
            {op && (
              <>
                <span className={`save-state ${dirty ? "unsaved" : ""}`}>
                  {dirty
                    ? "● Unsaved changes"
                    : `✓ Saved · revision ${op.revision}`}
                </span>
                <button
                  className="primary"
                  disabled={!dirty || busy || unapplied}
                  onClick={() =>
                    run(async () => {
                      await save();
                      setMessage("Planning revision saved.");
                    })
                  }
                >
                  Save revision
                </button>
                <button
                  disabled={unapplied || busy || !draftHistory.canUndo}
                  onClick={draftHistory.undo}
                >
                  Undo
                </button>
                <button
                  disabled={unapplied || busy || !draftHistory.canRedo}
                  onClick={draftHistory.redo}
                >
                  Redo
                </button>
              </>
            )}
            <span className="avatar" title="Local planner">
              LP
            </span>
          </div>
        </header>
        {op?.demo && (
          <div className="demo-banner">
            <strong>DEMO WORKSPACE</strong> Fictional content for software
            demonstration only.
          </div>
        )}
        {(error || message) && !importProfile && (
          <div
            role={error ? "alert" : "status"}
            className={`notice ${error ? "error" : "success"}`}
          >
            {error || message}
            <button
              aria-label="Dismiss message"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              ×
            </button>
          </div>
        )}
        <div className="work-area">
          <main
            ref={workspaceRef}
            className={`workspace ${page === "whiteboards" ? "whiteboard-page" : ""} ${["exports", "history", "whiteboards"].includes(page) ? "wide" : ""}`}
          >
            {operationRecovery}
            {profileRecovery}
            {state.organizationUpdate && (
              <div
                className={`notice doctrine-update-notice ${state.organizationUpdate.state === "conflict" ? "error" : ""}`}
                role="status"
              >
                <div>
                  <strong>
                    {state.organizationUpdate.state === "conflict"
                      ? "Organization staff update needs review"
                      : state.organizationUpdate.state === "updated"
                        ? "Organization staff updated"
                        : "Organization staff update pending"}
                  </strong>
                  {state.organizationUpdate.messages.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                </div>
                {state.organizationUpdate.state === "conflict" && (
                  <button onClick={() => onGlobal("Organizations")}>
                    Review organization
                  </button>
                )}
              </div>
            )}
            {state.doctrineUpdate && (
              <div
                className={`notice doctrine-update-notice ${state.doctrineUpdate.state === "conflict" ? "error" : ""}`}
                role="status"
              >
                <div>
                  <strong>
                    {state.doctrineUpdate.state === "conflict"
                      ? "Doctrine update needs review"
                      : state.doctrineUpdate.state === "updated"
                        ? "Doctrine updated"
                        : "Doctrine update pending"}
                  </strong>
                  {state.doctrineUpdate.messages.map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                  {state.doctrineUpdate.state === "conflict" && (
                    <p>
                      The operation is still using its previous doctrine.
                      Resolve the conflicting change in Doctrines, then return
                      here or save the operation to check again.
                    </p>
                  )}
                </div>
                {state.doctrineUpdate.state === "conflict" && (
                  <button onClick={() => onGlobal("Doctrines")}>
                    Review doctrine
                  </button>
                )}
              </div>
            )}
            {op && page === "whiteboards" && (
              <WhiteboardWorkspace
                op={op}
                config={state.config}
                publications={state.publications}
                dirty={dirty}
                change={change}
              />
            )}
            {op && (
              <div hidden={page !== "history"}>
                <ReviewWorkspace
                  key={`${workspaceGeneration}:${op.id}`}
                  op={op}
                  unsaved={dirty || profileDirty}
                  active={active && page === "history"}
                  onSource={(c) => {
                    navigate(c.location.page, c.location.id ?? "");
                    if (c.moduleInstanceId)
                      requestAnimationFrame(() =>
                        workspaceRef.current
                          ?.querySelector(
                            `[data-module-id="${c.moduleInstanceId}"]`,
                          )
                          ?.scrollIntoView({ block: "center" }),
                      );
                  }}
                />
              </div>
            )}
            <div hidden={page === "builder" || page === "history"}>
              {!op ? (
                <div className="welcome">
                  <span className="eyebrow">THE AUTHORITATIVE WORKSPACE</span>
                  <h2>Libertas Optima Rerum</h2>
                  <p>
                    Write your plan, connect staff products, and publish the
                    products you need.
                  </p>
                  <div>
                    <button
                      className="primary"
                      onClick={() => {
                        setNewName("");
                        setNewDemo(false);
                        setNewOpen(true);
                      }}
                    >
                      Create operation
                    </button>
                    <button
                      onClick={() =>
                        run(async () => {
                          const next = await desktop.execute({
                            type: "create",
                            name: "DEMO OPERATION",
                            demo: true,
                          });
                          accept(next, false);
                        })
                      }
                    >
                      Explore fictional demo
                    </button>
                    {state.configurations.some(
                      (c) =>
                        c.doctrine.catalog?.profileKey === "us-army-orders",
                    ) && (
                      <button
                        onClick={() =>
                          run(async () => {
                            const config = state.configurations.find(
                              (c) =>
                                c.doctrine.catalog?.profileKey ===
                                "us-army-orders",
                            )!;
                            const next = await desktop.execute({
                              type: "create",
                              name: "DEMO BRIGADE OPERATION",
                              demo: true,
                              configuration: {
                                id: config.organization.id,
                                version: config.organization.version,
                              },
                            });
                            accept(next, false);
                          })
                        }
                      >
                        Explore fictional brigade
                      </button>
                    )}
                    <button
                      onClick={() =>
                        run(async () => {
                          const next = await desktop.restore();
                          if (next) setWorkspaceGeneration((g) => g + 1);
                          if (next) {
                            accept(next, false);
                            setMessage("Workspace restored.");
                          }
                        })
                      }
                    >
                      Restore backup
                    </button>
                  </div>
                  <div className="welcome-cards">
                    <span>
                      01 <b>Structure the plan</b>Units, tasks, phases, and
                      Signal
                    </span>
                    <span>
                      02 <b>Control the baseline</b>Reviewed orders with a
                      permanent record
                    </span>
                    <span>
                      03 <b>Tailor the product</b>One source, configurable
                      exports
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  {["base", "attachment", "doctrine", "package"].includes(
                    page,
                  ) && (
                    <div className="mode-bar">
                      <button
                        className={mode === "edit" ? "chosen" : ""}
                        onClick={() => setMode("edit")}
                      >
                        Edit
                      </button>
                      <button
                        className={mode === "preview" ? "chosen" : ""}
                        onClick={() => setMode("preview")}
                      >
                        {page === "doctrine"
                          ? "Product preview"
                          : state.config.doctrine.catalog
                            ? "Package preview"
                            : "Full OPORD preview"}
                      </button>
                      <button onClick={() => navigate("validation")}>
                        Validate
                      </button>
                      <button onClick={() => navigate("exports")}>
                        Export ↗
                      </button>
                    </div>
                  )}
                  {["base", "attachment", "doctrine", "package"].includes(
                    page,
                  ) && mode === "preview" ? (
                    previewError ? (
                      <p className="notice error">{previewError}</p>
                    ) : previewJob ? (
                      active && <GraphicalProductPreview {...previewJob} />
                    ) : (
                      frame(preview)
                    )
                  ) : (
                    <>
                      {page === "overview" && (
                        <>
                          <div className="overview-title">
                            <div>
                              <span className="eyebrow">
                                CURRENT PLANNING STATE
                              </span>
                              <h2>{op.name}</h2>
                              <p>Keep every product connected.</p>
                            </div>
                            <span className="pill">
                              {
                                state.config.doctrine.statuses.find(
                                  (s) => s.id === op.metadata.statusId,
                                )?.name
                              }
                            </span>
                          </div>
                          <div className="metrics">
                            {[
                              [
                                op.units.filter((u) => u.inTaskOrganization)
                                  .length,
                                "Units in organization",
                                "units",
                              ],
                              [op.tasks.length, "Subordinate tasks", "tasks"],
                              [
                                op.attachments.length,
                                "Order attachments",
                                "base",
                              ],
                              [
                                state.publications.length,
                                "Published baselines",
                                "publications",
                              ],
                            ].map(([count, label, target]) => (
                              <button
                                key={label}
                                onClick={() => navigate(target as Page)}
                              >
                                <strong>
                                  {String(count).padStart(2, "0")}
                                </strong>
                                <span>{label}</span>
                                <i>↗</i>
                              </button>
                            ))}
                          </div>
                          <div className="overview-grid">
                            <Panel
                              title="Build the operational picture"
                              subtitle="Keep source information connected."
                            >
                              <button
                                className="feature-link"
                                onClick={() => navigate("progress")}
                              >
                                <span className="feature-icon">✓</span>
                                <div>
                                  <strong>Planning progress</strong>
                                  <small>
                                    Writing states, responsible staff, and due
                                    dates
                                  </small>
                                </div>
                                <span>→</span>
                              </button>
                              <button
                                className="feature-link"
                                onClick={() => navigate("base")}
                              >
                                <span className="feature-icon">▤</span>
                                <div>
                                  <strong>Five-paragraph order</strong>
                                  <small>
                                    {orderProgress(op, state.config).started} of{" "}
                                    {state.config.doctrine.paragraphs.length}{" "}
                                    sections started
                                  </small>
                                </div>
                                <span>→</span>
                              </button>
                              <button
                                className="feature-link"
                                onClick={() => navigate("signal")}
                              >
                                <span className="feature-icon">⌁</span>
                                <div>
                                  <strong>Signal data</strong>
                                  <small>
                                    {op.signal.nets.length} radio nets ·{" "}
                                    {op.signal.pacePlans.length} PACE plans
                                  </small>
                                </div>
                                <span>→</span>
                              </button>
                              <button
                                className="feature-link"
                                onClick={() => navigate("exports")}
                              >
                                <span className="feature-icon">↗</span>
                                <div>
                                  <strong>
                                    Configure a communications card
                                  </strong>
                                  <small>
                                    Choose audience, phases, and fields
                                  </small>
                                </div>
                                <span>→</span>
                              </button>
                            </Panel>
                            <Panel
                              title="Review readiness"
                              action={
                                <button
                                  className="text-button"
                                  onClick={() => navigate("validation")}
                                >
                                  View findings ↗
                                </button>
                              }
                            >
                              <div className="readiness">
                                <strong>
                                  {
                                    findings.filter(
                                      (f) => f.severity === "error",
                                    ).length
                                  }
                                </strong>
                                <span>
                                  errors to resolve
                                  <br />
                                  <small>
                                    {
                                      findings.filter(
                                        (f) => f.severity === "warning",
                                      ).length
                                    }{" "}
                                    completeness warnings
                                  </small>
                                </span>
                              </div>
                              {findings.slice(0, 2).map((f, i) => (
                                <p className="finding-summary" key={i}>
                                  {f.message}
                                </p>
                              ))}
                              {!findings.length && (
                                <p className="finding-summary">
                                  No issues found by the current checks.
                                </p>
                              )}
                            </Panel>
                          </div>
                          <Panel
                            title="Operational phases"
                            subtitle="Use the same phases for tasks, radio nets, and exports."
                            action={
                              <button
                                className="text-button"
                                onClick={() => navigate("phases")}
                              >
                                Manage phases ↗
                              </button>
                            }
                          >
                            <div className="phase-strip">
                              {op.phases.map((p, i) => (
                                <div key={p.id}>
                                  <span>{String(i + 1).padStart(2, "0")}</span>
                                  <strong>{p.name}</strong>
                                  <small>
                                    {
                                      op.tasks.filter((t) => t.phaseId === p.id)
                                        .length
                                    }{" "}
                                    tasks linked
                                  </small>
                                </div>
                              ))}
                              {!op.phases.length && (
                                <p className="empty-small">
                                  Add phases when the planning workflow needs
                                  them.
                                </p>
                              )}
                            </div>
                          </Panel>
                          <Panel title="Operation identity">
                            <div className="two-columns">
                              <Field
                                label="Operation name"
                                contentId="operation-name"
                                value={op.name}
                                onChange={(v) =>
                                  change((d) => {
                                    d.name = v;
                                  })
                                }
                              />
                              <Field
                                label="Order number"
                                value={op.orderNumber}
                                onChange={(v) =>
                                  change((d) => {
                                    d.orderNumber = v;
                                  })
                                }
                              />
                            </div>
                          </Panel>
                          <OverviewInspector
                            op={op}
                            config={state.config}
                            findings={findings}
                            selectedId={selectedId}
                            onSelect={setSelectedId}
                            change={change}
                            onFindings={() => navigate("validation")}
                            onProduct={(id) => navigate("doctrine", id)}
                          />
                        </>
                      )}
                      {page === "doctrine" && doctrineNode && (
                        <DoctrineProduct
                          op={op}
                          config={state.config}
                          change={change}
                          node={doctrineNode}
                          onError={setError}
                          onSelect={(id) => navigate("doctrine", id)}
                          units={
                            doctrineNode.id === taskOrganizationNode?.id
                              ? () => null
                              : unitEditor
                          }
                          signal={signalEditor}
                        />
                      )}
                      {((page === "doctrine" &&
                        doctrineNode?.status === "ACTIVE") ||
                        page === "base" ||
                        (page === "attachment" && attachment)) && (
                        <ModuleWorkspace
                          key={`${op.id}:${page}:${page === "attachment" ? attachment?.id : (doctrineNode?.id ?? "base")}`}
                          op={op}
                          config={state.config}
                          nodeId={page === "doctrine" ? doctrineNode!.id : null}
                          revealTimelineItem={findingTarget?.timelineItem}
                          attachmentId={
                            page === "attachment" ? attachment?.id : undefined
                          }
                          change={change}
                          units={
                            doctrineNode?.id === taskOrganizationNode?.id &&
                            page === "doctrine"
                              ? () => null
                              : unitEditor
                          }
                          signal={signalEditor}
                          assets={state.assetPreviews}
                          doctrineSource={
                            (
                              {
                                BUNDLED: "Bundled doctrine",
                                USER_CREATED: "User doctrine",
                                IMPORTED: "Imported doctrine",
                              } as Record<string, string>
                            )[
                              state.doctrines.find(
                                (v) =>
                                  v.doctrineFamilyId === op.doctrineRef.id &&
                                  v.config.doctrine.version ===
                                    op.doctrineRef.version,
                              )?.sourceKind ?? "BUNDLED"
                            ]
                          }
                          onAsset={(id, data) =>
                            setState((s) =>
                              s
                                ? {
                                    ...s,
                                    assetPreviews: {
                                      ...s.assetPreviews,
                                      [id]: data,
                                    },
                                  }
                                : s,
                            )
                          }
                          onError={setError}
                        />
                      )}
                      {page === "doctrine" &&
                        doctrineNode &&
                        doctrineNode.id === taskOrganizationNode?.id &&
                        unitEditor()}
                      {page === "doctrine" && doctrineNode && (
                        <button
                          className="text-button"
                          onClick={() => {
                            navigate("overview", doctrineNode.id);
                            setFindingTarget({
                              page: "overview",
                              id: doctrineNode.id,
                              anchor: "[data-overview-inspector]",
                              label: "Inspect record",
                            });
                          }}
                        >
                          View doctrine details in Overview
                        </button>
                      )}
                      {page === "package" && (
                        <PackageComposer
                          op={op}
                          config={state.config}
                          findings={findings}
                          onSelect={(id) => navigate("doctrine", id)}
                          onBase={() => navigate("base")}
                        />
                      )}
                      {page === "base" && op.operationOrganizationBinding && (
                        <Panel title="Base order responsible staff">
                          <ResponsibleStaff
                            hideLabel
                            op={op}
                            config={state.config}
                            nodeId={null}
                            change={change}
                          />
                        </Panel>
                      )}
                      {page === "base" && state.config.doctrine.catalog && (
                        <BaseAuthoring
                          op={op}
                          config={state.config}
                          change={change}
                          onSignal={() => {
                            const node = catalogNodes(state.config).find(
                              (n) => n.editorHint === "SIGNAL_WORKSPACE",
                            );
                            navigate(node ? "doctrine" : "signal", node?.id);
                          }}
                        />
                      )}
                      {page === "base" && !state.config.doctrine.catalog && (
                        <>
                          <Panel
                            title="Five-paragraph OPORD"
                            subtitle="Write the five paragraphs here. Linked units, tasks, and Signal data appear in the preview."
                          >
                            {state.config.doctrine.paragraphs.map((p, i) => (
                              <div
                                className="paragraph"
                                key={p.id}
                                data-paragraph-id={p.id}
                              >
                                <span>{i + 1}</span>
                                <Field
                                  label={p.title}
                                  area
                                  value={
                                    op.sections.find((s) => s.id === p.id)
                                      ?.summary ?? ""
                                  }
                                  onChange={(v) =>
                                    change((d) => {
                                      d.sections.find(
                                        (s) => s.id === p.id,
                                      )!.summary = v;
                                    })
                                  }
                                />
                              </div>
                            ))}
                          </Panel>
                          <Panel
                            title="Annex catalog"
                            subtitle="Choose an annex from this doctrine or add a custom annex."
                          >
                            <div className="catalog">
                              {state.config.doctrine.annexCatalog.map((c) => (
                                <button
                                  key={c.id}
                                  disabled={op.attachments.some(
                                    (a) => a.catalogId === c.id,
                                  )}
                                  onClick={() => addAttachment(null, c.id)}
                                >
                                  <b>{c.code}</b>
                                  <span>{c.title}</span>
                                  <small>
                                    {op.attachments.some(
                                      (a) => a.catalogId === c.id,
                                    )
                                      ? "Added"
                                      : "+ Add"}
                                  </small>
                                </button>
                              ))}
                            </div>
                            <button onClick={() => addAttachment(null)}>
                              + Custom annex
                            </button>
                          </Panel>
                        </>
                      )}
                      {page === "units" && unitEditor()}
                      {page === "tasks" && taskEditor()}
                      {page === "signal" && signalEditor()}
                      {page === "phases" && (
                        <Panel
                          title="Operational phases"
                          action={
                            <button onClick={() => newEntity("phase")}>
                              + Add phase
                            </button>
                          }
                        >
                          {op.phases.map((p, i) => (
                            <div
                              className="entity"
                              key={p.id}
                              data-entity-id={p.id}
                              onClick={() => setSelectedId(p.id)}
                            >
                              {entityHeader(
                                p.name,
                                <button
                                  className="text-button danger"
                                  onClick={() => remove("phases", p.id)}
                                >
                                  Remove
                                </button>,
                              )}
                              <div className="two-columns">
                                <Field
                                  label="Phase name"
                                  value={p.name}
                                  onChange={(v) =>
                                    change((d) => {
                                      d.phases[i].name = v;
                                    })
                                  }
                                />
                                <Field
                                  label="Sequence"
                                  type="number"
                                  value={String(p.sequence)}
                                  onChange={(v) =>
                                    change((d) => {
                                      d.phases[i].sequence = Math.max(
                                        0,
                                        Number(v),
                                      );
                                    })
                                  }
                                />
                              </div>
                            </div>
                          ))}
                        </Panel>
                      )}
                      {page === "events" && (
                        <PlanningTimeline
                          op={op}
                          config={state.config}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                          change={change}
                          onAdd={(laneId) => newEntity("event", { laneId })}
                          onRemove={(id) => remove("events", id)}
                        />
                      )}
                      {page === "progress" && (
                        <PlanningProgress
                          op={op}
                          config={state.config}
                          change={change}
                          onOpen={(product) => {
                            if (product.id === op.orderId) navigate("base");
                            else if (product.nodeId)
                              navigate("doctrine", product.nodeId);
                            else navigate("attachment", product.id);
                          }}
                        />
                      )}
                      {page === "attachment" && attachment && (
                        <>
                          <Panel
                            title={`${attachment.kind.toUpperCase()} ${attachment.code}`}
                            subtitle="Add content and supporting attachments to this part of the order."
                            action={
                              attachment.kind !== "exhibit" && (
                                <button
                                  onClick={() => addAttachment(attachment)}
                                >
                                  + Add{" "}
                                  {
                                    {
                                      annex: "appendix",
                                      appendix: "tab",
                                      tab: "exhibit",
                                      exhibit: "",
                                    }[attachment.kind]
                                  }
                                </button>
                              )
                            }
                          >
                            <div className="two-columns">
                              <Field
                                label="Attachment title"
                                value={attachment.name}
                                onChange={(v) =>
                                  change((d) => {
                                    d.attachments.find(
                                      (a) => a.id === attachment.id,
                                    )!.name = v;
                                  })
                                }
                              />
                              <Field
                                label="Identifier"
                                value={attachment.code}
                                onChange={(v) =>
                                  change((d) => {
                                    d.attachments.find(
                                      (a) => a.id === attachment.id,
                                    )!.code = v;
                                  })
                                }
                              />
                            </div>
                            <Field
                              label="Narrative summary"
                              area
                              value={attachment.narrative}
                              onChange={(v) =>
                                change((d) => {
                                  d.attachments.find(
                                    (a) => a.id === attachment.id,
                                  )!.narrative = v;
                                })
                              }
                            />
                            <div className="two-columns">
                              <Checks
                                label="Applicable units"
                                hint="No selection means entire force."
                                options={op.units}
                                values={attachment.unitIds}
                                onChange={(v) =>
                                  change((d) => {
                                    d.attachments.find(
                                      (a) => a.id === attachment.id,
                                    )!.unitIds = v;
                                  })
                                }
                              />
                              <Checks
                                label="Applicable phases"
                                hint="No selection means all phases."
                                options={op.phases}
                                values={attachment.phaseIds}
                                onChange={(v) =>
                                  change((d) => {
                                    d.attachments.find(
                                      (a) => a.id === attachment.id,
                                    )!.phaseIds = v;
                                  })
                                }
                              />
                            </div>
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={attachment.required}
                                onChange={(e) =>
                                  change((d) => {
                                    d.attachments.find(
                                      (a) => a.id === attachment.id,
                                    )!.required = e.target.checked;
                                  })
                                }
                              />
                              Required attachment
                            </label>
                            <button
                              className="text-button danger"
                              disabled={op.attachments.some(
                                (a) => a.parentId === attachment.id,
                              )}
                              onClick={() => {
                                change((d) => {
                                  d.attachments = d.attachments.filter(
                                    (a) => a.id !== attachment.id,
                                  );
                                });
                                navigate("base");
                              }}
                            >
                              Remove attachment
                            </button>
                          </Panel>
                          {attachmentEditor === "task-organization" &&
                            unitEditor()}
                          {attachmentEditor === "signal" && signalEditor()}
                          {attachmentEditor === "operations" && taskEditor()}
                        </>
                      )}
                      {page === "validation" && (
                        <Panel
                          title="Consistency findings"
                          subtitle={`Evaluated against ${dirty ? "unsaved planning changes" : `revision ${op.revision}`}. Findings never change the plan.`}
                        >
                          {findings.length ? (
                            findings.map((f, i) => (
                              <button
                                className="finding"
                                key={i}
                                onClick={() => {
                                  const target = findingLocation(
                                    f,
                                    op,
                                    state.config,
                                  );
                                  if (target.page === "units")
                                    setUnitView("TREE");
                                  navigate(target.page, target.id);
                                  setFindingTarget(target);
                                  setMessage(`Finding: ${f.message}`);
                                }}
                              >
                                <span className={`pill ${f.severity}`}>
                                  {f.severity}
                                </span>
                                <div>
                                  <strong>{f.message}</strong>
                                  <small>
                                    {f.category} · {f.ruleId} · {f.field}
                                  </small>
                                </div>
                                <span>↗</span>
                              </button>
                            ))
                          ) : (
                            <div className="empty-small">
                              ✓ No issues found by the current checks.
                            </div>
                          )}
                        </Panel>
                      )}
                      {page === "exports" && (
                        <div className="button-row">
                          {(["opord", "communications-card"] as const).map(
                            (product) => (
                              <button
                                key={product}
                                disabled={busy || dirty || profileDirty}
                                onClick={() =>
                                  void run(async () => {
                                    const created = createExportProfile(
                                      op,
                                      product,
                                      crypto.randomUUID(),
                                    );
                                    const next = await desktop.execute({
                                      type: "save-profile",
                                      profile: created,
                                      isNew: true,
                                    });
                                    accept(next);
                                    setProfile(
                                      next.profiles.find(
                                        (p) =>
                                          !state.profiles.some(
                                            (old) => old.id === p.id,
                                          ),
                                      ) ?? null,
                                    );
                                  })
                                }
                              >
                                New{" "}
                                {product === "opord"
                                  ? "OPORD"
                                  : "communications card"}{" "}
                                profile
                              </button>
                            ),
                          )}
                          {profile && (
                            <DeleteItemButton
                              target={{
                                kind: "export-profile",
                                id: profile.id,
                              }}
                              label="Delete export profile"
                              disabled={busy || dirty || profileDirty}
                              onDeleted={async () => {
                                const next = await desktop.execute({
                                  type: "load",
                                  operationId: op.id,
                                });
                                accept(next);
                                setProfile(next.profiles[0] ?? null);
                                setRecordPreview("");
                              }}
                            />
                          )}
                        </div>
                      )}
                      {page === "exports" && profile && (
                        <>
                          <div className="export-toolbar">
                            <label>
                              Export profile
                              <select
                                aria-label="Export profile"
                                value={profile.id}
                                onChange={(e) => {
                                  const nextId = e.target.value;
                                  run(async () => {
                                    const next = profileDirty
                                      ? await saveAll()
                                      : state;
                                    setProfile(
                                      next.profiles.find(
                                        (p) => p.id === nextId,
                                      )!,
                                    );
                                    setRecordPreview("");
                                  });
                                }}
                              >
                                {state.profiles.map((p) => (
                                  <option value={p.id} key={p.id}>
                                    {p.name} · v{p.version}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Source
                              <select
                                aria-label="Export source"
                                value={sourcePublication}
                                onChange={(e) =>
                                  setSourcePublication(e.target.value)
                                }
                              >
                                <option value="">Live planning state</option>
                                {state.publications.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    OPORD v{p.version} · revision{" "}
                                    {p.sourceRevision}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <ExportFileControls
                              paper={state.preferences.pageSize}
                              onGenerate={(format, options) =>
                                void run(() => generateExport(format, options))
                              }
                            />
                          </div>
                          <div className="export-layout">
                            <div className="export-controls">
                              <Panel
                                title="Include in this product"
                                subtitle="Choose what appears in this export."
                              >
                                <Field
                                  label="Profile name"
                                  value={profile.name}
                                  onChange={(v) =>
                                    changeProfile((p) => {
                                      p.name = v;
                                    })
                                  }
                                />
                                <Field
                                  label="Product title"
                                  value={profile.rendering.title}
                                  onChange={(v) =>
                                    changeProfile((p) => {
                                      p.rendering.title = v;
                                    })
                                  }
                                />
                                <label className="field">
                                  <span>Layout</span>
                                  <select
                                    aria-label="Product layout"
                                    value={profile.rendering.detail}
                                    onChange={(e) =>
                                      changeProfile((p) => {
                                        p.rendering.detail = e.target
                                          .value as ExportProfile["rendering"]["detail"];
                                      })
                                    }
                                  >
                                    <option value="full">
                                      Full staff product
                                    </option>
                                    <option value="execution">
                                      Execution extract
                                    </option>
                                    <option value="quick-reference">
                                      Quick reference
                                    </option>
                                  </select>
                                </label>
                                <Checks
                                  label="Audience"
                                  hint="No selection means entire force."
                                  options={op.units}
                                  values={profile.inclusion.audienceUnitIds}
                                  onChange={(v) =>
                                    changeProfile((p) => {
                                      p.inclusion.audienceUnitIds = v;
                                    })
                                  }
                                />
                                <Checks
                                  label="Phases"
                                  hint="No selection means all phases."
                                  options={op.phases}
                                  values={profile.inclusion.phaseIds}
                                  onChange={(v) =>
                                    changeProfile((p) => {
                                      p.inclusion.phaseIds = v;
                                    })
                                  }
                                />
                                {profile.product === "communications-card" ? (
                                  <>
                                    <Checks
                                      label="Nets"
                                      hint="No selection means all matching nets."
                                      options={op.signal.nets}
                                      values={profile.inclusion.netIds}
                                      onChange={(v) =>
                                        changeProfile((p) => {
                                          p.inclusion.netIds = v;
                                        })
                                      }
                                    />
                                    <Checks
                                      label="Net fields"
                                      options={cardFields.map((f) => ({
                                        id: f,
                                        name:
                                          f.charAt(0).toUpperCase() +
                                          f.slice(1),
                                      }))}
                                      values={profile.inclusion.netFields}
                                      onChange={(v) =>
                                        changeProfile((p) => {
                                          p.inclusion.netFields =
                                            v as ExportProfile["inclusion"]["netFields"];
                                        })
                                      }
                                    />
                                    <label className="check">
                                      <input
                                        type="checkbox"
                                        checked={
                                          profile.inclusion.includeNetName !==
                                          false
                                        }
                                        onChange={(e) =>
                                          changeProfile((p) => {
                                            p.inclusion.includeNetName =
                                              e.target.checked;
                                          })
                                        }
                                      />
                                      Net name
                                    </label>
                                    <label className="check">
                                      <input
                                        type="checkbox"
                                        checked={profile.inclusion.includePace}
                                        onChange={(e) =>
                                          changeProfile((p) => {
                                            p.inclusion.includePace =
                                              e.target.checked;
                                          })
                                        }
                                      />
                                      PACE
                                    </label>
                                    <label className="check">
                                      <input
                                        type="checkbox"
                                        checked={
                                          profile.inclusion
                                            .includeLostCommunications
                                        }
                                        onChange={(e) =>
                                          changeProfile((p) => {
                                            p.inclusion.includeLostCommunications =
                                              e.target.checked;
                                          })
                                        }
                                      />
                                      Lost communications
                                    </label>
                                  </>
                                ) : (
                                  <>
                                    <Checks
                                      label="Paragraphs"
                                      options={state.config.doctrine.paragraphs.map(
                                        (p) => ({ id: p.id, name: p.title }),
                                      )}
                                      values={profile.inclusion.paragraphIds}
                                      onChange={(v) =>
                                        changeProfile((p) => {
                                          p.inclusion.paragraphIds = v;
                                        })
                                      }
                                    />
                                    {op.schemaVersion === 2 && (
                                      <label className="field">
                                        <span>Package selection</span>
                                        <select
                                          aria-label="Package selection"
                                          value={
                                            profile.inclusion.packageScope ??
                                            "included"
                                          }
                                          onChange={(e) =>
                                            changeProfile((p) => {
                                              p.inclusion.packageScope = e
                                                .target.value as
                                                "included" | "selected";
                                            })
                                          }
                                        >
                                          <option value="included">
                                            All included products (live package)
                                          </option>
                                          <option value="selected">
                                            Selected included products
                                          </option>
                                        </select>
                                      </label>
                                    )}
                                    {(op.schemaVersion !== 2 ||
                                      profile.inclusion.packageScope ===
                                        "selected") && (
                                      <Checks
                                        label="Attachments"
                                        options={op.attachments.map((a) => ({
                                          id: a.id,
                                          name: `${a.kind} ${a.code} · ${a.name}`,
                                        }))}
                                        values={profile.inclusion.attachmentIds}
                                        onChange={(v) =>
                                          changeProfile((p) => {
                                            p.inclusion.attachmentIds = v;
                                          })
                                        }
                                      />
                                    )}
                                  </>
                                )}
                                <div className="stack-buttons">
                                  <button
                                    disabled={busy || !profileDirty}
                                    onClick={() =>
                                      run(async () => {
                                        await save();
                                        const next = await desktop.execute({
                                          type: "save-profile",
                                          profile,
                                          isNew: false,
                                        });
                                        accept(next);
                                        setProfile(
                                          next.profiles.find(
                                            (p) => p.id === profile.id,
                                          )!,
                                        );
                                        setMessage(
                                          "Export settings saved. Earlier exports keep their original settings.",
                                        );
                                      })
                                    }
                                  >
                                    Save export settings
                                  </button>
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      run(async () => {
                                        await save();
                                        const next = await desktop.execute({
                                          type: "save-profile",
                                          profile: {
                                            ...profile,
                                            name: profile.name + " copy",
                                          },
                                          isNew: true,
                                        });
                                        accept(next);
                                        setProfile(
                                          next.profiles.find(
                                            (p) =>
                                              !state.profiles.some(
                                                (old) => old.id === p.id,
                                              ),
                                          )!,
                                        );
                                        setMessage("New export profile saved.");
                                      })
                                    }
                                  >
                                    Save as new profile
                                  </button>
                                </div>
                              </Panel>
                            </div>
                            <div className="export-preview">
                              <div className="preview-label">
                                <span className="live-dot" />{" "}
                                {recordPreview
                                  ? "GENERATED SNAPSHOT"
                                  : "LIVE DERIVED PREVIEW"}{" "}
                                <small>
                                  {recordPreview
                                    ? "Read-only artifact"
                                    : "Read-only · edit facts in Signal data"}
                                </small>
                                {recordPreview && (
                                  <button
                                    className="text-button"
                                    onClick={() => setRecordPreview("")}
                                  >
                                    Return to live
                                  </button>
                                )}
                              </div>
                              {previewError && !recordPreview ? (
                                <p className="notice error">{previewError}</p>
                              ) : previewJob && !recordPreview ? (
                                active && (
                                  <GraphicalProductPreview {...previewJob} />
                                )
                              ) : (
                                frame(
                                  recordPreview
                                    ? (state.exports.find(
                                        (e) => e.id === recordPreview,
                                      )?.html ?? preview)
                                    : preview,
                                  "Communications and OPORD preview",
                                )
                              )}
                            </div>
                          </div>
                          <Panel
                            title="Generated products"
                            subtitle="Saved exports keep the content and settings used to create them."
                          >
                            {state.exports.length ? (
                              state.exports.map((e) => (
                                <div className="history-row" key={e.id}>
                                  <div>
                                    <strong>{e.profile.name}</strong>
                                    <small>
                                      Revision {e.sourceRevision} · profile v
                                      {e.profile.version} ·{" "}
                                      {displayTime(e.generatedAt)}
                                    </small>
                                    <details>
                                      <summary>Export details</summary>
                                      <small
                                        title={e.dependencies
                                          .map((d) => d.path)
                                          .join("\n")}
                                      >
                                        {e.dependencies.length} source
                                        dependencies retained
                                      </small>
                                      <small>
                                        Projection v{e.projectionVersion} ·{" "}
                                        {e.rendererVersion} · template v
                                        {e.renderTemplateVersion}
                                      </small>
                                      <small title={e.renderTemplateId}>
                                        Template {e.renderTemplateId}
                                      </small>
                                      {e.staleness.outdated && (
                                        <small className="outdated">
                                          Changed:{" "}
                                          {e.staleness.changedPaths
                                            .slice(0, 3)
                                            .join(", ")}
                                        </small>
                                      )}
                                    </details>
                                  </div>
                                  <span
                                    className={`pill ${e.staleness.outdated || e.supersededSource ? "warning" : ""}`}
                                  >
                                    {e.supersededSource
                                      ? "Superseded source"
                                      : e.staleness.compatibility !==
                                          "supported"
                                        ? "Compatibility unavailable"
                                        : e.staleness.outdated
                                          ? "Outdated"
                                          : "Source unchanged"}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setRecordPreview(e.id);
                                    }}
                                  >
                                    View
                                  </button>
                                  <button
                                    onClick={() =>
                                      run(async () => {
                                        const path = await desktop.saveHtml(
                                          e.id,
                                          op.id,
                                        );
                                        if (path) setMessage(`Saved ${path}`);
                                      })
                                    }
                                  >
                                    Save HTML
                                  </button>
                                  <DocumentOutput
                                    operationId={op.id}
                                    exportId={e.id}
                                    paper={state.preferences.pageSize}
                                    onExportWord={(options) =>
                                      void run(() =>
                                        exportWord(e.id, op.revision, options),
                                      )
                                    }
                                  />
                                </div>
                              ))
                            ) : (
                              <p className="empty-small">
                                No exports yet. Choose a product and select
                                Generate export.
                              </p>
                            )}
                          </Panel>
                        </>
                      )}
                      {page === "exports" && (
                        <WordExportHistory
                          key={`${op.id}:${latestWordId}`}
                          operationId={op.id}
                          revision={op.revision}
                        />
                      )}
                      {page === "publications" && (
                        <>
                          <Panel
                            title="Approve and publish the order"
                            subtitle="Publishing keeps a permanent copy of the approved order. Later planning edits do not change that copy."
                          >
                            <p>
                              Current status:{" "}
                              <strong>
                                {
                                  state.config.doctrine.statuses.find(
                                    (s) => s.id === op.metadata.statusId,
                                  )?.name
                                }
                              </strong>{" "}
                              ·{" "}
                              {
                                findings.filter((f) => f.severity === "error")
                                  .length
                              }{" "}
                              validation errors
                            </p>
                            <Field
                              label="Revision approval note"
                              area
                              value={approvalNote}
                              onChange={setApprovalNote}
                            />
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                dirty ||
                                op.metadata.statusId !==
                                  state.config.doctrine
                                    .publicationRequiredStatus ||
                                findings.some((f) => f.severity === "error") ||
                                state.approvals.some(
                                  (a) =>
                                    a.sourceRevision === op.revision &&
                                    a.origin === "explicit-approval",
                                )
                              }
                              onClick={() =>
                                run(async () => {
                                  await doCommand(
                                    {
                                      type: "approve",
                                      operationId: op.id,
                                      expectedRevision: op.revision,
                                      note: approvalNote,
                                    },
                                    `Revision ${op.revision} explicitly approved.`,
                                  );
                                  setApprovalNote("");
                                })
                              }
                            >
                              Approve Revision {op.revision}
                            </button>{" "}
                            <button
                              className="primary"
                              disabled={
                                busy ||
                                dirty ||
                                !state.approvals.some(
                                  (a) =>
                                    a.sourceRevision === op.revision &&
                                    a.origin === "explicit-approval",
                                ) ||
                                op.metadata.statusId !==
                                  state.config.doctrine
                                    .publicationRequiredStatus ||
                                findings.some((f) => f.severity === "error")
                              }
                              onClick={() =>
                                run(async () => {
                                  await doCommand(
                                    {
                                      type: "publish",
                                      operationId: op.id,
                                      expectedRevision: op.revision,
                                    },
                                    "OPORD published. A permanent copy is available in Publication history.",
                                  );
                                  setApprovalNote("");
                                })
                              }
                            >
                              Publish OPORD
                            </button>
                            <p className="hint">
                              Set the operation to Approved in the Overview
                              inspector and save, then approve that exact
                              revision. Approval is attributed to the local
                              planner and remains in history after later edits.
                            </p>
                          </Panel>
                          <Panel title="Revision approvals">
                            {!state.approvals.some(
                              (a) =>
                                a.sourceRevision === op.revision &&
                                a.origin === "explicit-approval",
                            ) && (
                              <p className="hint">
                                Current revision {op.revision} has no explicit
                                approval.
                              </p>
                            )}
                            {state.approvals.map((a) => (
                              <div className="history-row" key={a.id}>
                                <div>
                                  <strong>
                                    Revision {a.sourceRevision} · {a.scope}
                                  </strong>
                                  <small>
                                    {a.actor} · {displayTime(a.at)} ·{" "}
                                    {a.note || "No note"}
                                  </small>
                                  <small>Approval {a.id}</small>
                                </div>
                                <span className="pill">
                                  {a.origin === "legacy-publication"
                                    ? "Legacy publication evidence"
                                    : a.sourceRevision === op.revision
                                      ? "Applies to current revision"
                                      : "Historical approval"}
                                </span>
                              </div>
                            ))}
                          </Panel>
                          <Panel title="Publication history">
                            {state.publications.map((p) => (
                              <div className="history-row" key={p.id}>
                                <div>
                                  <strong>
                                    OPORD {p.orderNumber} · v{p.version}
                                  </strong>
                                  <small>
                                    Revision {p.sourceRevision} ·{" "}
                                    {displayTime(p.publishedAt)}
                                  </small>
                                  <small>
                                    {p.approval.actor} ·{" "}
                                    {p.approval.note || "No approval note"}
                                  </small>
                                  <small>Approval {p.approvalId}</small>
                                </div>
                                <span className="pill">
                                  {state.publications.some(
                                    (n) => n.supersedesId === p.id,
                                  )
                                    ? "Superseded"
                                    : "Current baseline"}
                                </span>
                                <button
                                  onClick={() => setPublishedPreview(p.id)}
                                >
                                  View snapshot
                                </button>
                              </div>
                            ))}
                            {!state.publications.length && (
                              <p className="empty-small">
                                No published baseline yet.
                              </p>
                            )}
                          </Panel>
                          {publishedPreview &&
                            (() => {
                              const p = state.publications.find(
                                (p) => p.id === publishedPreview,
                              )!;
                              const base = state.profiles.find(
                                (x) => x.product === "opord",
                              )!;
                              const full = {
                                ...base,
                                inclusion: {
                                  ...base.inclusion,
                                  audienceUnitIds: [],
                                  phaseIds: [],
                                  netIds: [],
                                  paragraphIds: p.snapshot.sections.map(
                                    (s) => s.id,
                                  ),
                                  attachmentIds: p.snapshot.attachments.map(
                                    (a) => a.id,
                                  ),
                                },
                              };
                              return frame(
                                renderDocumentHtml(
                                  projectReadableOrder(
                                    p.snapshot,
                                    full,
                                    p.config,
                                  ).view,
                                  `IMMUTABLE OPORD v${p.version} · source revision ${p.sourceRevision} · published ${p.publishedAt}`,
                                  undefined,
                                  state.assetPreviews,
                                  [],
                                  p.snapshot.metadata.documentLayout ??
                                    (hasPlanningBlocks(p.snapshot)
                                      ? newDocumentLayout()
                                      : undefined),
                                ),
                                "Published OPORD snapshot",
                              );
                            })()}
                        </>
                      )}
                      {page === "settings" && (
                        <>
                          <DocumentLayoutEditor
                            operation={op}
                            change={change}
                            assets={state.assetPreviews}
                            onAsset={(id, data) =>
                              setState((s) =>
                                s
                                  ? {
                                      ...s,
                                      assetPreviews: {
                                        ...s.assetPreviews,
                                        [id]: data,
                                      },
                                    }
                                  : s,
                              )
                            }
                          />
                          <Panel
                            title="Operation setup"
                            subtitle="This operation uses the setup saved when it was created. Editing reusable doctrine or organizations does not change it."
                          >
                            <dl className="config-list">
                              <dt>Doctrine</dt>
                              <dd>{state.config.doctrine.name}</dd>
                              <dt>Order conventions</dt>
                              <dd>{state.config.organization.name}</dd>
                              <dt>Echelon</dt>
                              <dd>{state.config.echelon.name}</dd>
                              <dt>Setup</dt>
                              <dd>Saved with this operation</dd>
                            </dl>
                            <details>
                              <summary>Setup details</summary>
                              <p>
                                Doctrine: {state.config.doctrine.id} · v
                                {state.config.doctrine.version}
                              </p>
                              <p>
                                Order conventions:{" "}
                                {state.config.organization.id} · v
                                {state.config.organization.version}
                              </p>
                              <p>
                                Echelon: {state.config.echelon.id} · v
                                {state.config.echelon.version}
                              </p>
                            </details>
                            <p className="hint">
                              Manage reusable doctrine and organizations from
                              the main navigation.
                            </p>
                          </Panel>
                          <Panel title="Application settings">
                            <p>
                              Open Settings for preferences, workspace backups,
                              and restore.
                            </p>
                            <button onClick={() => onGlobal("Settings")}>
                              Open global Settings
                            </button>
                          </Panel>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </main>
        </div>
        <footer className="statusbar">
          <span>
            <span className="live-dot" /> Local storage · Offline ready
          </span>
          <span>
            {op
              ? `${op.name} / ${op.orderNumber}`
              : "Ordo · Operation workspace"}
            <span className="footer-dot">·</span>Local planner
          </span>
        </footer>
      </div>
      {profilePicker && (
        <UnitProfilePicker
          title="Add from organizations"
          onCancel={() => setProfilePicker(false)}
          onSelect={(v) => {
            setProfilePicker(false);
            setImportProfile(v);
            setImportSubtree(false);
            setConfirmDuplicate(false);
            setImportId(uid());
          }}
        />
      )}
      {importProfile && op && (
        <ModalBackdrop>
          <section
            className="modal"
            role="dialog"
            aria-label="Add organization"
          >
            <h2>Add {importProfile.identity.fullDesignation}</h2>
            <p>
              Adds independent copies of the selected units to this operation.
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={importSubtree}
                onChange={(e) => setImportSubtree(e.target.checked)}
              />
              Include subordinate units
            </label>
            {op.units.some(
              (u) =>
                u.sourceUnitProfile?.sourceUnitProfileFamilyId ===
                importProfile.unitProfileFamilyId,
            ) && (
              <p className="notice">
                This organization is already represented in the operation.
              </p>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={confirmDuplicate}
                onChange={(e) => setConfirmDuplicate(e.target.checked)}
              />
              Allow another copy of an organization already in this operation
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="button-row">
              <button data-dialog-cancel onClick={() => setImportProfile(null)}>
                Cancel import
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await desktop.workspace({
                      type: "unit-profile-instantiate",
                      operation: op,
                      unitProfileVersionId: importProfile.unitProfileVersionId,
                      subtree: importSubtree,
                      confirmDuplicate,
                      importId,
                    });
                    setOp(r.operation!);
                    setImportProfile(null);
                    setMessage(
                      "Organization added to the operation. Save a revision to keep these units.",
                    );
                  })
                }
              >
                {importSubtree
                  ? "Add unit with subordinate units"
                  : "Add unit only"}
              </button>
            </div>
          </section>
        </ModalBackdrop>
      )}
      {newOpen && (
        <ModalBackdrop>
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (dirty || profileDirty) await saveAll();
                const next = await desktop.execute({
                  type: "create",
                  name: newName,
                  demo: newDemo,
                  ...(newConfiguration
                    ? { configuration: JSON.parse(newConfiguration) }
                    : {}),
                });
                accept(next, false);
                setNewOpen(false);
                navigate("overview");
                setSourcePublication("");
              });
            }}
          >
            <span className="eyebrow">NEW WORKSPACE</span>
            <h2>Create an operation</h2>
            <Field
              label="New operation name"
              value={newName}
              onChange={setNewName}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={newDemo}
                onChange={(e) => {
                  setNewDemo(e.target.checked);
                  if (e.target.checked && !newName)
                    setNewName("DEMO OPERATION");
                }}
              />
              Include clearly labeled fictional demo data
            </label>
            <label className="field">
              <span>Doctrine</span>
              <select
                aria-label="Doctrine"
                value={newConfiguration}
                onChange={(e) => setNewConfiguration(e.target.value)}
              >
                <option value="">Starter doctrine</option>
                {state.configurations
                  .filter((c) => c.doctrine.catalog)
                  .map((c) => (
                    <option
                      key={`${c.organization.id}:${c.organization.version}`}
                      value={JSON.stringify({
                        id: c.organization.id,
                        version: c.organization.version,
                      })}
                    >
                      {c.doctrine.name} · {c.organization.name}
                    </option>
                  ))}
              </select>
            </label>
            <p className="hint">
              This operation keeps a copy of the selected doctrine. Existing
              operations keep their original setup.
            </p>
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
                type="submit"
                disabled={busy || !newName.trim()}
              >
                Create operation
              </button>
            </div>
          </form>
        </ModalBackdrop>
      )}
    </BusyBoundary>
  );
}
