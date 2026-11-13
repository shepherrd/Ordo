import { BuilderDialog } from "./BuilderDialog";
import {
  useCatalogSearch,
  useSearchOpen,
  focusSearchField,
} from "./SearchProvider";
import { createPortal } from "react-dom";
import { FmDictionary } from "./FmDictionary";
import { SaveStatus } from "./SaveStatus";
import { WorkbenchIcon } from "./WorkbenchIcon";
import { editorError } from "./editor-error";
import { DeleteItemButton } from "./DeleteItemButton";
import {
  BusyBoundary,
  useWorkspaceApi,
  useEditorProtection,
  useWorkspaceSession,
  EditorScope,
} from "./WorkspaceContext";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { SavedSymbolVersion } from "../../domain/symbology";
import { SymbolEditor } from "./SymbolEditor";
import { GraphicExportPanel } from "./GraphicExportPanel";
import { GraphicExportHistory } from "./GraphicExportHistory";
import { LibraryImportPanel, ImportReceiptView } from "./LibraryImportPanel";
import { Field, Panel } from "./Fields";
import { useDraftHistory } from "./useDraftHistory";
import { useWorkingCopy, useRecoveryOpen } from "./WorkingCopies";
import { BuiltinSymbolCatalog } from "./BuiltinSymbolCatalog";
import "./symbology.css";
export default function MilitarySymbolsWorkspace({
  active,
  openRequest,
  onOpenImported,
  previewHost,
  onLibraryChange,
  onBlockedChange,
  dictionaryOpen,
  onCloseDictionary,
  onDictionaryApplied,
}: {
  active: boolean;
  openRequest?: { id: string; nonce: number };
  onOpenImported?: (kind: "SYMBOL" | "ORBAT", id: string) => void;
  previewHost: HTMLElement | null;
  onLibraryChange: () => void;
  onBlockedChange: (blocked: boolean) => void;
  dictionaryOpen: boolean;
  onCloseDictionary: () => void;
  onDictionaryApplied: () => void;
}) {
  const desktop = useWorkspaceApi();
  const [tool, setTool] = useState<
    "new" | "catalog" | "import" | "export" | "history" | null
  >(null);
  const [toolBusy, setToolBusy] = useState(false);
  const session = useWorkspaceSession();
  useSyncExternalStore(session.subscribe, session.getRevision);
  const [generation, setGeneration] = useState(0);
  const history = useDraftHistory<SavedSymbolVersion | null>(null),
    draft = history.value,
    setDraft = history.commit;
  const [saved, setSaved] = useState<SavedSymbolVersion | null>(null),
    [newName, setNewName] = useState("New military symbol"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  useCatalogSearch("SYMBOL", draft);
  useSearchOpen("catalog", (target) => {
    if (target.area !== "catalog" || target.catalogKind !== "SYMBOL") return;
    void run(async () => {
      if (target.catalogId !== draft?.versionId) {
        clean();
        adopt(
          (
            await desktop.symbols({
              type: "get",
              kind: "SYMBOL",
              id: target.catalogId,
            })
          ).symbol!,
        );
      }
      focusSearchField(
        target.field === "tags" ? "Tags (comma separated)" : "Symbol name",
      );
    });
  });
  const editorScope = `saved-symbol:${draft?.versionId ?? "none"}`;
  const nestedDirty = session
    .protectionFor(editorScope)
    .editors.some((editor) => editor.dirty);
  useEffect(
    () => onBlockedChange(busy || dirty || nestedDirty),
    [busy, dirty, nestedDirty, onBlockedChange],
  );
  useEffect(() => onLibraryChange(), [generation, onLibraryChange]);
  const recovery = useWorkingCopy({
    kind: "symbol",
    id: saved?.versionId,
    label: saved?.name ?? "Military symbol",
    source: saved,
    value: draft,
    dirty,
    busy: busy || nestedDirty,
    apply: history.replace,
  });
  useRecoveryOpen("symbol", (d) => {
    void run(async () => {
      clean();
      adopt(
        (await desktop.symbols({ type: "get", kind: "SYMBOL", id: d.id }))
          .symbol!,
      );
    });
  });
  useEditorProtection({
    name: `Military Symbols${draft ? ` — ${draft.name}` : ""}`,
    dirty,
    busy,
  });

  const adopt = (v: SavedSymbolVersion) => {
    setTool(null);
    setToolBusy(false);
    history.replace(v);
    setSaved(structuredClone(v));
    setGeneration((v) => v + 1);
  };
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
  const clean = () => {
    if (dirty || nestedDirty)
      throw Error(
        "Save or discard the current changes before opening another item.",
      );
  };
  useEffect(() => {
    if (!openRequest) return;
    void run(async () => {
      clean();
      adopt(
        (
          await desktop.symbols({
            type: "get",
            kind: "SYMBOL",
            id: openRequest.id,
          })
        ).symbol!,
      );
    });
  }, [openRequest?.nonce]);
  return (
    <BusyBoundary busy={busy} className="symbol-library" inert={busy}>
      {dictionaryOpen &&
        createPortal(
          <FmDictionary
            value={draft?.definition}
            targetName={draft?.name}
            disabled={busy || nestedDirty}
            onClose={onCloseDictionary}
            onChange={(definition) => {
              setDraft((current) =>
                current ? { ...current, definition } : current,
              );
              onDictionaryApplied();
            }}
          />,
          document.body,
        )}
      {recovery}
      {error && !tool && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}

      <div
        className="builder-command-bar"
        role="toolbar"
        aria-label="Symbol workspace actions"
      >
        <button
          disabled={busy || dirty || nestedDirty}
          onClick={() => setTool("new")}
        >
          New symbol
        </button>
        <button
          disabled={busy || dirty || nestedDirty}
          onClick={() => setTool("catalog")}
        >
          Browse built-in catalog
        </button>
        <button
          disabled={busy || dirty || nestedDirty}
          onClick={() => setTool("import")}
        >
          Import JSON
        </button>
        <button
          disabled={!draft || busy || dirty || nestedDirty}
          onClick={() => setTool("export")}
        >
          Export
        </button>
        <button onClick={() => setTool("history")}>Saved exports</button>
      </div>
      {tool && active && (
        <BuilderDialog
          title={
            {
              new: "New symbol",
              catalog: "Built-in catalog",
              import: "Import Ordo JSON",
              export: "Export symbol",
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
              <Field
                label="New symbol name"
                value={newName}
                onChange={setNewName}
              />
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    clean();
                    adopt(
                      (
                        await desktop.symbols({
                          type: "new",
                          kind: "SYMBOL",
                          name: newName,
                        })
                      ).symbol!,
                    );
                  })
                }
              >
                Create symbol
              </button>
            </div>
          )}
          {tool === "catalog" && (
            <>
              <BuiltinSymbolCatalog
                expanded
                active={active}
                disabled={busy || dirty || nestedDirty}
                onCreate={async (entry) => {
                  clean();
                  if (!entry.definition)
                    throw Error("This entry has no verified symbol mapping.");
                  setBusy(true);
                  try {
                    adopt(
                      (
                        await desktop.symbols({
                          type: "new-symbol-from-definition",
                          name: entry.name.slice(0, 160),
                          definition: entry.definition,
                        })
                      ).symbol!,
                    );
                    setMessage(
                      "Created an editable symbol from the built-in catalog.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </>
          )}
          {tool === "import" && (
            <>
              {" "}
              <LibraryImportPanel
                expanded
                onBusyChange={setToolBusy}
                disabled={busy || dirty || nestedDirty}
                onImported={async (targets) => {
                  setGeneration((n) => n + 1);
                  const first = targets.find((t) => t.kind === "SYMBOL");
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
                          kind: "SYMBOL",
                          id: first.versionId,
                        })
                      ).symbol!,
                    );
                }}
              />
            </>
          )}
          {tool === "export" && draft && (
            <>
              <GraphicExportPanel
                expanded
                onBusyChange={setToolBusy}
                key={draft.versionId}
                product="SYMBOL"
                source={{
                  kind: "SAVED_SYMBOL",
                  versionId: draft.versionId,
                  expectedContentVersion: draft.contentVersion,
                }}
                disabled={dirty || busy || nestedDirty}
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
                  <h2 className="symbol-name-heading">{draft.name}</h2>
                  <label className="field workbench-name-field">
                    <span>Symbol name</span>
                    <input
                      value={draft.name}
                      maxLength={160}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                    />
                  </label>
                  <SaveStatus busy={busy} dirty={dirty} pending={nestedDirty} />
                </div>
                <div className="button-row">
                  <button
                    aria-label="Undo symbol edit"
                    title="Undo symbol edit"
                    className="workbench-icon-button"
                    disabled={busy || nestedDirty || !history.canUndo}
                    onClick={history.undo}
                  >
                    <WorkbenchIcon name="undo" />
                  </button>
                  <button
                    aria-label="Redo symbol edit"
                    title="Redo symbol edit"
                    className="workbench-icon-button"
                    disabled={busy || nestedDirty || !history.canRedo}
                    onClick={history.redo}
                  >
                    <WorkbenchIcon name="redo" />
                  </button>
                  {
                    <>
                      <button
                        className="primary"
                        disabled={busy || !dirty || nestedDirty}
                        onClick={() =>
                          void run(async () => {
                            adopt(
                              (
                                await desktop.symbols({
                                  type: "save-symbol",
                                  value: draft,
                                  expected: saved!.contentVersion,
                                })
                              ).symbol!,
                            );
                            setMessage("Symbol saved.");
                          })
                        }
                      >
                        Save symbol
                      </button>
                      <DeleteItemButton
                        target={{ kind: "symbol", id: draft.versionId }}
                        label="Delete symbol"
                        disabled={busy || dirty || nestedDirty}
                        onDeleted={() => {
                          history.replace(null);
                          setSaved(null);
                          setGeneration((n) => n + 1);
                        }}
                      />
                      <button
                        aria-label="Discard symbol edits"
                        title="Discard symbol edits"
                        disabled={busy || !dirty || nestedDirty}
                        onClick={() => {
                          setDraft(structuredClone(saved));
                          setError("");
                        }}
                      >
                        Discard
                      </button>
                    </>
                  }
                </div>
              </div>
              <details className="builder-document-options">
                <summary>Tags</summary>
                <fieldset disabled={busy}>
                  <div className="field-grid">
                    <Field
                      label="Tags (comma separated)"
                      value={draft.tags.join(", ")}
                      onChange={(v) =>
                        setDraft({
                          ...draft,
                          tags: v
                            .split(",")
                            .map((v) => v.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                </fieldset>
              </details>
              <EditorScope id={editorScope}>
                <SymbolEditor
                  externalDictionary
                  key={draft.versionId}
                  value={draft.definition}
                  onChange={(definition) => setDraft({ ...draft, definition })}
                  readonly={busy}
                  active={active}
                  previewHost={previewHost}
                />
              </EditorScope>
              <details>
                <summary>Manage symbol</summary>

                <div className="button-row">
                  <button
                    disabled={busy || dirty || nestedDirty}
                    onClick={() =>
                      void run(async () =>
                        adopt(
                          (
                            await desktop.symbols({
                              type: "derive",
                              kind: "SYMBOL",
                              id: draft.versionId,
                              versionLabel: "1.0.0",
                              newFamily: true,
                            })
                          ).symbol!,
                        ),
                      )
                    }
                  >
                    Duplicate symbol
                  </button>
                </div>
              </details>
            </>
          ) : (
            <Panel title="Military symbol builder">
              <p>Select a symbol or create one to begin.</p>
            </Panel>
          )}
        </section>
      </div>
      {draft?.exchangeOrigin && (
        <ImportReceiptView
          key={draft.exchangeOrigin.importId}
          id={draft.exchangeOrigin.importId}
        />
      )}
    </BusyBoundary>
  );
}
