import { ModalBackdrop } from "./ModalBackdrop";
import { editorError } from "./editor-error";
import { countLabel } from "./ui-text";
import {
  useWorkspaceApi,
  useEditorProtection,
  useUnappliedSymbolEdits,
} from "./WorkspaceContext";
import { useEffect, useState } from "react";
import type { Operation, ResolvedConfig } from "../../domain/model";
import { metadata } from "../../domain/model";
import type { SavedOrbatVersion } from "../../domain/orbat";
import {
  changeOperationLayout,
  operationLayout,
  reparentOperationUnit,
  moveOperationSubtree,
  deleteOperationSubtree,
} from "../../domain/organization-actions";
import type { SymbolLibrarySummary } from "../../application/symbology-ports";
import {
  diagramFromOperation,
  diagramFromSaved,
} from "../../application/orbat-projection";
import { OrbatCanvas } from "./OrbatCanvas";
import { GraphicPreview } from "./GraphicPreview";
import { GraphicExportPanel } from "./GraphicExportPanel";
import { Field } from "./Fields";
import "./symbology.css";
import { assertOperation } from "../../domain/invariants";
import { subtreeIds, type TreeDrop } from "../../domain/organization-editing";
import type { SymbolSnapshot } from "../../domain/symbology";
import { SymbolTray } from "./SymbolTray";
import OperationSymbolEditor from "./OperationSymbolEditor";
import { SaveUnitSymbol } from "./SaveUnitSymbol";
export default function OperationOrbatPanel({
  operation,
  active,
  dirty,
  onChange,
  onImported,
  onDelete,
  config,
}: {
  operation: Operation;
  active: boolean;
  dirty: boolean;
  onChange: (next: Operation) => void;
  onImported: () => Promise<void>;
  onDelete: (id: string) => void;
  config: ResolvedConfig;
}) {
  const desktop = useWorkspaceApi();
  const [symbolGeneration, setSymbolGeneration] = useState(0);
  const unapplied = useUnappliedSymbolEdits();
  const [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [items, setItems] = useState<SymbolLibrarySummary[]>([]),
    [search, setSearch] = useState(""),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0),
    [source, setSource] = useState<SavedOrbatVersion | null>(null),
    [importId, setImportId] = useState(""),
    [parent, setParent] = useState(""),
    [duplicates, setDuplicates] = useState(false),
    [replaceLayout, setReplaceLayout] = useState(false),
    [deleteSubtree, setDeleteSubtree] = useState(false);
  const unit = operation.units.find((u) => u.id === selected);
  useEditorProtection({ name: "Operation ORBAT", dirty: false, busy });
  useEffect(() => {
    if (!operation.units.some((u) => u.id === selected))
      setSelected(operation.units[0]?.id ?? "");
  }, [operation.units, selected]);
  let diagram: ReturnType<typeof diagramFromOperation> | null = null,
    previewError = "";
  try {
    diagram = diagramFromOperation(operation, operationLayout(operation));
  } catch {
    previewError =
      "Complete the unit symbol fields to update the ORBAT preview.";
  }
  const apply = (fn: () => Operation) => {
    try {
      onChange(fn());
      setError("");
    } catch (e) {
      setError(editorError(e));
    }
  };
  const insertSymbol = (
    snapshot: SymbolSnapshot,
    target: string,
    position: TreeDrop,
    id: string,
  ) => {
    const next = structuredClone(operation),
      unit = next.units.find((u) => u.id === target);
    if (!unit) throw Error("Select a destination unit");
    const state = {
      schemaVersion: 1 as const,
      base: structuredClone(snapshot),
      override: null,
      labels: {
        uniqueDesignation: { kind: "UNIT_NAME" as const },
        higherFormation: { kind: "DEFINITION" as const },
      },
    };
    next.units.push({
      id,
      name:
        snapshot.definition.amplifiers.uniqueDesignation
          ?.trim()
          .slice(0, 160) || "New unit",
      metadata: metadata(config.doctrine.editingStatus),
      inTaskOrganization: true,
      parentUnitId: target,
      symbol: state,
    });
    const result =
      position === "CHILD"
        ? next
        : moveOperationSubtree(next, id, target, position);
    const valid = assertOperation(result, config);
    return valid;
  };
  const useSymbol = (
    snapshot: SymbolSnapshot,
    target: string,
    position: TreeDrop,
    id: string = crypto.randomUUID(),
  ) =>
    apply(() => {
      const result = insertSymbol(snapshot, target, position, id);
      setSelected(id);
      return result;
    });
  useEffect(() => {
    if (!open) return;
    let stopped = false;
    void desktop
      .symbols({
        type: "browse",
        kind: "ORBAT",
        query: { search, status: "", offset, limit: 20 },
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
  }, [open, search, offset]);
  const importSelected = async () => {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      await desktop.symbols({
        type: "import-orbat",
        operationId: operation.id,
        expectedRevision: operation.revision,
        orbatVersionId: source.versionId,
        importId,
        parentUnitId: parent || null,
        confirmDuplicate: duplicates,
        replaceLayout,
      });
      await onImported();
      setOpen(false);
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <p>
        Tree and ORBAT use the same operation units and parent relationships.
        Layout changes are saved with the operation revision.
      </p>
      {error && !open && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button
          disabled={dirty || busy || unapplied}
          onClick={() => {
            setOpen(true);
            setSource(null);
            setImportId(crypto.randomUUID());
            setDuplicates(false);
            setReplaceLayout(false);
          }}
        >
          Add from Saved ORBAT
        </button>
        {dirty && (
          <span className="muted">
            Save current changes before importing an ORBAT.
          </span>
        )}
      </div>
      <label className="field">
        <span>Selected operation unit</span>
        <select
          disabled={unapplied}
          aria-label="Selected operation unit"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a unit</option>
          {operation.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      {unit && (
        <div className="field-grid">
          <Field
            label="Unit name"
            value={unit.name}
            onChange={(name) =>
              apply(() => ({
                ...operation,
                units: operation.units.map((u) =>
                  u.id === unit.id ? { ...u, name } : u,
                ),
              }))
            }
          />
          <div className="button-row">
            <SaveUnitSymbol
              key={unit.id}
              definition={diagram?.nodes.find((n) => n.id === unit.id)?.symbol}
              name={unit.name}
              disabled={busy || unapplied}
              onSaved={() => setSymbolGeneration((n) => n + 1)}
            />
            <button
              className="danger"
              disabled={
                unapplied ||
                operation.units.some((u) => u.parentUnitId === unit.id)
              }
              onClick={() => onDelete(unit.id)}
            >
              Delete selected leaf unit
            </button>
          </div>
        </div>
      )}
      {diagram ? (
        <>
          <SymbolTray
            refresh={symbolGeneration}
            context={operation.id + ":" + operation.revision + ":" + selected}
            active={active}
            disabled={busy || unapplied || !unit}
            onUse={(s) => unit && useSymbol(s, unit.id, "CHILD")}
          />
          <OrbatCanvas
            selectedId={selected}
            diagram={diagram}
            active={active}
            readonly={busy || unapplied}
            selectionLocked={unapplied}
            onMove={(id, target, position) =>
              apply(() => moveOperationSubtree(operation, id, target, position))
            }
            previewMove={(id, target, position) => {
              const next = moveOperationSubtree(
                operation,
                id,
                target,
                position,
              );
              return diagramFromOperation(next, operationLayout(next));
            }}
            previewSymbol={(snapshot, target, position, id) => {
              const next = insertSymbol(snapshot, target, position, id);
              return diagramFromOperation(next, operationLayout(next));
            }}
            onSymbol={useSymbol}
            onSelect={setSelected}
            onLayout={(layout) =>
              apply(() => changeOperationLayout(operation, layout))
            }
            onReparent={(id, parentId) =>
              apply(() => reparentOperationUnit(operation, id, parentId))
            }
          />
        </>
      ) : (
        <p role="status">{previewError}</p>
      )}
      {unit && (
        <>
          <details>
            <summary>Edit selected unit symbol</summary>
            <OperationSymbolEditor
              key={unit.id}
              active={active}
              unit={unit}
              parentName={
                operation.units.find((u) => u.id === unit.parentUnitId)?.name ??
                null
              }
              onChange={(symbol) =>
                apply(() => ({
                  ...operation,
                  units: operation.units.map((u) =>
                    u.id === unit.id ? { ...u, symbol } : u,
                  ),
                }))
              }
            />
          </details>
          <button
            disabled={busy || unapplied}
            onClick={() => setDeleteSubtree(true)}
          >
            Delete selected subtree…
          </button>
          {deleteSubtree && (
            <section
              role="dialog"
              aria-label="Delete operation subtree"
              className="notice"
            >
              <p>
                Delete{" "}
                {
                  subtreeIds(
                    operation.units.map((u) => ({
                      id: u.id,
                      parentId: u.parentUnitId,
                    })),
                    unit.id,
                  ).size
                }{" "}
                units in this subtree? References from tasks and other planning
                data will block deletion.
              </p>
              <button
                disabled={unapplied}
                onClick={() => {
                  apply(() => {
                    const next = deleteOperationSubtree(
                      operation,
                      unit.id,
                      config,
                    );
                    setSelected(unit.parentUnitId ?? next.units[0]?.id ?? "");
                    return next;
                  });
                  setDeleteSubtree(false);
                }}
              >
                Delete subtree
              </button>
              <button onClick={() => setDeleteSubtree(false)}>
                Cancel subtree deletion
              </button>
            </section>
          )}
        </>
      )}
      <GraphicExportPanel
        product="ORBAT"
        source={{
          kind: "OPERATION",
          operationId: operation.id,
          revision: operation.revision,
          publicationId: null,
        }}
        disabled={dirty || busy || unapplied}
        units={operation.units.map((u) => ({ id: u.id, name: u.name }))}
      />
      {open && (
        <ModalBackdrop>
          <section
            className="modal profile-picker"
            role="dialog"
            aria-label="Add from Saved ORBAT"
          >
            <h2>Add from Saved ORBAT</h2>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <p>
              Adds copies of these units to this operation. Later edits to the
              saved ORBAT will not change them.
            </p>
            <Field
              label="Search ORBATs"
              value={search}
              onChange={(v) => {
                setSearch(v);
                setOffset(0);
              }}
            />
            <div className="two-columns">
              <div>
                {items.map((v) => (
                  <button
                    className="browse-row"
                    disabled={busy}
                    key={v.versionId}
                    onClick={() =>
                      void desktop
                        .symbols({
                          type: "get",
                          kind: "ORBAT",
                          id: v.versionId,
                        })
                        .then((r) => {
                          setSource(r.orbat!);
                          setImportId(crypto.randomUUID());
                        })
                        .catch((e) => setError(editorError(e)))
                    }
                  >
                    <strong>{v.name}</strong>
                  </button>
                ))}
                <div className="button-row">
                  <button
                    disabled={!offset}
                    onClick={() => setOffset((v) => Math.max(0, v - 20))}
                  >
                    Previous
                  </button>
                  <span>{countLabel(total, "ORBAT")}</span>
                  <button
                    disabled={offset + 20 >= total}
                    onClick={() => setOffset((v) => v + 20)}
                  >
                    Next
                  </button>
                </div>
              </div>
              <div>
                {source && (
                  <>
                    <p>{countLabel(source.nodes.length, "unit")}</p>
                    <GraphicPreview
                      request={{
                        kind: "ORBAT",
                        input: diagramFromSaved(source),
                      }}
                    />
                  </>
                )}
              </div>
            </div>
            <label className="field">
              <span>Attach root under</span>
              <select
                value={parent}
                disabled={busy}
                onChange={(e) => {
                  setParent(e.target.value);
                  setImportId(crypto.randomUUID());
                }}
              >
                <option value="">Top level</option>
                {operation.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={duplicates}
                disabled={busy}
                onChange={(e) => setDuplicates(e.target.checked)}
              />
              Allow another copy of an organization already in this operation
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={replaceLayout}
                disabled={busy}
                onChange={(e) => {
                  setReplaceLayout(e.target.checked);
                  setImportId(crypto.randomUUID());
                }}
              />
              Replace the operation's layout settings with this composition's
              settings
            </label>
            <div className="button-row">
              <button
                className="primary"
                disabled={!source || busy}
                onClick={() => void importSelected()}
              >
                Import ORBAT into operation
              </button>
              <button
                data-dialog-cancel
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel ORBAT import
              </button>
            </div>
          </section>
        </ModalBackdrop>
      )}
    </section>
  );
}
