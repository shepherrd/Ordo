import { editorError } from "./editor-error";
import { WorkbenchIcon } from "./WorkbenchIcon";
import { ModalBackdrop } from "./ModalBackdrop";
import { useWorkspaceApi } from "./WorkspaceContext";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useOrbatPlacementPreview,
  type OrbatPlacement,
} from "./orbat-placement-preview";
import type {
  GraphicRenderRequest,
  GraphicRenderResult,
} from "../../application/render-contracts";
export function GraphicPreview({
  request,
  active = true,
  onResult,
  onNodeSelect,
  selectedId,
  fitToWidth = false,
  fitToViewport = false,
  fitMaxHeight,
  placement,
  compactControls = false,
  automaticFit = false,
}: {
  request: GraphicRenderRequest;
  active?: boolean;
  onResult?: (r: GraphicRenderResult | null) => void;
  onNodeSelect?: (id: string) => void;
  selectedId?: string;
  fitToWidth?: boolean;
  /** For a fixed-size preview: contain and center the complete graphic. */
  fitToViewport?: boolean;
  fitMaxHeight?: number;
  placement?: OrbatPlacement;
  compactControls?: boolean;
  /** A contained preview with no manual zoom controls. */
  automaticFit?: boolean;
}) {
  const desktop = useWorkspaceApi();
  const [result, setResult] = useState<GraphicRenderResult | null>(null),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [zoom, setZoom] = useState(1),
    [fit, setFit] = useState(fitToWidth || request.kind === "ORBAT"),
    [panMode, setPanMode] = useState(false),
    [expanded, setExpanded] = useState(false),
    [viewport, setViewport] = useState({ width: 0, height: 0 }),
    [size, setSize] = useState({ width: 0, height: 0 });
  const canvas = useRef<HTMLDivElement>(null),
    inlineHeight = useRef(0),
    expandButton = useRef<HTMLButtonElement>(null),
    wasExpanded = useRef(false),
    graphic = useRef<HTMLDivElement>(null),
    pan = useRef<{ x: number; y: number; left: number; top: number } | null>(
      null,
    );
  useOrbatPlacementPreview(graphic, result, placement, active, expanded);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const width = Math.max(
        1,
        el.clientWidth -
          (fitToViewport
            ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
            : 48),
      );
      const height = Math.max(
        1,
        el.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      );
      setViewport((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, fitToViewport]);
  useEffect(() => {
    if (!expanded && wasExpanded.current)
      expandButton.current?.focus({ preventScroll: true });
    wasExpanded.current = expanded;
  }, [expanded]);
  useLayoutEffect(() => {
    const svg = graphic.current?.querySelector("svg");
    if (svg)
      setSize({
        width: svg.width.baseVal.value || svg.viewBox.baseVal.width,
        height: svg.height.baseVal.value || svg.viewBox.baseVal.height,
      });
  }, [result, expanded]);
  const scale =
    (automaticFit || fit) && size.width && viewport.width
      ? fitToViewport
        ? Math.min(
            1,
            viewport.width / size.width,
            viewport.height / size.height,
          )
        : Math.min(
            fitToWidth ? 1 : 4,
            Math.max(
              0.05,
              Math.min(
                viewport.width / size.width,
                fitMaxHeight && size.height
                  ? fitMaxHeight / size.height
                  : Infinity,
              ),
            ),
          )
      : zoom;
  const adjustZoom = (delta: number) => {
    setFit(false);
    setZoom(Math.max(0.05, Math.min(4, scale + delta)));
  };
  const interactive = request.kind === "ORBAT" && !!onNodeSelect;
  const diagramNodes = request.kind === "ORBAT" ? request.input.nodes : null;
  const unitElements = useRef(new Map<string, SVGElement>());
  const keyboardUnit = useRef<SVGElement | undefined>(undefined);
  // Set up each rendered SVG once. Selection only touches its old/new units.
  useEffect(() => {
    unitElements.current = new Map();
    keyboardUnit.current = undefined;
    if (!interactive || !diagramNodes) return;
    const names = new Map(diagramNodes.map((node) => [node.id, node.name]));
    const nodes =
      graphic.current?.querySelectorAll<SVGElement>("[data-unit-id]") ?? [];
    for (const [index, element] of [...nodes].entries()) {
      const id = element.dataset.unitId;
      if (id) unitElements.current.set(id, element);
      // Include the whitespace between a symbol and its labels in its hit area.
      // This is editor-only DOM, separate from the retained SVG render product.
      if (
        !element.querySelector("[data-unit-hit-area]") &&
        element instanceof SVGGraphicsElement
      ) {
        const box = element.getBBox();
        const hit = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "rect",
        );
        for (const [key, value] of Object.entries({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }))
          hit.setAttribute(key, String(value));
        hit.setAttribute("fill", "transparent");
        hit.setAttribute("pointer-events", "all");
        hit.setAttribute("data-unit-hit-area", "true");
        element.prepend(hit);
      }
      element.setAttribute("role", "button");
      element.setAttribute("aria-label", (id && names.get(id)) || "Unit");
      element.setAttribute("aria-pressed", "false");
      element.tabIndex = index === 0 ? 0 : -1;
      if (index === 0) keyboardUnit.current = element;
    }
  }, [result, interactive, diagramNodes, expanded]);
  useEffect(() => {
    const previous = keyboardUnit.current;
    const next = selectedId
      ? unitElements.current.get(selectedId)
      : unitElements.current.values().next().value;
    if (previous && previous !== next) {
      previous.setAttribute("aria-pressed", "false");
      previous.tabIndex = -1;
    }
    if (next) {
      next.setAttribute("aria-pressed", String(!!selectedId));
      next.tabIndex = 0;
    }
    keyboardUnit.current = next;
  }, [result, interactive, diagramNodes, expanded, selectedId]);
  const latest = useRef(""),
    callback = useRef(onResult);
  callback.current = onResult;
  const key = useMemo(
    () => JSON.stringify(request),
    [request.kind, request.input],
  );
  useEffect(() => {
    if (!active) return;
    const id = crypto.randomUUID();
    latest.current = id;
    let sent = false;
    setWorking(true);
    setError("");
    callback.current?.(null);
    const timer = setTimeout(() => {
      sent = true;
      void desktop
        .renderGraphic(id, JSON.parse(key))
        .then((r) => {
          if (latest.current !== id) return;
          setResult(r);
          callback.current?.(r);
        })
        .catch((e) => {
          if (latest.current === id) {
            setResult(null);
            setError(editorError(e));
          }
        })
        .finally(() => {
          if (latest.current === id) setWorking(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      if (latest.current === id) latest.current = "";
      if (sent) void desktop.cancelGraphic(id).catch(() => {});
    };
  }, [key, active]);
  const content = (
    <section
      className={`graphic-preview ${expanded ? "graphic-preview-expanded" : ""} ${compactControls ? "graphic-preview-compact" : ""}`}
      role={expanded ? "dialog" : undefined}
      aria-label="Graphic preview"
    >
      {selectedId && (
        <style>{`.graphic-canvas[data-selected-unit="${CSS.escape(selectedId)}"] [data-unit-id="${CSS.escape(selectedId)}"] { outline: 2px solid var(--diagram-accent); outline-offset: 5px; filter: drop-shadow(0 0 3px var(--diagram-accent)); }`}</style>
      )}
      {!automaticFit && (
        <div className="button-row">
          <strong role="status">
            {working ? "Updating preview…" : "Live preview"}
          </strong>
          <button
            title="Zoom out"
            disabled={scale <= 0.05}
            onClick={() => adjustZoom(-0.25)}
            aria-label="Zoom out"
          >
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            disabled={scale >= 4}
            title="Zoom in"
            onClick={() => adjustZoom(0.25)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            className={compactControls ? "workbench-icon-button" : undefined}
            aria-label="Reset zoom"
            title="Reset zoom"
            onClick={() => {
              setFit(false);
              setZoom(1);
              canvas.current?.scrollTo({ left: 0, top: 0 });
            }}
          >
            {compactControls ? <WorkbenchIcon name="reset" /> : "Reset zoom"}
          </button>
          {request.kind === "ORBAT" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={fit}
                  onChange={(e) => {
                    setFit(e.target.checked);
                    if (e.target.checked)
                      canvas.current?.scrollTo({ left: 0, top: 0 });
                  }}
                />{" "}
                {fitMaxHeight || fitToViewport
                  ? "Fit diagram"
                  : "Fit horizontally"}
              </label>
              <button
                className={
                  compactControls ? "workbench-icon-button" : undefined
                }
                aria-label="Pan canvas"
                title="Pan canvas"
                aria-pressed={panMode}
                onClick={() => setPanMode((p) => !p)}
              >
                {compactControls ? <WorkbenchIcon name="pan" /> : "Pan canvas"}
              </button>
              <button
                className={
                  compactControls ? "workbench-icon-button" : undefined
                }
                aria-label={expanded ? "Compact diagram" : "Expand diagram"}
                title={expanded ? "Compact diagram" : "Expand diagram"}
                ref={expandButton}
                data-dialog-cancel={expanded || undefined}
                aria-expanded={expanded}
                onClick={(e) => {
                  if (!expanded)
                    inlineHeight.current =
                      e.currentTarget
                        .closest(".graphic-preview")
                        ?.getBoundingClientRect().height ?? 0;
                  setExpanded((v) => !v);
                }}
              >
                {compactControls ? (
                  <WorkbenchIcon name={expanded ? "collapse" : "expand"} />
                ) : expanded ? (
                  "Compact diagram"
                ) : (
                  "Expand diagram"
                )}
              </button>
              {onNodeSelect && (
                <button
                  className={
                    compactControls ? "workbench-icon-button" : undefined
                  }
                  aria-label="Show selected unit"
                  title="Show selected unit"
                  disabled={!selectedId || working}
                  onClick={() => {
                    const target = [
                      ...(graphic.current?.querySelectorAll<SVGElement>(
                        "[data-unit-id]",
                      ) ?? []),
                    ].find((n) => n.dataset.unitId === selectedId);
                    const view = canvas.current;
                    if (!target || !view) return;
                    const nodeRect = target.getBoundingClientRect(),
                      viewRect = view.getBoundingClientRect();
                    view.scrollBy({
                      left:
                        nodeRect.left -
                        viewRect.left +
                        nodeRect.width / 2 -
                        view.clientWidth / 2,
                      top:
                        nodeRect.top -
                        viewRect.top +
                        nodeRect.height / 2 -
                        view.clientHeight / 2,
                    });
                    target.focus({ preventScroll: true });
                  }}
                >
                  {compactControls ? (
                    <WorkbenchIcon name="locate" />
                  ) : (
                    "Show selected unit"
                  )}
                </button>
              )}
            </>
          )}
          {fitToWidth && request.kind === "SYMBOL" && (
            <button
              aria-pressed={fit}
              onClick={() => {
                setFit(true);
                canvas.current?.scrollTo({ left: 0, top: 0 });
              }}
            >
              Fit symbol
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div
        className={`graphic-canvas${(automaticFit || fit) && fitToViewport ? " graphic-canvas-fit" : ""}`}
        ref={canvas}
        data-selected-unit={selectedId}
        data-pan={panMode || undefined}
        aria-busy={working}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            pan.current = null;
            setPanMode(false);
          }
          const target = (e.target as Element).closest<SVGElement>(
            "[data-unit-id]",
          );
          if (!target || !onNodeSelect) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onNodeSelect(target.dataset.unitId!);
          }
          if (e.currentTarget.closest('[data-edit-mode="MOVE"]')) return;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            const units = [
              ...e.currentTarget.querySelectorAll<SVGElement>("[data-unit-id]"),
            ];
            const index = units.indexOf(target),
              step = e.key === "ArrowUp" ? -1 : 1;
            const next =
              e.key === "Home"
                ? units[0]
                : e.key === "End"
                  ? units.at(-1)
                  : units[index + step];
            e.preventDefault();
            e.stopPropagation();
            if (next) {
              next.focus();
              onNodeSelect(next.dataset.unitId!);
            }
          }
        }}
        onPointerDown={(e) => {
          if (!panMode && e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          pan.current = {
            x: e.clientX,
            y: e.clientY,
            left: e.currentTarget.scrollLeft,
            top: e.currentTarget.scrollTop,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!pan.current) return;
          e.stopPropagation();
          e.currentTarget.scrollLeft =
            pan.current.left + pan.current.x - e.clientX;
          e.currentTarget.scrollTop =
            pan.current.top + pan.current.y - e.clientY;
        }}
        onPointerUp={(e) => {
          if (pan.current) {
            e.stopPropagation();
            pan.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          pan.current = null;
        }}
        onClick={(e) => {
          if (panMode) return;
          const node = (e.target as Element).closest("[data-unit-id]");
          if (node) onNodeSelect?.(node.getAttribute("data-unit-id")!);
        }}
      >
        {result && (
          <div
            ref={graphic}
            style={
              {
                width: size.width ? size.width * scale : undefined,
                height: size.height ? size.height * scale : undefined,
                "--graphic-zoom": scale,
              } as React.CSSProperties
            }
            dangerouslySetInnerHTML={{ __html: result.result.svg }}
          />
        )}
      </div>
    </section>
  );
  return expanded ? (
    <>
      <div aria-hidden="true" style={{ height: inlineHeight.current }} />
      <ModalBackdrop>{content}</ModalBackdrop>
    </>
  ) : (
    content
  );
}
