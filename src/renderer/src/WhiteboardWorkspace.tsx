import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Operation,
  Publication,
  ResolvedConfig,
} from "../../domain/model";
import {
  newWhiteboard,
  duplicateWhiteboard,
  fitBoardItem,
  removeBoardItems,
  type Whiteboard,
  type WhiteboardItem,
} from "../../domain/whiteboards";
import {
  projectWhiteboard,
  type WhiteboardImage,
} from "../../export/whiteboard-v1";
import {
  boardSymbolInput,
  binaryData,
} from "../../application/whiteboard-service";
import type { GraphicExportSummary } from "../../application/symbology-ports";
import {
  independentCard,
  resolvePlanningCard,
} from "../../domain/planning-card-resolution";
import { canonical } from "../../export/projection";
import {
  useEditorProtection,
  useWorkspaceApi,
  useWorkspaceSession,
} from "./WorkspaceContext";
import { useSearchOpen } from "./SearchProvider";
import { WhiteboardCanvas, type BoardTool } from "./WhiteboardCanvas";
import { WhiteboardSnapshots } from "./WhiteboardSnapshots";
import { PlanningCardPicker } from "./PlanningCardPicker";
import { SavedSymbolPicker } from "./SavedSymbolPicker";
import { Field } from "./Fields";
import { cardHash } from "./PlanningCards";
import { editorError } from "./editor-error";
import { ModalBackdrop } from "./ModalBackdrop";
import { WorkbenchIcon } from "./WorkbenchIcon";
import "./whiteboard.css";
const uid = () => crypto.randomUUID();
type BoardPanel = "boards" | "insert" | "edit" | "find" | "snapshots";
function BoardDialog({
  title,
  onClose,
  busy,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <ModalBackdrop>
      <section className="modal whiteboard-dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button data-dialog-cancel disabled={busy} onClick={onClose}>
            Done
          </button>
        </header>
        {children}
      </section>
    </ModalBackdrop>
  );
}
export function WhiteboardWorkspace({
  op,
  config,
  publications,
  dirty,
  change,
}: {
  op: Operation;
  config: ResolvedConfig;
  publications: Publication[];
  dirty: boolean;
  change: (fn: (o: Operation) => void) => void;
}) {
  const api = useWorkspaceApi(),
    session = useWorkspaceSession(),
    [boardId, setBoardId] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [tool, setTool] = useState<BoardTool>("select"),
    [grid, setGrid] = useState(false),
    [picker, setPicker] = useState<"card" | "symbol" | null>(null),
    [busy, setBusy] = useState(false),
    [gesture, setGesture] = useState(false),
    [error, setError] = useState(""),
    [images, setImages] = useState(new Map<string, WhiteboardImage>()),
    [graphics, setGraphics] = useState<GraphicExportSummary[]>([]),
    [graphicId, setGraphicId] = useState(""),
    [query, setQuery] = useState(""),
    [panel, setPanel] = useState<BoardPanel | null>(null),
    [writing, setWriting] = useState<string | null>(null),
    [expanded, setExpanded] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const boards = op.whiteboards?.boards ?? [],
    board = boards.find((b) => b.id === boardId) ?? boards[0],
    item =
      selected.length === 1
        ? board?.items.find((i) => i.id === selected[0])
        : undefined;
  useEditorProtection({
    name: "Planning whiteboard",
    dirty: false,
    busy: busy || gesture || !!picker,
  });
  const view = useMemo(
    () => (board ? projectWhiteboard(op, config, board) : null),
    [op, config, board],
  );
  useEffect(() => () => setGesture(false), []);
  useEffect(() => {
    let live = true;
    void api
      .graphicExports()
      .then((g) => {
        if (live)
          setGraphics(g.filter((x) => ["SVG", "PNG"].includes(x.format)));
      })
      .catch((e) => {
        if (live) setError(editorError(e));
      });
    return () => {
      live = false;
    };
  }, [api]);
  const imageKey = JSON.stringify(
    board?.items
      .filter((i) => i.kind === "symbol" || i.kind === "graphic")
      .map((i) =>
        i.kind === "symbol"
          ? [i.id, i.pin, i.label]
          : i.kind === "graphic"
            ? [i.id, i.exportId, i.label]
            : [],
      ),
  );
  useEffect(() => {
    let live = true;
    const requests = new Set<string>();
    const items = (board?.items ?? []).filter(
        (i) => i.kind === "symbol" || i.kind === "graphic",
      ),
      results = new Map<string, WhiteboardImage>(),
      cache = new Map<string, Promise<WhiteboardImage>>();
    let index = 0;
    const load = async (i: (typeof items)[number]) => {
      const key =
        i.kind === "symbol" ? JSON.stringify(i.pin.definition) : i.exportId;
      if (!cache.has(key))
        cache.set(
          key,
          (async () => {
            if (i.kind === "symbol") {
              const requestId = uid();
              requests.add(requestId);
              const r = await api
                .renderGraphic(requestId, {
                  kind: "SYMBOL",
                  input: boardSymbolInput(i),
                })
                .finally(() => requests.delete(requestId));
              if (r.kind !== "SYMBOL")
                throw Error("Expected a military symbol");
              return {
                data: binaryData(
                  new TextEncoder().encode(r.result.svg),
                  "image/svg+xml",
                ),
                hash: r.result.svgHash,
                label: i.label,
              };
            }
            return api.graphicImage(i.exportId);
          })(),
        );
      return { ...(await cache.get(key)!), label: i.label };
    };
    setImages(new Map());
    void Promise.all(
      Array.from({ length: Math.min(4, items.length) }, async () => {
        while (live && index < items.length) {
          const i = items[index++];
          try {
            results.set(i.id, await load(i));
          } catch (e) {
            if (live) setError(editorError(e));
          }
        }
      }),
    ).then(() => {
      if (live) setImages(results);
    });
    return () => {
      live = false;
      for (const requestId of requests)
        void api.cancelGraphic(requestId).catch(() => {});
    };
  }, [api, imageKey]);
  useSearchOpen("operation", (t) => {
    if (t.area !== "operation" || t.operationId !== op.id) return;
    const v = t.target;
    setWriting(null);
    setPanel(null);
    if (v.kind === "whiteboard") {
      setBoardId(v.boardId);
      setSelected(v.itemId ? [v.itemId] : []);
    } else if (v.kind === "card") {
      const b = boards.find((b) =>
        b.items.some((i) => i.kind === "card" && i.cardId === v.cardId),
      );
      if (b) {
        setBoardId(b.id);
        setSelected(
          b.items
            .filter((i) => i.kind === "card" && i.cardId === v.cardId)
            .map((i) => i.id),
        );
      }
    }
  });
  const edit = (fn: (b: Whiteboard) => void) => {
    if (board) {
      setError("");
      change((o) => {
        const b = o.whiteboards!.boards.find((b) => b.id === board.id)!;
        fn(b);
      });
    }
  };
  const editItem = (fn: (i: WhiteboardItem) => void) => {
    if (item)
      edit((b) => {
        const i = b.items.find((i) => i.id === item.id)!;
        fn(i);
        fitBoardItem(b, i);
      });
  };
  const add = (value: WhiteboardItem) => {
    if (!board || board.items.length >= 300) return;
    edit((b) => {
      fitBoardItem(b, value);
      b.items.push(value);
    });
    setPanel(null);
    setSelected([value.id]);
    setWriting("text" in value ? value.id : null);
    setTool("select");
  };
  const frame = () => ({
    id: uid(),
    x: 40 + ((board?.items.length ?? 0) % 8) * 24,
    y: 40 + ((board?.items.length ?? 0) % 8) * 24,
    width: 300,
    height: 220,
    locked: false,
  });
  const remove = () => {
    if (board) {
      edit((b) =>
        removeBoardItems(
          b,
          b.items
            .filter((i) => selected.includes(i.id) && !i.locked)
            .map((i) => i.id),
        ),
      );
      setSelected([]);
      setPanel(null);
      setWriting(null);
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  const card =
    item?.kind === "card"
      ? op.planningCards?.definitions.find((c) => c.id === item.cardId)
      : undefined;
  const itemLabel = (i: WhiteboardItem) =>
    "text" in i
      ? i.text || i.kind
      : "label" in i
        ? i.label
        : (op.planningCards?.definitions.find((c) => c.id === i.cardId)
            ?.title ?? "Planning card");
  const openBoard = (id: string) => {
    if (!id) setExpanded(false);
    setBoardId(id);
    setSelected([]);
    setWriting(null);
    setTool("select");
    setQuery("");
    setPanel(null);
  };
  const addBoard = (next: Whiteboard) => {
    change((o) => {
      o.whiteboards ??= { schemaVersion: 1, boards: [] };
      o.whiteboards.boards.push(next);
    });
    openBoard(next.id);
  };
  const addDrawing = (kind: "note" | "text" | "shape") =>
    add({
      ...frame(),
      kind,
      text: kind === "note" ? "New note" : kind === "text" ? "New text" : "",
      fill: kind === "note" ? "#fff1a8" : "#e7eff2",
      ink: "#172c30",
      fontSize: 18,
      ...(kind === "shape" ? { shape: "rectangle" as const } : {}),
    } as WhiteboardItem);
  const boardWorkspace = (
    <section
      ref={workspace}
      className={
        expanded
          ? "modal panel whiteboard-workspace whiteboard-expanded"
          : "panel whiteboard-workspace"
      }
      aria-label="Planning whiteboard"
      data-whiteboard-id={board?.id}
    >
      <div className="whiteboard-heading">
        {board && (
          <label className="field whiteboard-name">
            <input
              aria-label="Whiteboard name"
              title="Rename board"
              placeholder="Board name"
              maxLength={160}
              value={board.name}
              onChange={(e) =>
                edit((b) => {
                  b.name = e.target.value;
                })
              }
            />
          </label>
        )}
        <div className="button-row">
          {board && (
            <>
              <button onClick={() => setPanel("boards")}>Boards</button>
              <button onClick={() => setPanel("find")}>Find item</button>
            </>
          )}
          <button onClick={() => setPanel("snapshots")}>Snapshots</button>
          {board && (
            <button
              className="wb-expand"
              data-dialog-cancel={expanded || undefined}
              aria-label={expanded ? "Exit expanded board" : "Expand board"}
              title={expanded ? "Exit expanded board" : "Expand board"}
              onClick={() => {
                setWriting(null);
                setExpanded(!expanded);
                if (expanded)
                  requestAnimationFrame(() =>
                    workspace.current
                      ?.querySelector<HTMLButtonElement>(".wb-expand")
                      ?.focus({ preventScroll: true }),
                  );
              }}
            >
              <WorkbenchIcon name={expanded ? "collapse" : "expand"} />
            </button>
          )}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {board && view ? (
        <>
          <WhiteboardCanvas
            toolbar={
              <>
                <div className="button-row wb-insert-tools">
                  <button
                    className="primary"
                    disabled={board.items.length >= 300}
                    onClick={() => addDrawing("note")}
                  >
                    Add note
                  </button>
                  <button
                    disabled={board.items.length >= 300}
                    onClick={() => setPanel("insert")}
                  >
                    Insert…
                  </button>
                </div>
                <div
                  className="button-row"
                  role="group"
                  aria-label="Whiteboard tools"
                >
                  {(["select", "pan", "connect"] as const).map((t) => (
                    <button
                      key={t}
                      aria-pressed={tool === t}
                      onClick={() => setTool(t)}
                    >
                      {t === "select"
                        ? "Select / move"
                        : t === "pan"
                          ? "Pan"
                          : "Connect"}
                    </button>
                  ))}
                </div>
                {!!selected.length && (
                  <button onClick={() => setPanel("edit")}>
                    {selected.length === 1 ? "Edit item" : "Edit selection"}
                  </button>
                )}
              </>
            }
            writing={writing}
            onFinishWriting={() => setWriting(null)}
            onEdit={(i) => {
              setSelected([i.id]);
              if ("text" in i) setWriting(i.id);
              else setPanel("edit");
            }}
            onText={(id, text) =>
              edit((b) => {
                const i = b.items.find((i) => i.id === id);
                if (i && "text" in i) i.text = text;
              })
            }
            view={view}
            images={images}
            selected={selected}
            setSelected={setSelected}
            tool={tool}
            grid={grid}
            onGesture={setGesture}
            onCommit={(items) =>
              edit((b) => {
                for (const i of items) {
                  const at = b.items.findIndex((v) => v.id === i.id);
                  if (at >= 0 && !b.items[at].locked) b.items[at] = i;
                }
              })
            }
            onRemove={remove}
            onConnect={(fromId, toId) => {
              if (board.connectors.length < 600)
                edit((b) => {
                  b.connectors.push({
                    id: uid(),
                    fromId,
                    toId,
                    label: "",
                    color: "#496773",
                    style: "solid",
                    arrow: "end",
                  });
                });
              else setError("This board has reached its 600-connector limit.");
            }}
          />
          {panel === "boards" && (
            <BoardDialog title="Boards" onClose={() => setPanel(null)}>
              <label className="field">
                Whiteboard
                <select
                  aria-label="Choose whiteboard"
                  value={board?.id ?? ""}
                  onChange={(e) => openBoard(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a whiteboard
                  </option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="button-row">
                <button
                  disabled={busy || boards.length >= 12}
                  onClick={() => addBoard(newWhiteboard(uid()))}
                >
                  New whiteboard
                </button>
                <button
                  disabled={busy || boards.length >= 12}
                  onClick={() => addBoard(duplicateWhiteboard(board, uid))}
                >
                  Duplicate board
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    change((o) => {
                      o.whiteboards!.boards = o.whiteboards!.boards.filter(
                        (b) => b.id !== board.id,
                      );
                    });
                    openBoard("");
                  }}
                >
                  Remove board
                </button>
              </div>
              <h3>Canvas settings</h3>
              <div className="whiteboard-topbar whiteboard-canvas-settings">
                <label className="field">
                  Canvas size
                  <select
                    aria-label="Canvas size"
                    value={`${board.width}x${board.height}`}
                    onChange={(e) => {
                      const [width, height] = e.target.value
                        .split("x")
                        .map(Number);
                      edit((b) => {
                        b.width = width;
                        b.height = height;
                        b.items.forEach((i) => fitBoardItem(b, i));
                      });
                    }}
                  >
                    {[
                      [1600, 900],
                      [1200, 900],
                      [2400, 1600],
                      [3200, 2400],
                      ...[...[board]]
                        .filter(
                          (b) =>
                            ![
                              [1600, 900],
                              [1200, 900],
                              [2400, 1600],
                              [3200, 2400],
                            ].some(([w, h]) => b.width === w && b.height === h),
                        )
                        .map((b) => [b.width, b.height]),
                    ].map(([w, h]) => (
                      <option key={`${w}x${h}`} value={`${w}x${h}`}>
                        {w} × {h}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Background
                  <input
                    aria-label="Board background"
                    type="color"
                    value={board.background}
                    onChange={(e) =>
                      edit((b) => {
                        b.background = e.target.value;
                      })
                    }
                  />
                </label>
                <p className="muted">
                  Shift-click to select several items. Arrow keys move the
                  selection; Shift moves by 20. Escape cancels a drag.
                </p>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={grid}
                  onChange={(e) => setGrid(e.target.checked)}
                />
                Snap to grid
              </label>
            </BoardDialog>
          )}
          {panel === "insert" && (
            <BoardDialog title="Insert an item" onClose={() => setPanel(null)}>
              <div className="wb-insert-options">
                <button onClick={() => addDrawing("text")}>Add text</button>
                <button onClick={() => addDrawing("shape")}>
                  Add shape
                </button>{" "}
                <button
                  disabled={board.items.length >= 300}
                  onClick={() => {
                    setPanel(null);
                    setPicker("symbol");
                  }}
                >
                  Add symbol
                </button>
                <button
                  disabled={
                    board.items.length >= 300 ||
                    (op.planningCards?.definitions.length ?? 0) >= 1000
                  }
                  onClick={() => {
                    setPanel(null);
                    setPicker("card");
                  }}
                >
                  Add planning card
                </button>
              </div>
              <h3>Saved graphic</h3>
              <label className="field">
                Saved graphic
                <select
                  aria-label="Saved whiteboard graphic"
                  value={graphicId}
                  onChange={(e) => setGraphicId(e.target.value)}
                >
                  <option value="">Choose an export</option>
                  {graphics.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} · {g.format}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={!graphicId || board.items.length >= 300}
                onClick={() => {
                  const g = graphics.find((g) => g.id === graphicId);
                  if (g)
                    add({
                      ...frame(),
                      kind: "graphic",
                      exportId: g.id,
                      label: g.name,
                      width: 480,
                      height: 300,
                    });
                }}
              >
                Add saved graphic
              </button>
            </BoardDialog>
          )}
          {panel === "edit" && !!selected.length && (
            <BoardDialog
              title={item ? "Edit item" : "Edit selection"}
              onClose={() => setPanel(null)}
              busy={busy}
            >
              {item ? (
                <>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={item.locked}
                      onChange={(e) =>
                        editItem((i) => {
                          i.locked = e.target.checked;
                        })
                      }
                    />
                    Lock position
                  </label>
                  {"text" in item && (
                    <>
                      <Field
                        label="Item text"
                        value={item.text}
                        area
                        plain
                        onChange={(v) =>
                          editItem((i) => {
                            if ("text" in i) i.text = v.slice(0, 6000);
                          })
                        }
                      />
                      <div className="whiteboard-properties">
                        {(["fill", "ink"] as const).map((k) => (
                          <label className="field" key={k}>
                            {k === "fill" ? "Fill" : "Text color"}
                            <input
                              aria-label={
                                k === "fill" ? "Item fill" : "Item text color"
                              }
                              type="color"
                              value={item[k]}
                              onChange={(e) =>
                                editItem((i) => {
                                  if ("text" in i) i[k] = e.target.value;
                                })
                              }
                            />
                          </label>
                        ))}
                        <label className="field">
                          Font size
                          <input
                            aria-label="Item font size"
                            type="number"
                            min={12}
                            max={48}
                            value={item.fontSize}
                            onChange={(e) =>
                              editItem((i) => {
                                if ("fontSize" in i)
                                  i.fontSize = Math.max(
                                    12,
                                    Math.min(48, Number(e.target.value)),
                                  );
                              })
                            }
                          />
                        </label>
                      </div>
                    </>
                  )}
                  {item.kind === "shape" && (
                    <label className="field">
                      Shape
                      <select
                        aria-label="Shape"
                        value={item.shape}
                        onChange={(e) =>
                          editItem((i) => {
                            if (i.kind === "shape")
                              i.shape = e.target.value as typeof i.shape;
                          })
                        }
                      >
                        {["rectangle", "ellipse", "diamond"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {"label" in item && (
                    <Field
                      label="Item label"
                      value={item.label}
                      onChange={(v) =>
                        editItem((i) => {
                          if ("label" in i) i.label = v.slice(0, 160);
                        })
                      }
                    />
                  )}
                  <div className="whiteboard-properties">
                    {(["x", "y", "width", "height"] as const).map((k) => (
                      <label className="field" key={k}>
                        {k}
                        <input
                          aria-label={`Item ${k}`}
                          disabled={item.locked}
                          type="number"
                          value={item[k]}
                          onChange={(e) =>
                            editItem((i) => {
                              i[k] = Number(e.target.value);
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  {card && (
                    <div className="whiteboard-card-info">
                      <strong>{card.title}</strong>
                      <p>
                        {card.mode === "linked"
                          ? "Linked content follows its source. Moving this card changes only its layout."
                          : "Independent copy. Its text no longer follows the source."}
                      </p>
                      {card.mode === "linked" ? (
                        <div className="button-row">
                          <button
                            onClick={() =>
                              session.search.open({
                                area: "operation",
                                operationId: op.id,
                                target: card.source,
                              })
                            }
                          >
                            Open source
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const values = resolvePlanningCard(
                                    op,
                                    config,
                                    card,
                                  ).values,
                                  copy = independentCard(
                                    op,
                                    config,
                                    card,
                                    uid(),
                                    {
                                      target: card.source,
                                      contentHash: await cardHash(values),
                                      state: session.search.originState(op.id),
                                    },
                                  );
                                change((o) => {
                                  if (
                                    canonical(
                                      resolvePlanningCard(o, config, card)
                                        .values,
                                    ) !== canonical(values)
                                  )
                                    throw Error(
                                      "The source changed. Try again.",
                                    );
                                  o.planningCards!.definitions.push(copy);
                                  const i = o
                                    .whiteboards!.boards.find(
                                      (b) => b.id === board.id,
                                    )!
                                    .items.find((i) => i.id === item.id)!;
                                  if (i.kind === "card") i.cardId = copy.id;
                                });
                              })
                            }
                          >
                            Make independent copy
                          </button>
                        </div>
                      ) : (
                        <>
                          {card.values.map((v, index) => (
                            <Field
                              key={v.key}
                              label={v.label}
                              value={v.value}
                              area
                              plain
                              onChange={(text) =>
                                change((o) => {
                                  const c = o.planningCards!.definitions.find(
                                    (c) => c.id === card.id,
                                  )!;
                                  if (c.mode === "independent")
                                    c.values[index].value = text.slice(
                                      0,
                                      20000,
                                    );
                                })
                              }
                            />
                          ))}
                        </>
                      )}
                    </div>
                  )}
                  <div className="button-row">
                    <button
                      disabled={item.locked}
                      onClick={() =>
                        edit((b) => {
                          const at = b.items.findIndex((i) => i.id === item.id);
                          if (at > 0)
                            [b.items[at - 1], b.items[at]] = [
                              b.items[at],
                              b.items[at - 1],
                            ];
                        })
                      }
                    >
                      Send backward
                    </button>
                    <button
                      disabled={item.locked}
                      onClick={() =>
                        edit((b) => {
                          const at = b.items.findIndex((i) => i.id === item.id);
                          if (at < b.items.length - 1)
                            [b.items[at], b.items[at + 1]] = [
                              b.items[at + 1],
                              b.items[at],
                            ];
                        })
                      }
                    >
                      Bring forward
                    </button>
                  </div>
                </>
              ) : (
                <p>
                  Use the controls below to duplicate or remove the selected
                  items.
                </p>
              )}
              {!!selected.length && (
                <div className="button-row">
                  <button
                    disabled={board.items.length + selected.length > 300}
                    onClick={() => {
                      const copies = board.items
                        .filter((i) => selected.includes(i.id))
                        .map((i) => ({
                          ...structuredClone(i),
                          id: uid(),
                          x: i.x + 24,
                          y: i.y + 24,
                          locked: false,
                        }));
                      edit((b) => {
                        copies.forEach((i) => fitBoardItem(b, i));
                        b.items.push(...copies);
                      });
                      setSelected(copies.map((i) => i.id));
                    }}
                  >
                    Duplicate selection
                  </button>
                  <button
                    disabled={
                      !board.items.some(
                        (i) => selected.includes(i.id) && !i.locked,
                      )
                    }
                    onClick={remove}
                  >
                    Remove selection
                  </button>
                </div>
              )}
              {!!selected.length &&
                board.connectors
                  .filter(
                    (c) =>
                      selected.includes(c.fromId) || selected.includes(c.toId),
                  )
                  .map((c) => (
                    <fieldset className="whiteboard-connector" key={c.id}>
                      <legend>Visual connector</legend>
                      <Field
                        label="Connector label"
                        value={c.label}
                        onChange={(v) =>
                          edit((b) => {
                            b.connectors.find((x) => x.id === c.id)!.label =
                              v.slice(0, 160);
                          })
                        }
                      />
                      <label className="field">
                        Line
                        <select
                          aria-label="Connector line"
                          value={c.style}
                          onChange={(e) =>
                            edit((b) => {
                              b.connectors.find((x) => x.id === c.id)!.style = e
                                .target.value as typeof c.style;
                            })
                          }
                        >
                          <option value="solid">Solid</option>
                          <option value="dashed">Dashed</option>
                        </select>
                      </label>
                      <label className="field">
                        Arrow
                        <select
                          aria-label="Connector arrow"
                          value={c.arrow}
                          onChange={(e) =>
                            edit((b) => {
                              b.connectors.find((x) => x.id === c.id)!.arrow = e
                                .target.value as typeof c.arrow;
                            })
                          }
                        >
                          {["none", "end", "both"].map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={() =>
                          edit((b) => {
                            b.connectors = b.connectors.filter(
                              (x) => x.id !== c.id,
                            );
                          })
                        }
                      >
                        Remove connector
                      </button>
                    </fieldset>
                  ))}
            </BoardDialog>
          )}
          {panel === "find" && (
            <BoardDialog title="Find item" onClose={() => setPanel(null)}>
              <label className="field">
                Find an item
                <input
                  data-dialog-initial
                  aria-label="Find whiteboard item"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="whiteboard-item-list">
                {board.items
                  .filter((i) =>
                    itemLabel(i)
                      .toLocaleLowerCase()
                      .includes(query.toLocaleLowerCase()),
                  )
                  .slice(0, 50)
                  .map((i) => (
                    <button
                      key={i.id}
                      aria-pressed={selected.includes(i.id)}
                      onClick={() => {
                        setSelected([i.id]);
                        setPanel(null);
                        requestAnimationFrame(() => {
                          const hit =
                            workspace.current?.querySelector<HTMLButtonElement>(
                              `[data-whiteboard-item="${i.id}"]`,
                            );
                          hit?.focus({ preventScroll: true });
                          hit?.scrollIntoView({
                            block: "nearest",
                            inline: "nearest",
                          });
                        });
                      }}
                    >
                      {itemLabel(i).slice(0, 80)}
                      <small>
                        {i.kind}
                        {i.locked ? " · Locked" : ""}
                      </small>
                    </button>
                  ))}
              </div>
              {board.items.length > 50 && (
                <small>
                  Showing up to 50 matches. Use search to find another item.
                </small>
              )}
            </BoardDialog>
          )}
        </>
      ) : (
        <div className="wb-start">
          <h3>Create a whiteboard</h3>
          <p>
            Arrange notes, symbols, and planning cards for this operation.
          </p>{" "}
          <button
            disabled={busy || boards.length >= 12}
            onClick={() => addBoard(newWhiteboard(uid()))}
          >
            New whiteboard
          </button>
        </div>
      )}
      {panel === "snapshots" && (
        <BoardDialog
          title="Snapshots"
          onClose={() => setPanel(null)}
          busy={busy}
        >
          <WhiteboardSnapshots
            op={op}
            boardId={board?.id}
            publications={publications}
            dirty={dirty}
            change={change}
            onBusy={setBusy}
          />
        </BoardDialog>
      )}
      {picker === "symbol" && board && (
        <SavedSymbolPicker
          onCancel={() => setPicker(null)}
          onSelect={(pin, name) => {
            add({ ...frame(), kind: "symbol", pin, label: name });
            setPicker(null);
          }}
        />
      )}
      {picker === "card" && board && (
        <PlanningCardPicker
          op={op}
          config={config}
          searchLabel="Search whiteboard content"
          onClose={() => setPicker(null)}
          onAdd={(card, isNew) => {
            const i = {
              ...frame(),
              kind: "card" as const,
              cardId: card.id,
              width: 400,
              height: 300,
            };
            change((o) => {
              o.planningCards ??= { schemaVersion: 1, definitions: [] };
              if (isNew) o.planningCards.definitions.push(card);
              const b = o.whiteboards!.boards.find((b) => b.id === board.id)!;
              fitBoardItem(b, i);
              b.items.push(i);
            });
            setSelected([i.id]);
            setTool("select");
            setPicker(null);
          }}
        />
      )}
    </section>
  );
  return expanded ? (
    <ModalBackdrop>{boardWorkspace}</ModalBackdrop>
  ) : (
    boardWorkspace
  );
}
