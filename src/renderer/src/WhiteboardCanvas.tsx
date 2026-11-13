import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WhiteboardItem } from "../../domain/whiteboards";
import {
  renderWhiteboard,
  type WhiteboardView,
  type WhiteboardImage,
} from "../../export/whiteboard-v1";
export type BoardTool = "select" | "pan" | "connect";
export function WhiteboardCanvas({
  view,
  images,
  selected,
  setSelected,
  tool,
  onConnect,
  onCommit,
  onRemove,
  grid,
  onGesture,
  toolbar,
  writing,
  onFinishWriting,
  onEdit,
  onText,
}: {
  view: WhiteboardView;
  images: Map<string, WhiteboardImage>;
  selected: string[];
  setSelected: (ids: string[]) => void;
  tool: BoardTool;
  onConnect: (from: string, to: string) => void;
  onCommit: (items: WhiteboardItem[]) => void;
  onRemove: () => void;
  grid: boolean;
  onGesture: (active: boolean) => void;
  toolbar: ReactNode;
  writing: string | null;
  onFinishWriting: () => void;
  onEdit: (item: WhiteboardItem) => void;
  onText: (id: string, value: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    [zoom, setZoom] = useState(1),
    [fit, setFit] = useState(true),
    [width, setWidth] = useState(800),
    [height, setHeight] = useState(600),
    [moving, setMoving] = useState<WhiteboardItem[] | null>(null),
    [connectFrom, setConnectFrom] = useState("");
  const drag = useRef<{
    kind: "move" | "resize" | "pan";
    x: number;
    y: number;
    items: WhiteboardItem[];
    left: number;
    top: number;
  } | null>(null);
  const { board } = view;
  const editor = useRef<HTMLTextAreaElement>(null);
  const entry =
    writing && selected.includes(writing)
      ? board.items.find((i) => i.id === writing)
      : null;
  useLayoutEffect(() => {
    if (!writing) return;
    // Let a closing Insert dialog restore focus before typing begins on the board.
    const frame = requestAnimationFrame(() => {
      editor.current?.focus({ preventScroll: true });
      editor.current?.select();
      editor.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [writing]);
  useEffect(() => {
    setFit(true);
    setMoving(null);
    setConnectFrom("");
    drag.current = null;
    onGesture(false);
  }, [board.id]);
  useEffect(() => {
    if (tool !== "connect") setConnectFrom("");
  }, [tool]);
  useLayoutEffect(() => {
    const e = viewport.current;
    if (!e) return;
    const resize = () => {
      setWidth(Math.max(100, e.clientWidth - 24));
      setHeight(Math.max(100, e.clientHeight - 24));
    };
    resize();
    const o = new ResizeObserver(resize);
    o.observe(e);
    return () => o.disconnect();
  }, []);
  const scale = fit
    ? Math.min(width / board.width, height / board.height, 1)
    : zoom;
  const movingMap = useMemo(
    () => new Map(moving?.map((i) => [i.id, i])),
    [moving],
  );
  const display = useMemo(
    () =>
      moving
        ? {
            board: {
              ...board,
              items: board.items.map((i) => movingMap.get(i.id) ?? i),
            },
            items: view.items.map((i) => ({
              ...i,
              item: movingMap.get(i.item.id) ?? i.item,
            })),
          }
        : view,
    [view, movingMap, moving],
  );
  const rendered = useMemo(
    () => renderWhiteboard(display, images, true),
    [display, images],
  );
  const cancel = () => {
    drag.current = null;
    setMoving(null);
    onGesture(false);
  };
  const begin = (
    event: React.PointerEvent,
    kind: "move" | "resize" | "pan",
    items: WhiteboardItem[],
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    host.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      items: structuredClone(items),
      left: viewport.current?.scrollLeft ?? 0,
      top: viewport.current?.scrollTop ?? 0,
    };
    onGesture(true);
  };
  const label = (i: WhiteboardItem) =>
    i.kind === "card"
      ? (view.items.find((v) => v.item.id === i.id)?.paragraphs[0]?.text ??
        "Planning card")
      : "text" in i
        ? i.text || i.kind
        : i.label || i.kind;
  return (
    <section className="whiteboard-canvas-panel" aria-label="Whiteboard canvas">
      <div className="whiteboard-canvas-tools">
        <div className="whiteboard-actions">{toolbar}</div>
        <div className="button-row">
          <button
            aria-label="Zoom out whiteboard"
            onClick={() => {
              setFit(false);
              setZoom(Math.max(0.1, scale - 0.1));
            }}
          >
            −
          </button>
          <button
            title="Reset zoom to 100%"
            aria-label="Reset whiteboard zoom to 100%"
            onClick={() => {
              setFit(false);
              setZoom(1);
            }}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            aria-label="Zoom in whiteboard"
            onClick={() => {
              setFit(false);
              setZoom(Math.min(3, scale + 0.1));
            }}
          >
            +
          </button>
          <button aria-pressed={fit} onClick={() => setFit(true)}>
            Fit board
          </button>
        </div>
      </div>
      {tool === "connect" && (
        <p className="whiteboard-tool-status" role="status">
          {connectFrom
            ? "Select the destination item. Escape cancels."
            : "Select the first item, then the destination. Connectors are visual only."}
        </p>
      )}
      <div
        className={`whiteboard-viewport ${fit ? "fit-mode" : ""} ${tool === "pan" ? "pan-mode" : ""}`}
        ref={viewport}
      >
        <div
          ref={host}
          className="whiteboard-canvas"
          role="group"
          aria-label={board.name}
          tabIndex={0}
          style={{ width: board.width * scale, height: board.height * scale }}
          onPointerDown={(e) => {
            if (tool === "pan") begin(e, "pan", []);
            else {
              setSelected([]);
              setConnectFrom("");
            }
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (d.kind === "pan") {
              if (viewport.current) {
                viewport.current.scrollLeft = d.left - (e.clientX - d.x);
                viewport.current.scrollTop = d.top - (e.clientY - d.y);
              }
              return;
            }
            let dx = (e.clientX - d.x) / scale,
              dy = (e.clientY - d.y) / scale;
            if (grid) {
              dx = Math.round(dx / 20) * 20;
              dy = Math.round(dy / 20) * 20;
            }
            if (d.kind === "move") {
              dx = Math.max(
                -Math.min(...d.items.map((i) => i.x)),
                Math.min(
                  dx,
                  board.width - Math.max(...d.items.map((i) => i.x + i.width)),
                ),
              );
              dy = Math.max(
                -Math.min(...d.items.map((i) => i.y)),
                Math.min(
                  dy,
                  board.height -
                    Math.max(...d.items.map((i) => i.y + i.height)),
                ),
              );
            }
            setMoving(
              d.items.map((i) =>
                d.kind === "move"
                  ? { ...i, x: Math.round(i.x + dx), y: Math.round(i.y + dy) }
                  : {
                      ...i,
                      width: Math.round(
                        Math.max(60, Math.min(board.width - i.x, i.width + dx)),
                      ),
                      height: Math.round(
                        Math.max(
                          40,
                          Math.min(board.height - i.y, i.height + dy),
                        ),
                      ),
                    },
              ),
            );
          }}
          onPointerUp={(e) => {
            if (!drag.current) return;
            if (
              moving &&
              drag.current.items.some((i, index) => {
                const next = moving[index];
                return (
                  next &&
                  (next.x !== i.x ||
                    next.y !== i.y ||
                    next.width !== i.width ||
                    next.height !== i.height)
                );
              })
            )
              onCommit(moving);
            cancel();
            if (host.current?.hasPointerCapture(e.pointerId))
              host.current.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={cancel}
          onKeyDown={(e) => {
            if (e.target instanceof HTMLTextAreaElement) return;
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
              setConnectFrom("");
              return;
            }
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              onRemove();
              return;
            }
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              const amount = e.shiftKey ? 20 : 1,
                dx =
                  e.key === "ArrowLeft"
                    ? -amount
                    : e.key === "ArrowRight"
                      ? amount
                      : 0,
                dy =
                  e.key === "ArrowUp"
                    ? -amount
                    : e.key === "ArrowDown"
                      ? amount
                      : 0;
              const items = board.items.filter(
                (i) => selected.includes(i.id) && !i.locked,
              );
              if (items.length)
                onCommit(
                  items.map((i) => ({
                    ...i,
                    x: Math.max(0, Math.min(board.width - i.width, i.x + dx)),
                    y: Math.max(0, Math.min(board.height - i.height, i.y + dy)),
                  })),
                );
            }
          }}
        >
          <div
            className="whiteboard-drawing"
            style={{
              width: board.width,
              height: board.height,
              transform: `scale(${scale})`,
            }}
            dangerouslySetInnerHTML={{ __html: rendered.svg }}
          />
          {grid && (
            <div
              className="whiteboard-grid"
              style={{ backgroundSize: `${20 * scale}px ${20 * scale}px` }}
            />
          )}
          {display.board.items.map((i) => (
            <button
              key={i.id}
              className={`whiteboard-hit ${selected.includes(i.id) ? "selected" : ""} ${connectFrom === i.id ? "connector-start" : ""}`}
              aria-label={`Select ${label(i).slice(0, 180)}`}
              aria-pressed={selected.includes(i.id)}
              data-whiteboard-item={i.id}
              data-card-id={i.kind === "card" ? i.cardId : undefined}
              style={{
                left: i.x * scale,
                top: i.y * scale,
                width: i.width * scale,
                height: i.height * scale,
              }}
              onDoubleClick={() => {
                if (tool === "select") onEdit(i);
              }}
              onClick={(e) => {
                if (e.detail === 0) {
                  setSelected([i.id]);
                  if (tool === "select") onEdit(i);
                  if (tool === "connect") {
                    if (connectFrom && connectFrom !== i.id) {
                      onConnect(connectFrom, i.id);
                      setConnectFrom("");
                    } else setConnectFrom(i.id);
                  }
                }
              }}
              onPointerDown={(e) => {
                if (tool === "pan") {
                  begin(e, "pan", []);
                  return;
                }
                e.stopPropagation();
                if (tool === "connect") {
                  if (connectFrom && connectFrom !== i.id) {
                    onConnect(connectFrom, i.id);
                    setConnectFrom("");
                  } else setConnectFrom(i.id);
                  setSelected([i.id]);
                  return;
                }
                const selection = e.shiftKey
                  ? selected.includes(i.id)
                    ? selected.filter((id) => id !== i.id)
                    : [...selected, i.id]
                  : selected.includes(i.id)
                    ? selected
                    : [i.id];
                setSelected(selection);
                const items = board.items.filter(
                  (v) => selection.includes(v.id) && !v.locked,
                );
                if (!e.shiftKey && !i.locked && items.length)
                  begin(e, "move", items);
              }}
            />
          ))}
          {selected.length === 1 &&
            (() => {
              const i = display.board.items.find((i) => i.id === selected[0]);
              return i && !i.locked && tool === "select" ? (
                <button
                  className="whiteboard-resize"
                  aria-label="Resize selected item"
                  style={{
                    left: (i.x + i.width) * scale - 7,
                    top: (i.y + i.height) * scale - 7,
                  }}
                  onPointerDown={(e) => begin(e, "resize", [i])}
                />
              ) : null;
            })()}
          {entry && "text" in entry && (
            <textarea
              key={entry.id}
              ref={editor}
              aria-label="Write on board"
              className="whiteboard-inline-text"
              value={entry.text}
              maxLength={6000}
              onChange={(e) => onText(entry.id, e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={onFinishWriting}
              onKeyDown={(e) => {
                if (
                  e.key === "Escape" ||
                  (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  onFinishWriting();
                  host.current?.focus({ preventScroll: true });
                }
              }}
              style={{
                left: entry.x * scale,
                top: entry.y * scale,
                width: entry.width * scale,
                height: entry.height * scale,
                color: entry.ink,
                backgroundColor:
                  entry.kind === "text" ? board.background : entry.fill,
                fontSize: Math.max(14, entry.fontSize * scale),
              }}
            />
          )}
          {!board.items.length && (
            <p className="whiteboard-empty">Add a note to start writing.</p>
          )}
        </div>
      </div>
      {!!rendered.issues.length && (
        <div className="whiteboard-issues" role="status">
          {rendered.issues.slice(0, 8).map((v, i) => (
            <p key={i}>{v}</p>
          ))}
          {rendered.issues.length > 8 && (
            <p>{rendered.issues.length - 8} more items need attention.</p>
          )}
        </div>
      )}
    </section>
  );
}
