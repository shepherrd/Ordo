import { BuilderDialog } from "./BuilderDialog";
import { useCatalogSearch, useSearchOpen } from "./SearchProvider";
import { createPortal } from "react-dom";
import { GraphicPreview } from "./GraphicPreview";
import { SaveStatus } from "./SaveStatus";
import { WorkbenchIcon } from "./WorkbenchIcon";
import { countLabel } from "./ui-text";
import { editorError } from "./editor-error";
import { DeleteItemButton } from "./DeleteItemButton";
import {
  BusyBoundary,
  useWorkspaceApi,
  useEditorProtection,
  EditorScope,
  useUnappliedSymbolEdits,
  unappliedSymbolMessage,
} from "./WorkspaceContext";
import { useEffect, useMemo, useState } from "react";
import {
  savedOrbatVersionSchema,
  type SavedOrbatVersion,
  type OrbatNode,
} from "../../domain/orbat";
import {
  addOrbatNode,
  changeOrbatLayout,
  deleteOrbatNode,
  reparentOrbatNode,
  moveOrbatSubtree,
  deleteOrbatSubtree,
  resetOrbatComposition,
} from "../../domain/orbat-actions";
import { newUnitProfile, type UnitProfile } from "../../domain/unit-profiles";
import {
  newSymbolDefinition,
  type SymbolSnapshot,
} from "../../domain/symbology";
import { type TreeDrop, subtreeIds } from "../../domain/organization-editing";
import type { SymbolLibrarySummary } from "../../application/symbology-ports";
import { diagramFromSaved } from "../../application/orbat-projection";
import { useDraftHistory } from "./useDraftHistory";
import { useWorkingCopy, useRecoveryOpen } from "./WorkingCopies";
import { UnitProfilePicker } from "./UnitProfilePicker";
import { SavedSymbolPicker } from "./SavedSymbolPicker";
import { SymbolEditor } from "./SymbolEditor";
import { GraphicExportPanel } from "./GraphicExportPanel";
import { GraphicExportHistory } from "./GraphicExportHistory";
import { LibraryImportPanel, ImportReceiptView } from "./LibraryImportPanel";
import { OrbatCanvas } from "./OrbatCanvas";
import { Field, Panel } from "./Fields";
import "./symbology.css";
import { addCatalogOrbatRoot } from "../../domain/catalog-orbat";
import { EmptyOrbatCanvas } from "./EmptyOrbatCanvas";
import { SaveUnitSymbol } from "./SaveUnitSymbol";
const uid = () => crypto.randomUUID();
export default function OrbatWorkspace({
  active,
  openRequest,
  onOpenImported,
  previewHost,
  onLibraryChange,
}: {
  active: boolean;
  openRequest?: { id: string; nonce: number };
  onOpenImported?: (kind: "SYMBOL" | "ORBAT", id: string) => void;
  previewHost: HTMLElement | null;
  onLibraryChange: () => void;
}) {
  const desktop = useWorkspaceApi();
  const [layoutHost, setLayoutHost] = useState<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<
    "new" | "import" | "export" | "history" | null
  >(null);
  const [toolBusy, setToolBusy] = useState(false);
  const history = useDraftHistory<SavedOrbatVersion | null>(null),
    draft = history.value;
  const [saved, setSaved] = useState<SavedOrbatVersion | null>(null),
    [items, setItems] = useState<SymbolLibrarySummary[]>([]),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [generation, setGeneration] = useState(0),
    [name, setName] = useState("New ORBAT"),
    [selected, setSelected] = useState(""),
    [profilePicker, setProfilePicker] = useState<"CREATE" | "ADD" | null>(null),
    [symbolPicker, setSymbolPicker] = useState(false),
    [symbolEditor, setSymbolEditor] = useState(false),
    [subtreeDelete, setSubtreeDelete] = useState(false),
    [resetComposition, setResetComposition] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const editorScope = `saved-orbat:${draft?.versionId ?? "none"}`;
  const unapplied = useUnappliedSymbolEdits(editorScope);
  const dirty = useMemo(
      () => !!draft && JSON.stringify(draft) !== JSON.stringify(saved),
      [draft, saved],
    ),
    readonly = busy;
  const recovery = useWorkingCopy({
    kind: "orbat",
    id: saved?.versionId,
    label: saved?.name ?? "ORBAT",
    source: saved,
    value: draft,
    dirty,
    busy: busy || unapplied,
    apply: history.replace,
  });
  useRecoveryOpen("orbat", (d) => {
    void run(async () => {
      if (dirty || unapplied)
        throw Error(
          "Save or discard this ORBAT before opening a recovery source.",
        );
      adopt(
        (await desktop.symbols({ type: "get", kind: "ORBAT", id: d.id }))
          .orbat!,
      );
    });
  });
  useEditorProtection({
    name: `ORBATs${draft ? ` — ${draft.name}` : ""}`,
    dirty,
    busy,
  });
  const node = draft?.nodes.find((n) => n.nodeId === selected);
  useCatalogSearch("ORBAT", draft);
  useSearchOpen("catalog", (target) => {
    if (target.area !== "catalog" || target.catalogKind !== "ORBAT") return;
    void run(async () => {
      if (draft?.versionId !== target.catalogId) {
        if (dirty || unapplied)
          throw Error(
            "Save or discard this ORBAT's edits before opening another ORBAT.",
          );
        adopt(
          (
            await desktop.symbols({
              type: "get",
              kind: "ORBAT",
              id: target.catalogId,
            })
          ).orbat!,
        );
      }
      if (target.nodeId) setSelected(target.nodeId);
    });
  });
  useEffect(() => {
    if (draft && !draft.nodes.some((n) => n.nodeId === selected))
      setSelected(draft.rootNodeId);
  }, [draft, selected]);
  const validDraft = useMemo(
    () => (draft ? savedOrbatVersionSchema.safeParse(draft) : null),
    [draft],
  );
  const diagram = useMemo(
    () => (validDraft?.success ? diagramFromSaved(draft!) : null),
    [draft],
  );
  useEffect(() => onLibraryChange(), [generation, onLibraryChange]);
  const adopt = (v: SavedOrbatVersion) => {
    setTool(null);
    setToolBusy(false);
    history.replace(v);
    setSaved(structuredClone(v));
    setSelected(
      v.nodes.some((n) => n.nodeId === selected) ? selected : v.rootNodeId,
    );
    setSymbolEditor(false);
    setGeneration((n) => n + 1);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      if (unapplied) throw Error(unappliedSymbolMessage);
      await fn();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  const edit = (fn: (v: SavedOrbatVersion) => SavedOrbatVersion) => {
    if (!draft || readonly) return;
    try {
      history.commit(fn(draft));
      setError("");
    } catch (e) {
      setError(editorError(e));
    }
  };
  const patchNode = (fn: (n: OrbatNode) => void) =>
    edit((v) => {
      const next = structuredClone(v);
      const n = next.nodes.find((n) => n.nodeId === selected);
      if (!n) throw Error("Select a unit first");
      fn(n);
      return next;
    });
  const clean = () => {
    if (dirty || unapplied)
      throw Error("Save or discard the current ORBAT edits first.");
  };
  useEffect(() => {
    if (!openRequest) return;
    void run(async () => {
      clean();
      adopt(
        (
          await desktop.symbols({
            type: "get",
            kind: "ORBAT",
            id: openRequest.id,
          })
        ).orbat!,
      );
    });
  }, [openRequest?.nonce]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    void desktop
      .symbols({
        type: "browse",
        kind: "ORBAT",
        query: { search, status: "", offset, limit: 30 },
      })
      .then((r) => {
        if (!stopped) {
          setItems(r.page!.items);
          setTotal(r.page!.total);
        }
      })
      .catch((e) => setError(editorError(e)));
    return () => {
      stopped = true;
    };
  }, [active, search, offset, generation]);

  const chooseProfile = (p: UnitProfile) =>
    void run(async () => {
      if (profilePicker === "CREATE") {
        clean();
        adopt(
          (
            await desktop.symbols({
              type: "orbat-from-profile",
              id: p.unitProfileVersionId,
              name,
            })
          ).orbat!,
        );
      } else if (draft && node) {
        const r = await desktop.symbols({
          type: "profile-node",
          id: p.unitProfileVersionId,
          parentNodeId: node.nodeId,
        });
        history.commit(addOrbatNode(draft, r.node!));
        setSelected(r.node!.nodeId);
      }
      setProfilePicker(null);
    });
  const symbol =
    node?.symbolOverride?.definition ??
    (node?.unit.kind === "UNIT_PROFILE"
      ? node.unit.defaultSymbol?.definition
      : node?.unit.symbol?.definition);
  const editSelectedSymbol = () => {
    if (!symbol)
      patchNode((n) => {
        n.symbolOverride = {
          definition: newSymbolDefinition(uid),
          source: null,
        };
      });
    setSymbolEditor(true);
  };
  const previewSymbol =
    diagram?.nodes.find((n) => n.id === selected)?.symbol ?? symbol;
  const insertSymbol = (
    v: SavedOrbatVersion,
    snapshot: SymbolSnapshot,
    target: string,
    position: TreeDrop,
    id: string,
  ) => {
    const next = structuredClone(v),
      dest = next.nodes.find((n) => n.nodeId === target);
    if (!dest) throw Error("Select a destination unit");
    const identity = newUnitProfile(
      snapshot.definition.amplifiers.uniqueDesignation?.trim().slice(0, 160) ||
        "New unit",
      uid,
      new Date().toISOString(),
    ).identity;
    next.nodes.push({
      nodeId: id,
      parentNodeId: target,
      unit: {
        kind: "INLINE_UNIT",
        identity,
        symbol: structuredClone(snapshot),
      },
      nameOverride: null,
      annotation: "",
      symbolOverride: null,
    });
    const result =
      position === "CHILD"
        ? savedOrbatVersionSchema.parse(next)
        : moveOrbatSubtree(next, id, target, position);
    return result;
  };
  const useSymbol = (
    snapshot: SymbolSnapshot,
    target: string,
    position: TreeDrop,
    id: string = uid(),
  ) =>
    edit((v) => {
      const result = insertSymbol(v, snapshot, target, position, id);
      setSelected(id);
      return result;
    });
  const addRoot = (snapshot: SymbolSnapshot, name: string) => {
    if (!draft || draft.nodes.length) return;
    history.commit(
      addCatalogOrbatRoot(draft, snapshot, name, uid, new Date().toISOString()),
    );
    setSelected(draft.rootNodeId);
  };
  return (
    <BusyBoundary
      busy={busy}
      className="symbol-library orbat-library"
      inert={busy}
    >
      {recovery}
      <p className="workspace-lede">
        Build an ORBAT from saved organizations or add units individually.
      </p>
      {error && !tool && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {active &&
        previewHost &&
        node &&
        createPortal(
          <section
            className="workbench-unit-preview"
            data-preview-unit-id={node.nodeId}
          >
            <small>Selected ORBAT unit</small>
            <h3>{node.nameOverride ?? node.unit.identity.fullDesignation}</h3>
            {previewSymbol ? (
              <GraphicPreview
                key={`preview:${selected}`}
                automaticFit
                compactControls
                fitToWidth
                fitToViewport
                active={active}
                request={{
                  kind: "SYMBOL",
                  input: {
                    definition: previewSymbol,
                    size: 100,
                    context: "ORBAT_NODE",
                    labelSide: "RIGHT",
                  },
                }}
              />
            ) : (
              <p>No symbol selected.</p>
            )}
            <div className="workbench-unit-actions">
              <button
                aria-label="Edit selected unit symbol"
                title="Edit selected unit symbol"
                disabled={readonly || unapplied}
                onClick={editSelectedSymbol}
              >
                Edit symbol
              </button>
              <SaveUnitSymbol
                key={`save-symbol:${node.nodeId}`}
                definition={previewSymbol}
                name={node.nameOverride ?? node.unit.identity.fullDesignation}
                disabled={readonly || unapplied}
                onSaved={onLibraryChange}
              />
            </div>
          </section>,
          previewHost,
        )}

      <div className="orbat-file-tools">
        <div className="orbat-map-switcher">
          <Field
            label="Find ORBAT map"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setOffset(0);
            }}
          />
          <label className="field">
            <span>ORBAT map · {countLabel(total, "map")}</span>
            <select
              aria-label="ORBAT map"
              disabled={busy || dirty || unapplied}
              value={draft?.versionId ?? ""}
              onChange={(event) => {
                const id = event.target.value;
                if (id)
                  void run(async () => {
                    clean();
                    adopt(
                      (
                        await desktop.symbols({
                          type: "get",
                          kind: "ORBAT",
                          id,
                        })
                      ).orbat!,
                    );
                  });
              }}
            >
              <option value="">Choose an ORBAT</option>
              {draft &&
                !items.some((item) => item.versionId === draft.versionId) && (
                  <option value={draft.versionId}>{draft.name}</option>
                )}
              {items.map((item) => (
                <option key={item.versionId} value={item.versionId}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {total > 30 && (
            <div className="button-row">
              <button
                disabled={!offset}
                onClick={() => setOffset((n) => Math.max(0, n - 30))}
              >
                Previous ORBATs
              </button>
              <button
                disabled={offset + 30 >= total}
                onClick={() => setOffset((n) => n + 30)}
              >
                Next ORBATs
              </button>
            </div>
          )}
        </div>

        <div
          className="builder-command-bar"
          role="toolbar"
          aria-label="ORBAT workspace actions"
        >
          <button
            disabled={busy || dirty || unapplied}
            onClick={() => setTool("new")}
          >
            New ORBAT
          </button>

          <button
            disabled={busy || dirty || unapplied}
            onClick={() => setTool("import")}
          >
            Import JSON
          </button>
          <button
            disabled={!draft?.nodes.length || busy || dirty || unapplied}
            onClick={() => setTool("export")}
          >
            Export
          </button>
          <button onClick={() => setTool("history")}>Saved exports</button>
        </div>
      </div>
      {tool && active && (
        <BuilderDialog
          title={
            {
              new: "New ORBAT",
              import: "Import Ordo JSON",
              export: "Export ORBAT",
              history: "Saved exports",
            }[tool]
          }
          busy={busy || toolBusy}
          onClose={() => setTool(null)}
        >
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {tool === "new" && (
            <div className="builder-new-form">
              {" "}
              <Field label="New ORBAT name" value={name} onChange={setName} />
              <div className="button-row">
                <button
                  disabled={busy || dirty || unapplied}
                  onClick={() =>
                    void run(async () => {
                      clean();
                      adopt(
                        (
                          await desktop.symbols({
                            type: "new",
                            kind: "ORBAT",
                            name,
                          })
                        ).orbat!,
                      );
                    })
                  }
                >
                  Create ORBAT
                </button>
                <button
                  disabled={busy || dirty || unapplied}
                  onClick={() => setProfilePicker("CREATE")}
                >
                  Create from organization
                </button>
              </div>
            </div>
          )}
          {tool === "import" && (
            <>
              {" "}
              <LibraryImportPanel
                expanded
                onBusyChange={setToolBusy}
                disabled={busy || dirty || unapplied}
                onImported={async (targets) => {
                  setGeneration((n) => n + 1);
                  const first = targets.find((t) => t.kind === "ORBAT");
                  if (!first && targets[0] && onOpenImported) {
                    setTool(null);
                    setToolBusy(false);
                    onOpenImported(targets[0].kind, targets[0].versionId);
                  }
                  if (first)
                    adopt(
                      (
                        await desktop.symbols({
                          type: "get",
                          kind: "ORBAT",
                          id: first.versionId,
                        })
                      ).orbat!,
                    );
                }}
              />
            </>
          )}
          {tool === "export" && draft && (
            <>
              {" "}
              <GraphicExportPanel
                expanded
                onBusyChange={setToolBusy}
                key={draft.versionId}
                product="ORBAT"
                source={{
                  kind: "SAVED_ORBAT",
                  versionId: draft.versionId,
                  expectedContentVersion: draft.contentVersion,
                }}
                disabled={dirty || busy || unapplied}
                units={draft.nodes.map((n) => ({
                  id: n.nodeId,
                  name: n.nameOverride ?? n.unit.identity.fullDesignation,
                }))}
              />
            </>
          )}
          {tool === "history" && (
            <GraphicExportHistory key={generation} expanded />
          )}
        </BuilderDialog>
      )}
      <div className="symbol-library-grid builder-focused">
        <section className="symbol-authoring">
          {draft ? (
            <>
              <div className="authoring-toolbar">
                <div>
                  <h2>{draft.name}</h2>
                  <label className="field workbench-name-field">
                    <span>ORBAT name</span>
                    <input
                      value={draft.name}
                      maxLength={160}
                      disabled={unapplied || readonly}
                      onChange={(event) =>
                        edit((v) => ({ ...v, name: event.target.value }))
                      }
                    />
                  </label>
                  <SaveStatus busy={busy} dirty={dirty} pending={unapplied} />
                </div>
                <div className="button-row">
                  <button
                    aria-label="Undo ORBAT edit"
                    title="Undo ORBAT edit"
                    className="workbench-icon-button"
                    disabled={unapplied || readonly || !history.canUndo}
                    onClick={history.undo}
                  >
                    <WorkbenchIcon name="undo" />
                  </button>
                  <button
                    aria-label="Redo ORBAT edit"
                    title="Redo ORBAT edit"
                    className="workbench-icon-button"
                    disabled={unapplied || readonly || !history.canRedo}
                    onClick={history.redo}
                  >
                    <WorkbenchIcon name="redo" />
                  </button>
                  {
                    <>
                      <button
                        className="primary"
                        disabled={busy || !dirty || unapplied}
                        onClick={() =>
                          void run(async () =>
                            adopt(
                              (
                                await desktop.symbols({
                                  type: "save-orbat",
                                  value: draft,
                                  expected: saved!.contentVersion,
                                })
                              ).orbat!,
                            ),
                          )
                        }
                      >
                        Save ORBAT
                      </button>
                      <button
                        aria-label="Discard ORBAT edits"
                        title="Discard ORBAT edits"
                        disabled={busy || !dirty || unapplied}
                        onClick={() => saved && adopt(structuredClone(saved))}
                      >
                        Discard
                      </button>
                      <button
                        disabled={busy || dirty || unapplied}
                        onClick={() =>
                          void run(async () =>
                            adopt(
                              (
                                await desktop.symbols({
                                  type: "derive",
                                  kind: "ORBAT",
                                  id: draft.versionId,
                                  versionLabel: "1.0.0",
                                  newFamily: true,
                                })
                              ).orbat!,
                            ),
                          )
                        }
                      >
                        Duplicate ORBAT
                      </button>
                      <DeleteItemButton
                        target={{ kind: "orbat", id: draft.versionId }}
                        label="Delete ORBAT"
                        disabled={busy || dirty || unapplied}
                        onDeleted={() => {
                          history.replace(null);
                          setSaved(null);
                          setGeneration((n) => n + 1);
                        }}
                      />
                    </>
                  }
                </div>
              </div>
              {node && (
                <div className="orbat-unit-strip">
                  <fieldset disabled={unapplied || readonly}>
                    <Field
                      label="ORBAT unit display name"
                      value={
                        node.nameOverride ?? node.unit.identity.fullDesignation
                      }
                      onChange={(v) =>
                        patchNode((n) => {
                          if (n.unit.kind === "INLINE_UNIT")
                            n.unit.identity.fullDesignation = v;
                          else n.nameOverride = v || null;
                        })
                      }
                    />
                    <Field
                      label="ORBAT annotation"
                      value={node.annotation}
                      onChange={(v) =>
                        patchNode((n) => {
                          n.annotation = v;
                        })
                      }
                    />
                  </fieldset>
                </div>
              )}
              <div className="orbat-composition">
                {!!draft.nodes.length && (
                  <details
                    key={"inspector:" + draft.versionId}
                    className="orbat-inspector"
                  >
                    <summary>Unit actions and layout</summary>
                    <label className="field">
                      <span>Selected ORBAT unit</span>
                      <select
                        disabled={unapplied}
                        aria-label="Selected ORBAT unit"
                        value={selected}
                        onChange={(e) => {
                          setSelected(e.target.value);
                          setSymbolEditor(false);
                        }}
                      >
                        {draft.nodes.map((n) => (
                          <option value={n.nodeId} key={n.nodeId}>
                            {n.nameOverride ?? n.unit.identity.fullDesignation}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="button-row">
                      <button
                        disabled={unapplied || readonly || !node}
                        onClick={() =>
                          edit((v) => {
                            const id = uid(),
                              next = addOrbatNode(v, {
                                nodeId: id,
                                parentNodeId: node!.nodeId,
                                unit: {
                                  kind: "INLINE_UNIT",
                                  identity: newUnitProfile(
                                    "New unit",
                                    uid,
                                    new Date().toISOString(),
                                  ).identity,
                                  symbol: null,
                                },
                                nameOverride: null,
                                annotation: "",
                                symbolOverride: null,
                              });
                            setSelected(id);
                            return next;
                          })
                        }
                      >
                        Add subordinate unit
                      </button>
                      <button
                        disabled={unapplied || readonly || !node}
                        onClick={() => setProfilePicker("ADD")}
                      >
                        Add from organization
                      </button>
                    </div>
                    {node && (
                      <fieldset disabled={unapplied || readonly}>
                        <div className="button-row">
                          <button
                            disabled={unapplied}
                            title="Change the symbol while keeping this unit and its subordinates."
                            onClick={() => setSymbolPicker(true)}
                          >
                            Replace symbol only
                          </button>
                          <button
                            disabled={unapplied}
                            onClick={editSelectedSymbol}
                          >
                            Edit unit symbol
                          </button>
                          {node.symbolOverride && (
                            <button
                              disabled={unapplied}
                              onClick={() =>
                                patchNode((n) => {
                                  n.symbolOverride = null;
                                })
                              }
                            >
                              Restore original symbol
                            </button>
                          )}
                        </div>
                        <button
                          className="danger"
                          disabled={
                            unapplied ||
                            node.nodeId === draft.rootNodeId ||
                            draft.nodes.some(
                              (n) => n.parentNodeId === node.nodeId,
                            )
                          }
                          onClick={() =>
                            edit((v) => {
                              const next = deleteOrbatNode(v, node.nodeId);
                              setSelected(v.rootNodeId);
                              return next;
                            })
                          }
                        >
                          Delete selected leaf unit
                        </button>
                      </fieldset>
                    )}
                    <div ref={setLayoutHost} className="selected-unit-layout" />
                  </details>
                )}
                {!draft.nodes.length ? (
                  <EmptyOrbatCanvas
                    id={draft.versionId}
                    active={active}
                    disabled={readonly || unapplied}
                    onSymbol={addRoot}
                    onChoose={() => setSymbolPicker(true)}
                    onBusy={setBusy}
                    onError={setError}
                  />
                ) : validDraft?.success ? (
                  <OrbatCanvas
                    compactControls
                    fitMaxHeight={360}
                    inspectorHost={layoutHost}
                    key={draft.versionId}
                    selectedId={selected}
                    diagram={diagram!}
                    active={active}
                    readonly={readonly || unapplied}
                    selectionLocked={unapplied}
                    rootId={draft.rootNodeId}
                    onMove={(id, target, position) =>
                      edit((v) => moveOrbatSubtree(v, id, target, position))
                    }
                    previewMove={(id, target, position) =>
                      diagramFromSaved(
                        moveOrbatSubtree(draft, id, target, position),
                      )
                    }
                    previewSymbol={(snapshot, target, position, id) =>
                      diagramFromSaved(
                        insertSymbol(draft, snapshot, target, position, id),
                      )
                    }
                    onSymbol={useSymbol}
                    onSelect={(id) => {
                      setSelected(id);
                      setSymbolEditor(false);
                    }}
                    onLayout={(l) => edit((v) => changeOrbatLayout(v, l))}
                    onReparent={(id, parent) =>
                      edit((v) => reparentOrbatNode(v, id, parent))
                    }
                  />
                ) : (
                  <p role="status">
                    Complete the required names and fields to update the ORBAT
                    preview.
                  </p>
                )}
              </div>
              {node && node.nodeId !== draft.rootNodeId && (
                <div className="button-row">
                  <button
                    disabled={unapplied || readonly}
                    onClick={() => setSubtreeDelete(true)}
                  >
                    Delete selected subtree…
                  </button>
                  {subtreeDelete && (
                    <section
                      role="dialog"
                      aria-label="Delete ORBAT subtree"
                      className="notice"
                    >
                      <p>
                        Delete{" "}
                        {
                          subtreeIds(
                            draft.nodes.map((n) => ({
                              id: n.nodeId,
                              parentId: n.parentNodeId,
                            })),
                            node.nodeId,
                          ).size
                        }{" "}
                        units from{" "}
                        {node.nameOverride ??
                          node.unit.identity.fullDesignation}
                        ? You can undo this change before leaving the editor.
                      </p>
                      <button
                        disabled={unapplied || readonly}
                        onClick={() => {
                          edit((v) => deleteOrbatSubtree(v, node.nodeId));
                          setSubtreeDelete(false);
                          setSelected(draft.rootNodeId);
                        }}
                      >
                        Delete subtree
                      </button>
                      <button onClick={() => setSubtreeDelete(false)}>
                        Cancel subtree deletion
                      </button>
                    </section>
                  )}
                </div>
              )}
              {!!draft.nodes.length && (
                <details className="composition-reset">
                  <summary>Reset composition</summary>
                  <p>
                    Keep the root unit and its symbol; remove all{" "}
                    {draft.nodes.length - 1} subordinate units and reset the
                    layout. You can undo this change before leaving the editor.
                  </p>
                  <button
                    disabled={unapplied || readonly}
                    onClick={() => setResetComposition(true)}
                  >
                    Reset to root unit…
                  </button>
                  {resetComposition && (
                    <div role="dialog" aria-label="Reset ORBAT composition">
                      <button
                        disabled={unapplied || readonly}
                        onClick={() => {
                          edit(resetOrbatComposition);
                          setSelected(draft.rootNodeId);
                          setResetComposition(false);
                        }}
                      >
                        Confirm reset to root
                      </button>
                      <button onClick={() => setResetComposition(false)}>
                        Keep composition
                      </button>
                    </div>
                  )}
                </details>
              )}
            </>
          ) : (
            <Panel title="ORBAT composer">
              <p>Create an ORBAT or select a saved one to begin.</p>
            </Panel>
          )}
        </section>
      </div>
      {active && symbolEditor && symbol && (
        <BuilderDialog
          title="Edit unit symbol"
          closeLabel="Done"
          busy={unapplied}
          onClose={() => setSymbolEditor(false)}
        >
          <p className="muted">
            Changes apply to the selected unit. Save the ORBAT to keep them.
          </p>
          <EditorScope id={editorScope}>
            <SymbolEditor
              key={selected}
              value={symbol}
              active={active}
              readonly={readonly}
              onChange={(definition) =>
                patchNode((n) => {
                  n.symbolOverride = {
                    definition: {
                      ...definition,
                      definitionId:
                        n.symbolOverride?.definition.definitionId ?? uid(),
                      origin: { kind: "MANUAL" },
                    },
                    source: null,
                  };
                })
              }
            />
          </EditorScope>
        </BuilderDialog>
      )}
      {profilePicker && (
        <UnitProfilePicker
          title={
            profilePicker === "CREATE"
              ? "Create ORBAT from organization"
              : "Add subordinate organization"
          }
          onCancel={() => setProfilePicker(null)}
          onSelect={chooseProfile}
        />
      )}
      {symbolPicker && (
        <SavedSymbolPicker
          onCancel={() => setSymbolPicker(false)}
          onSelect={(pin, name) => {
            if (draft && !draft.nodes.length) {
              addRoot(
                {
                  definition: pin.definition,
                  source: {
                    familyId: pin.familyId,
                    versionId: pin.versionId,
                    contentHash: pin.contentHash,
                  },
                },
                name,
              );
              setSymbolPicker(false);
              return;
            }
            patchNode((n) => {
              n.symbolOverride = {
                definition: pin.definition,
                source: {
                  familyId: pin.familyId,
                  versionId: pin.versionId,
                  contentHash: pin.contentHash,
                },
              };
            });
            setSymbolPicker(false);
          }}
        />
      )}
      {draft?.exchangeOrigin && (
        <ImportReceiptView
          key={draft.exchangeOrigin.importId}
          id={draft.exchangeOrigin.importId}
        />
      )}
    </BusyBoundary>
  );
}
