import { createPortal } from "react-dom";
import { useEffect, useState, useRef, useMemo } from "react";
import type { DiagramRequest } from "../../application/orbat-projection";
import type { OrbatLayout } from "../../domain/orbat";
import { GraphicPreview } from "./GraphicPreview";
import { Field } from "./Fields";
import {
  planTreeDrop,
  reorderSibling,
  type TreeDrop,
} from "../../domain/organization-editing";
import type { SymbolSnapshot } from "../../domain/symbology";
import {
  readSymbolTransfer,
  symbolTransferType,
  symbolDragPreview,
  symbolDragNodeId,
  symbolDragEnded,
} from "./symbol-transfer";
import { useWorkspaceApi } from "./WorkspaceContext";
import type { OrbatPlacement } from "./orbat-placement-preview";
export function OrbatCanvas({
  diagram,
  active = true,
  readonly = false,
  selectionLocked = false,
  selectedId,
  onLayout,
  onReparent,
  onSelect,
  onMove,
  previewMove,
  previewSymbol,
  onSymbol,
  rootId,
  inspectorHost,
  fitMaxHeight,
  compactControls = false,
}: {
  diagram: DiagramRequest;
  active?: boolean;
  readonly?: boolean;
  selectionLocked?: boolean;
  selectedId?: string;
  onLayout: (layout: OrbatLayout) => void;
  onReparent: (id: string, parentId: string | null) => void;
  onSelect?: (id: string) => void;
  onMove?: (id: string, target: string, position: TreeDrop) => void;
  previewMove?: (
    id: string,
    target: string,
    position: TreeDrop,
  ) => DiagramRequest;
  onSymbol?: (
    snapshot: SymbolSnapshot,
    target: string,
    position: TreeDrop,
    nodeId?: string,
  ) => void;
  previewSymbol?: (
    snapshot: SymbolSnapshot,
    target: string,
    position: TreeDrop,
    nodeId: string,
  ) => DiagramRequest;
  rootId?: string;
  inspectorHost?: HTMLElement | null;
  fitMaxHeight?: number;
  compactControls?: boolean;
}) {
  const desktop = useWorkspaceApi();
  const transferGeneration = useRef(0);
  const interaction = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const inputKey = useMemo(() => JSON.stringify(diagram), [diagram]);
  useEffect(() => {
    transferGeneration.current++;
    return () => {
      transferGeneration.current++;
    };
  }, [inputKey, readonly, selectionLocked, active]);
  const [selected, setSelected] = useState(""),
    [mode, setMode] = useState<"SELECT" | "MOVE" | "REPARENT">("SELECT"),
    [parent, setParent] = useState(""),
    [drop, setDrop] = useState<{
      id: string;
      position: TreeDrop;
      error?: string;
    } | null>(null),
    [notice, setNotice] = useState(""),
    [placement, setPlacement] = useState<OrbatPlacement>(),
    [drag, setDrag] = useState<{
      id: string;
      x: number;
      y: number;
      pointerId: number;
      svg: SVGSVGElement;
      origin: DOMPoint;
    } | null>(null);
  const dragRef = useRef(drag);
  const symbolHover = useRef<string | null>(null);
  const moved = useRef(false);
  const movement = (
    drag: NonNullable<typeof dragRef.current>,
    x: number,
    y: number,
  ) => {
    const matrix = drag.svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const current = new DOMPoint(x, y).matrixTransform(matrix.inverse());
    return { x: current.x - drag.origin.x, y: current.y - drag.origin.y };
  };
  const cancelDrag = () => {
    const pointer = dragRef.current?.pointerId;
    dragRef.current = null;
    setDrag(null);
    setDrop(null);
    setPlacement(undefined);
    symbolHover.current = null;
    if (
      pointer !== undefined &&
      interaction.current?.hasPointerCapture(pointer)
    )
      interaction.current.releasePointerCapture(pointer);
  };
  useEffect(() => {
    cancelDrag();
  }, [inputKey, readonly, selectionLocked, active, mode]);
  useEffect(() => {
    const cancel = () => cancelDrag();
    window.addEventListener("blur", cancel);
    window.addEventListener(symbolDragEnded, cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener(symbolDragEnded, cancel);
    };
  }, []);
  useEffect(() => {
    if (selectedId !== undefined) setSelected(selectedId);
  }, [selectedId]);
  const nodesById = useMemo(
    () => new Map(diagram.nodes.map((node) => [node.id, node])),
    [diagram.nodes],
  );
  const node = nodesById.get(selected),
    layout = diagram.layout;
  const hint = layout.hints.find((h) => h.nodeId === selected) ?? {
    nodeId: selected,
    folded: false,
    hqStaff:
      !!node?.symbol &&
      node.symbol.code.dialect === "NUMERIC" &&
      node.symbol.code.sidc.slice(4, 6) === "10" &&
      node.symbol.code.sidc.slice(16, 18) === "98",
    offset: null,
  };
  useEffect(() => {
    setParent(node?.parentId ?? "");
  }, [selected, node?.parentId]);
  const select = (id: string) => {
    if (selectionLocked) return;
    const n = nodesById.get(id);
    if (!n) return;
    setSelected(id);
    setParent(n.parentId ?? "");
    onSelect?.(id);
  };
  const update = (patch: Partial<typeof hint>) => {
    if (!node) return;
    onLayout({
      ...layout,
      hints: [
        ...layout.hints.filter((h) => h.nodeId !== selected),
        { ...hint, ...patch },
      ],
    });
  };
  const move = (x: number, y: number) =>
    update({
      offset: { x: (hint.offset?.x ?? 0) + x, y: (hint.offset?.y ?? 0) + y },
    });
  const validParents = useMemo(
    () =>
      mode !== "REPARENT"
        ? []
        : diagram.nodes.filter((n) => {
            if (n.id === selected) return false;
            const seen = new Set<string>();
            let p: string | null = n.parentId;
            while (p && !seen.has(p)) {
              if (p === selected) return false;
              seen.add(p);
              p = nodesById.get(p)?.parentId ?? null;
            }
            return true;
          }),
    [mode, diagram.nodes, nodesById, selected],
  );
  const ordered = useMemo(() => {
    const rank = new Map(
      diagram.nodes.map((n, i) => [n.id, layout.siblingOrder.length + i]),
    );
    layout.siblingOrder.forEach((id, i) => rank.set(id, i));
    return diagram.nodes
      .filter((n) => n.parentId === node?.parentId)
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }, [diagram.nodes, layout.siblingOrder, node?.parentId]);
  const hit = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-unit-id]");
    const id = el?.getAttribute("data-unit-id");
    if (!id || !interaction.current?.contains(el!) || !nodesById.has(id))
      return null;
    const box = el!.getBoundingClientRect(),
      ratio = (y - box.top) / box.height,
      horizontal = (x - box.left) / box.width;
    return {
      id,
      position: (ratio < 0.25
        ? "BEFORE"
        : ratio > 0.75
          ? "AFTER"
          : horizontal < 0.2
            ? "BEFORE"
            : horizontal > 0.8
              ? "AFTER"
              : "CHILD") as TreeDrop,
    };
  };
  const preview = useMemo(
    () => (
      <GraphicPreview
        compactControls={compactControls}
        fitMaxHeight={fitMaxHeight}
        request={{ kind: "ORBAT", input: diagram }}
        active={active}
        onNodeSelect={select}
        selectedId={selected}
        placement={placement}
      />
    ),
    [
      compactControls,
      diagram,
      active,
      selected,
      onSelect,
      selectionLocked,
      fitMaxHeight,
      placement,
    ],
  );
  const inspector = node && (
    <div className="orbat-node-inspector">
      <h4>{node.name || "Boundary"}</h4>
      <details>
        <summary>Unit details</summary>
        <small>Unit identity {node.id}</small>
      </details>
      <div className="button-row">
        <button
          disabled={readonly || !node.symbol || !onSymbol}
          onClick={() =>
            node.symbol &&
            onSymbol?.(
              { definition: structuredClone(node.symbol), source: null },
              selected,
              "CHILD",
            )
          }
        >
          Copy symbol to child
        </button>
        <button
          disabled={readonly || ordered[0]?.id === selected}
          onClick={() =>
            onLayout(reorderSibling(diagram.nodes, layout, selected, -1))
          }
        >
          Move earlier
        </button>
        <button
          disabled={readonly || ordered.at(-1)?.id === selected}
          onClick={() =>
            onLayout(reorderSibling(diagram.nodes, layout, selected, 1))
          }
        >
          Move later
        </button>
      </div>
      {mode === "REPARENT" && (
        <div className="button-row">
          <label className="field">
            <span>New parent</span>
            <select
              aria-label="New ORBAT parent"
              value={parent}
              disabled={readonly || selected === rootId}
              onChange={(e) => setParent(e.target.value)}
            >
              {!rootId && <option value="">Top level</option>}
              {validParents.map((n) => (
                <option value={n.id} key={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={
              readonly ||
              selected === rootId ||
              parent === (node.parentId ?? "")
            }
            onClick={() => onReparent(selected, parent || null)}
          >
            Apply parent relationship
          </button>
        </div>
      )}
      <fieldset disabled={readonly}>
        <div className="check-row">
          <label>
            <input
              type="checkbox"
              checked={hint.folded}
              onChange={(e) => update({ folded: e.target.checked })}
            />
            Fold descendants
          </label>
          <label>
            <input
              type="checkbox"
              checked={hint.hqStaff}
              onChange={(e) => update({ hqStaff: e.target.checked })}
            />
            HQ staff placement
          </label>
        </div>
        <details>
          <summary>Fine position</summary>
          <div className="field-grid">
            <Field
              label="Position offset X"
              type="number"
              value={String(hint.offset?.x ?? 0)}
              onChange={(v) =>
                update({ offset: { x: Number(v), y: hint.offset?.y ?? 0 } })
              }
            />
            <Field
              label="Position offset Y"
              type="number"
              value={String(hint.offset?.y ?? 0)}
              onChange={(v) =>
                update({ offset: { x: hint.offset?.x ?? 0, y: Number(v) } })
              }
            />
          </div>
          <button
            disabled={!hint.offset}
            onClick={() => update({ offset: null })}
          >
            Reset unit position
          </button>
        </details>
      </fieldset>
    </div>
  );
  return (
    <section className="orbat-canvas-workspace">
      <div className="button-row orbat-controls-toolbar">
        <label className="field">
          <span>Layout</span>
          <select
            aria-label="ORBAT layout mode"
            disabled={readonly}
            value={layout.mode}
            onChange={(e) =>
              onLayout({
                ...layout,
                mode: e.target.value as "SMART" | "SIMPLE",
              })
            }
          >
            <option value="SMART">Smart</option>
            <option value="SIMPLE">Simple</option>
          </select>
        </label>
        <label className="field">
          <span>Command levels</span>
          <input
            aria-label="ORBAT command levels"
            type="number"
            min="1"
            max="64"
            disabled={readonly}
            value={layout.commandLevels}
            onChange={(e) =>
              onLayout({ ...layout, commandLevels: Number(e.target.value) })
            }
          />
        </label>
        <div
          className="orbat-edit-modes"
          role="group"
          aria-label="Unit editing mode"
        >
          {(["SELECT", "MOVE", "REPARENT"] as const).map((m) => (
            <button
              className={mode === m ? "active" : ""}
              aria-pressed={mode === m}
              disabled={readonly && m !== "SELECT"}
              key={m}
              onClick={() => {
                setMode(m);
                cancelDrag();
              }}
            >
              {m === "SELECT"
                ? "Select unit"
                : m === "MOVE"
                  ? "Move position"
                  : "Change parent"}
            </button>
          ))}
        </div>
      </div>
      <div className="orbat-drop-feedback">
        {drop && (
          <p
            className="orbat-drop-status"
            role={drop.error ? "alert" : "status"}
          >
            {drop.error ??
              `${drop.position === "CHILD" ? "Add as child of" : drop.position === "BEFORE" ? "Insert before" : "Insert after"} ${diagram.nodes.find((n) => n.id === drop.id)?.name}`}
          </p>
        )}
      </div>
      {notice && <p role="alert">{notice}</p>}
      <div
        ref={interaction}
        tabIndex={0}
        aria-label="Interactive ORBAT diagram"
        data-edit-mode={mode}
        data-dragging={drag ? true : undefined}
        data-readonly={readonly || selectionLocked || !active || undefined}
        onKeyDownCapture={(e) => {
          if (e.key === "Escape" && dragRef.current) {
            e.preventDefault();
            e.stopPropagation();
            cancelDrag();
          }
        }}
        onClickCapture={(e) => {
          if (suppressClick.current && e.detail > 0) {
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onKeyDown={(e) => {
          if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLSelectElement ||
            e.target instanceof HTMLTextAreaElement
          )
            return;
          if (e.key === "Escape") {
            if (dragRef.current) {
              e.preventDefault();
              e.stopPropagation();
            }
            cancelDrag();
            return;
          }
          if (
            mode !== "MOVE" ||
            readonly ||
            selectionLocked ||
            !active ||
            !node
          )
            return;
          const step = e.shiftKey ? 1 : 10,
            delta = (
              {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              } as Record<string, number[]>
            )[e.key];
          if (delta) {
            e.preventDefault();
            move(delta[0], delta[1]);
          }
        }}
        onPointerDown={(e) => {
          suppressClick.current = false;
          if (
            dragRef.current ||
            mode === "SELECT" ||
            (mode !== "MOVE" && !onMove) ||
            !active ||
            readonly ||
            selectionLocked ||
            e.button !== 0
          )
            return;
          const element = (e.target as Element).closest("[data-unit-id]"),
            id = element?.getAttribute("data-unit-id"),
            svg = element?.closest("svg");
          if (!id || !diagram.nodes.some((n) => n.id === id) || !svg) return;
          if (
            (e.target as Element).closest('.graphic-canvas[aria-busy="true"]')
          )
            return;
          e.preventDefault();
          if (element?.closest('[role="dialog"]'))
            (element as SVGElement).focus({ preventScroll: true });
          else e.currentTarget.focus({ preventScroll: true });
          select(id);
          setNotice("");
          let outerSvg = svg;
          while (outerSvg.ownerSVGElement) outerSvg = outerSvg.ownerSVGElement;
          const matrix = outerSvg.getScreenCTM();
          if (!matrix) return;
          suppressClick.current = false;
          moved.current = false;
          const start = {
            id,
            x: e.clientX,
            y: e.clientY,
            pointerId: e.pointerId,
            svg: outerSvg,
            origin: new DOMPoint(e.clientX, e.clientY).matrixTransform(
              matrix.inverse(),
            ),
          };
          dragRef.current = start;
          setDrag(start);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          if (
            !moved.current &&
            Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5
          )
            return;
          moved.current = true;
          suppressClick.current = true;
          const beneath = document.elementFromPoint(e.clientX, e.clientY);
          const inside = beneath?.closest(".graphic-canvas");
          if (!inside || !interaction.current?.contains(inside)) {
            setPlacement(undefined);
            setDrop(null);
            return;
          }
          if (mode === "MOVE") {
            setPlacement({
              nodeId: drag.id,
              offset: movement(drag, e.clientX, e.clientY),
            });
            return;
          }
          const target = hit(e.clientX, e.clientY);
          if (!target) {
            setDrop(null);
            setPlacement(undefined);
            return;
          }
          if (drop?.id === target.id && drop.position === target.position)
            return;
          try {
            const planned = planTreeDrop(
              diagram.nodes,
              layout,
              drag.id,
              target.id,
              target.position,
              rootId,
            );
            setDrop(target);
            setPlacement({
              nodeId: drag.id,
              diagram: previewMove?.(drag.id, target.id, target.position) ?? {
                ...diagram,
                nodes: diagram.nodes.map((n) =>
                  n.id === drag.id ? { ...n, parentId: planned.parentId } : n,
                ),
                layout: planned.layout,
              },
            });
          } catch (error) {
            setDrop({ ...target, error: (error as Error).message });
            setPlacement(undefined);
          }
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== e.pointerId) return;
          const didMove = moved.current;
          cancelDrag();
          if (
            !didMove ||
            mode === "SELECT" ||
            !active ||
            readonly ||
            selectionLocked
          )
            return;
          const inside = document
            .elementFromPoint(e.clientX, e.clientY)
            ?.closest(".graphic-canvas");
          if (!inside || !interaction.current?.contains(inside)) return;
          // Validate the release location itself; a previous hover may be stale.
          try {
            if (mode !== "MOVE") {
              const target = hit(e.clientX, e.clientY);
              if (!target) return;
              planTreeDrop(
                diagram.nodes,
                layout,
                drag.id,
                target.id,
                target.position,
                rootId,
              );
              onMove?.(drag.id, target.id, target.position);
            } else if (drag.id === selected) {
              const delta = movement(drag, e.clientX, e.clientY);
              move(delta.x, delta.y);
            }
          } catch (error) {
            setNotice((error as Error).message);
          }
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onDragOver={(e) => {
          if (
            readonly ||
            selectionLocked ||
            !active ||
            !onSymbol ||
            !e.dataTransfer.types.includes(symbolTransferType)
          )
            return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          const target = hit(e.clientX, e.clientY);
          const invalid =
            target && target.id === rootId && target.position !== "CHILD";
          setDrop(
            target
              ? {
                  ...target,
                  ...(target.id === rootId && target.position !== "CHILD"
                    ? {
                        error:
                          "Insert a child under the root; a Saved ORBAT has one root",
                      }
                    : {}),
                }
              : null,
          );
          if (!target || invalid || !previewSymbol) {
            symbolHover.current = null;
            setPlacement(undefined);
            return;
          }
          const transfer = symbolDragPreview(e.dataTransfer, desktop);
          if (!transfer) return;
          const key = `${transfer.nodeId}:${target.id}:${target.position}`;
          if (symbolHover.current === key) return;
          setDrop(target);
          symbolHover.current = key;
          setPlacement(undefined);
          const generation = transferGeneration.current;
          void transfer.snapshot
            .then((snapshot) => {
              if (
                symbolHover.current !== key ||
                generation !== transferGeneration.current
              )
                return;
              setPlacement({
                nodeId: transfer.nodeId,
                diagram: previewSymbol(
                  snapshot,
                  target.id,
                  target.position,
                  transfer.nodeId,
                ),
              });
            })
            .catch((error) => {
              if (
                symbolHover.current === key &&
                generation === transferGeneration.current
              ) {
                setDrop({ ...target, error: String(error) });
                setPlacement(undefined);
              }
            });
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDrop(null);
            setPlacement(undefined);
            symbolHover.current = null;
          }
        }}
        onDrop={(e) => {
          if (
            readonly ||
            selectionLocked ||
            !active ||
            !onSymbol ||
            !e.dataTransfer.types.includes(symbolTransferType)
          )
            return;
          e.preventDefault();
          const target = hit(e.clientX, e.clientY);
          const nodeId = symbolDragNodeId();
          cancelDrag();
          if (!target) return;
          const generation = transferGeneration.current;
          void readSymbolTransfer(
            e.dataTransfer.getData(symbolTransferType),
            desktop,
          )
            .then((s) => {
              if (generation !== transferGeneration.current) return;
              onSymbol(s, target.id, target.position, nodeId);
            })
            .catch((error) => setNotice(String(error)));
        }}
      >
        {preview}
      </div>
      {inspectorHost ? createPortal(inspector, inspectorHost) : inspector}
    </section>
  );
}
