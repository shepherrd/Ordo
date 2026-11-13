import { useEffect, useMemo, useState } from "react";
import type {
  Operation,
  ResolvedConfig,
  Publication,
} from "../../domain/model";
import {
  newBriefingSlide,
  briefingLayouts,
  type Briefing,
  type BriefingSlide,
} from "../../domain/briefings";
import {
  projectBriefing,
  type BriefingGraphic,
  type BriefingView,
} from "../../export/briefing-v1";
import type {
  BriefingCommand,
  BriefingResult,
  BriefingSummary,
} from "../../application/briefing-service";
import type { GraphicExportSummary } from "../../application/symbology-ports";
import {
  resolvePlanningCard,
  independentCard,
} from "../../domain/planning-card-resolution";
import {
  useEditorProtection,
  useWorkspaceApi,
  useWorkspaceSession,
} from "./WorkspaceContext";
import { useSearchOpen } from "./SearchProvider";
import { Field } from "./Fields";
import { BriefingPreview, BriefingPresentation } from "./BriefingPreview";
import { PlanningCardPicker } from "./PlanningCardPicker";
import { cardHash } from "./PlanningCards";
import { editorError } from "./editor-error";
import "./briefing.css";

// Shelved for a later release; the 1.0 desktop does not expose this command.
export function BriefingWorkspace({
  briefings,
  op,
  config,
  publications,
  dirty,
  change,
}: {
  briefings: (command: BriefingCommand) => Promise<BriefingResult>;
  op: Operation;
  config: ResolvedConfig;
  publications: Publication[];
  dirty: boolean;
  change: (fn: (d: Operation) => void) => void;
}) {
  const api = useWorkspaceApi(),
    session = useWorkspaceSession();
  const [deckId, setDeckId] = useState(""),
    [slideId, setSlideId] = useState(""),
    [picker, setPicker] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [graphics, setGraphics] = useState<GraphicExportSummary[]>([]),
    [images, setImages] = useState(new Map<string, BriefingGraphic>()),
    [records, setRecords] = useState<BriefingSummary[]>([]),
    [recordOffset, setRecordOffset] = useState(0),
    [source, setSource] = useState("revision"),
    [revision, setRevision] = useState(op.revision),
    [presentation, setPresentation] = useState<{
      view: BriefingView;
      notes?: string[];
    } | null>(null);
  useEditorProtection({
    name: "Briefing builder",
    dirty: false,
    busy: busy || !!presentation,
  });
  const decks = op.briefings?.decks ?? [],
    deck = decks.find((d) => d.id === deckId) ?? decks[0],
    slide = deck?.slides.find((s) => s.id === slideId) ?? deck?.slides[0];
  const index = deck?.slides.findIndex((s) => s.id === slide?.id) ?? 0;
  useEffect(() => {
    setRevision(op.revision);
    setRecordOffset(0);
    void briefings({ type: "list", operationId: op.id })
      .then((r) => setRecords(r.records ?? []))
      .catch((e) => setError(editorError(e)));
  }, [op.id, op.revision, api]);
  useEffect(() => {
    let live = true;
    void api
      .graphicExports()
      .then((r) => {
        if (live)
          setGraphics(r.filter((g) => ["SVG", "PNG"].includes(g.format)));
      })
      .catch((e) => {
        if (live) setError(editorError(e));
      });
    return () => {
      live = false;
    };
  }, [api]);
  const graphicKey = JSON.stringify(
    deck?.slides.map((s) => [s.id, s.layout, s.graphic]),
  );
  useEffect(() => {
    let live = true;
    void Promise.all(
      (deck?.slides ?? [])
        .filter((s) => s.layout === "graphic" && s.graphic)
        .map(async (s) => {
          const g = s.graphic!;
          const value =
            g.kind === "export"
              ? (await briefings({ type: "graphic", exportId: g.exportId }))
                  .graphic
              : (
                  await api.files({
                    type: "asset-preview",
                    assetId: g.asset.assetId,
                  })
                )?.data;
          return [
            s.id,
            typeof value === "string"
              ? {
                  data: value,
                  hash: g.kind === "image" ? g.asset.sha256 : "",
                  label: g.kind === "image" ? g.asset.originalFilename : "",
                }
              : value,
          ] as const;
        }),
    )
      .then((results) => {
        if (live)
          setImages(
            new Map(
              results.filter(
                (r): r is readonly [string, BriefingGraphic] => !!r[1],
              ),
            ),
          );
      })
      .catch((e) => {
        if (live) {
          setImages(new Map());
          setError(editorError(e));
        }
      });
    return () => {
      live = false;
    };
  }, [api, graphicKey]);
  const view = useMemo(
    () => (deck ? projectBriefing(op, config, deck, images) : null),
    [op, config, deck, images],
  );
  useSearchOpen("operation", (target) => {
    if (target.area !== "operation" || target.operationId !== op.id) return;
    const t = target.target;
    if (t.kind === "briefing") {
      setDeckId(t.deckId);
      if (t.slideId) setSlideId(t.slideId);
    }
    if (t.kind === "card") {
      const d = decks.find((d) =>
        d.slides.some((s) => s.cardIds.includes(t.cardId)),
      );
      if (d) {
        setDeckId(d.id);
        setSlideId(d.slides.find((s) => s.cardIds.includes(t.cardId))!.id);
      }
    }
  });
  const edit = (fn: (d: Briefing) => void) => {
    setError("");
    setMessage("");
    if (deck)
      change((o) => fn(o.briefings!.decks.find((d) => d.id === deck.id)!));
  };
  const editSlide = (fn: (s: BriefingSlide) => void) => {
    if (slide) edit((d) => fn(d.slides.find((s) => s.id === slide.id)!));
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  const chosenSource: Extract<BriefingCommand, { type: "generate" }>["source"] =
    source === "revision"
      ? { kind: "revision", revision }
      : { kind: "publication", publicationId: source };
  return (
    <section className="panel briefing-workspace" aria-label="Briefing builder">
      <div className="briefing-topbar">
        <label className="field">
          Briefing
          <select
            aria-label="Choose briefing"
            value={deck?.id ?? ""}
            onChange={(e) => {
              setDeckId(e.target.value);
              setSlideId("");
            }}
          >
            <option value="" disabled>
              Choose a briefing
            </option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || decks.length >= 12}
          onClick={() => {
            const id = crypto.randomUUID(),
              s = newBriefingSlide(crypto.randomUUID(), "title");
            s.title = op.name;
            change((o) => {
              o.briefings ??= { schemaVersion: 1, decks: [] };
              o.briefings.decks.push({
                id,
                name: "New briefing",
                footer: "",
                slides: [s],
              });
            });
            setDeckId(id);
            setSlideId(s.id);
          }}
        >
          New briefing
        </button>
        {deck && (
          <>
            <button
              disabled={busy || decks.length >= 12}
              onClick={() => {
                const copy = structuredClone(deck);
                copy.id = crypto.randomUUID();
                copy.name = (copy.name + " copy").slice(0, 160);
                copy.slides.forEach((s) => (s.id = crypto.randomUUID()));
                change((o) => o.briefings!.decks.push(copy));
                setDeckId(copy.id);
                setSlideId("");
              }}
            >
              Duplicate briefing
            </button>
            <button
              disabled={busy}
              onClick={() => {
                change((o) => {
                  o.briefings!.decks = o.briefings!.decks.filter(
                    (d) => d.id !== deck.id,
                  );
                });
                setDeckId("");
                setSlideId("");
              }}
            >
              Remove briefing
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!deck ? (
        <p>
          Create a briefing, then add slides from the operation’s planning
          content and graphics.
        </p>
      ) : (
        <>
          <div className="two-columns" data-briefing-id={deck.id}>
            <Field
              label="Briefing name"
              value={deck.name}
              onChange={(v) =>
                edit((d) => {
                  d.name = v.slice(0, 160);
                })
              }
            />
            <Field
              label="Slide footer"
              value={deck.footer}
              onChange={(v) =>
                edit((d) => {
                  d.footer = v.slice(0, 200);
                })
              }
            />
          </div>
          <div className="briefing-workbench">
            <aside className="briefing-slides" aria-label="Slides">
              <div className="button-row">
                <strong>Slides · {deck.slides.length}/40</strong>
                <button
                  disabled={deck.slides.length >= 40}
                  onClick={() => {
                    const s = newBriefingSlide(crypto.randomUUID(), "text");
                    edit((d) => d.slides.push(s));
                    setSlideId(s.id);
                  }}
                >
                  Add slide
                </button>
              </div>
              <ol>
                {deck.slides.map((s, i) => (
                  <li key={s.id}>
                    <button
                      aria-current={s.id === slide?.id ? "step" : undefined}
                      onClick={() => setSlideId(s.id)}
                    >
                      <span>{i + 1}</span>
                      <span>
                        {s.title || "Untitled slide"}
                        <small>
                          {s.layout === "cards" ? "Planning cards" : s.layout}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </aside>
            <div className="briefing-editor">
              {slide && view ? (
                <>
                  <div className="briefing-slide-tools">
                    <label className="field">
                      Layout
                      <select
                        aria-label="Slide layout"
                        value={slide.layout}
                        onChange={(e) =>
                          editSlide((s) => {
                            s.layout = e.target
                              .value as BriefingSlide["layout"];
                          })
                        }
                      >
                        {briefingLayouts.map((l) => (
                          <option key={l} value={l}>
                            {l === "cards"
                              ? "Planning cards"
                              : l[0].toUpperCase() + l.slice(1)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      disabled={!index}
                      onClick={() =>
                        edit((d) => {
                          [d.slides[index - 1], d.slides[index]] = [
                            d.slides[index],
                            d.slides[index - 1],
                          ];
                        })
                      }
                    >
                      Move slide up
                    </button>
                    <button
                      disabled={index === deck.slides.length - 1}
                      onClick={() =>
                        edit((d) => {
                          [d.slides[index + 1], d.slides[index]] = [
                            d.slides[index],
                            d.slides[index + 1],
                          ];
                        })
                      }
                    >
                      Move slide down
                    </button>
                    <button
                      disabled={deck.slides.length >= 40}
                      onClick={() => {
                        const copy = {
                          ...structuredClone(slide),
                          id: crypto.randomUUID(),
                        };
                        edit((d) => d.slides.splice(index + 1, 0, copy));
                        setSlideId(copy.id);
                      }}
                    >
                      Duplicate slide
                    </button>
                    <button
                      onClick={() => {
                        edit((d) => {
                          d.slides = d.slides.filter((s) => s.id !== slide.id);
                        });
                        setSlideId(
                          deck.slides[Math.max(0, index - 1)]?.id ?? "",
                        );
                      }}
                    >
                      Remove slide
                    </button>
                  </div>
                  <div data-slide-id={slide.id}>
                    <Field
                      label="Slide title"
                      value={slide.title}
                      onChange={(v) =>
                        editSlide((s) => {
                          s.title = v.slice(0, 160);
                        })
                      }
                    />
                    <Field
                      label={
                        slide.layout === "graphic"
                          ? "Graphic caption"
                          : "Slide text"
                      }
                      area
                      plain
                      value={slide.body}
                      onChange={(v) =>
                        editSlide((s) => {
                          s.body = v.slice(0, 6000);
                        })
                      }
                    />
                  </div>
                  {slide.layout === "cards" && (
                    <div className="briefing-card-controls">
                      <button
                        disabled={slide.cardIds.length >= 4}
                        onClick={() => setPicker(true)}
                      >
                        Add planning content
                      </button>
                      {slide.cardIds.map((id) => {
                        const card = op.planningCards?.definitions.find(
                          (c) => c.id === id,
                        );
                        let resolved: ReturnType<
                          typeof resolvePlanningCard
                        > | null = null;
                        try {
                          if (card)
                            resolved = resolvePlanningCard(op, config, card);
                        } catch {
                          /* Display the resolver diagnostic below. */
                        }
                        return (
                          <div key={id} data-card-id={id}>
                            <strong>{card?.title ?? "Missing card"}</strong>
                            <small>
                              {card?.mode === "linked"
                                ? "Linked to operation"
                                : "Independent copy"}
                            </small>
                            <div className="button-row">
                              {card?.mode === "linked" && (
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
                              )}
                              {card?.mode === "linked" && resolved && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      const copy = independentCard(
                                        op,
                                        config,
                                        card,
                                        crypto.randomUUID(),
                                        {
                                          target: card.source,
                                          contentHash: await cardHash(
                                            resolved.values,
                                          ),
                                          state: session.search.originState(
                                            op.id,
                                          ),
                                        },
                                      );
                                      change((o) => {
                                        o.planningCards!.definitions.push(copy);
                                        const s = o
                                          .briefings!.decks.find(
                                            (d) => d.id === deck.id,
                                          )!
                                          .slides.find(
                                            (s) => s.id === slide.id,
                                          )!;
                                        s.cardIds = s.cardIds.map((v) =>
                                          v === id ? copy.id : v,
                                        );
                                      });
                                    })
                                  }
                                >
                                  Make independent copy
                                </button>
                              )}
                              <button
                                onClick={() =>
                                  editSlide((s) => {
                                    s.cardIds = s.cardIds.filter(
                                      (v) => v !== id,
                                    );
                                  })
                                }
                              >
                                Remove from slide
                              </button>
                            </div>
                            {card?.mode === "independent" &&
                              card.values
                                .filter((v) => card.fields.includes(v.key))
                                .map((v) => (
                                  <Field
                                    key={v.key}
                                    label={v.label}
                                    area
                                    plain
                                    value={v.value}
                                    onChange={(text) =>
                                      change((o) => {
                                        const c =
                                          o.planningCards!.definitions.find(
                                            (c) => c.id === id,
                                          )!;
                                        if (c.mode === "independent")
                                          c.values.find(
                                            (f) => f.key === v.key,
                                          )!.value = text.slice(0, 6000);
                                      })
                                    }
                                  />
                                ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {slide.layout === "graphic" && (
                    <div className="briefing-graphic-controls">
                      <label className="field">
                        Saved graphic
                        <select
                          aria-label="Saved briefing graphic"
                          value={
                            slide.graphic?.kind === "export"
                              ? slide.graphic.exportId
                              : ""
                          }
                          onChange={(e) =>
                            editSlide((s) => {
                              s.graphic = e.target.value
                                ? { kind: "export", exportId: e.target.value }
                                : null;
                            })
                          }
                        >
                          <option value="">Choose a saved SVG or PNG</option>
                          {graphics.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name} · {g.format} ·{" "}
                              {new Date(g.generatedAt).toLocaleString()}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="button-row">
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              setGraphics(
                                (await api.graphicExports()).filter((g) =>
                                  ["SVG", "PNG"].includes(g.format),
                                ),
                              );
                            })
                          }
                        >
                          Refresh graphics
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const result = await api.files({
                                type: "asset-import",
                                owner: { kind: "operation", id: op.id },
                              });
                              if (!result?.asset) return;
                              if (!result.asset.mimeType.startsWith("image/"))
                                throw Error(
                                  "Choose a PNG, JPEG, GIF or WebP image.",
                                );
                              editSlide((s) => {
                                s.graphic = {
                                  kind: "image",
                                  asset: result.asset!,
                                };
                              });
                            })
                          }
                        >
                          Import image
                        </button>
                        {slide.graphic?.kind === "image" && (
                          <span>{slide.graphic.asset.originalFilename}</span>
                        )}
                      </div>
                    </div>
                  )}
                  {view.slides[index]?.issues.map((issue) => (
                    <p className="notice warning" key={issue}>
                      {issue}
                    </p>
                  ))}
                  <BriefingPreview view={view} index={index} />
                  <Field
                    label="Presenter notes (excluded from PDF)"
                    area
                    plain
                    value={slide.notes}
                    onChange={(v) =>
                      editSlide((s) => {
                        s.notes = v.slice(0, 6000);
                      })
                    }
                  />
                </>
              ) : (
                <p>Add a slide to begin.</p>
              )}
            </div>
          </div>
          <div className="briefing-output">
            <div className="button-row">
              <button
                disabled={
                  busy ||
                  !view?.slides.length ||
                  view.slides.some((s) => s.issues.length > 0)
                }
                onClick={() => {
                  if (view)
                    setPresentation({
                      view: structuredClone(view),
                      notes: deck.slides.map((s) => s.notes),
                    });
                }}
              >
                Present briefing
              </button>
              <span>
                {dirty
                  ? "Working preview · save the operation to include these edits in a PDF."
                  : "Saved operation · revision " + op.revision}
              </span>
            </div>
            <div className="briefing-export-controls">
              <label className="field">
                PDF source
                <select
                  aria-label="Briefing PDF source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="revision">Saved revision</option>
                  {publications
                    .filter((p) =>
                      p.snapshot.briefings?.decks.some((d) => d.id === deck.id),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        Publication {p.orderNumber} v{p.version}
                      </option>
                    ))}
                </select>
              </label>
              {source === "revision" && (
                <label className="field">
                  Revision
                  <input
                    aria-label="Briefing source revision"
                    type="number"
                    min={1}
                    max={op.revision}
                    value={revision}
                    onChange={(e) => setRevision(Number(e.target.value))}
                  />
                </label>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const publication = publications.find(
                      (p) => p.id === source,
                    );
                    const result = await briefings({
                      type: "preview",
                      operationId: op.id,
                      deckId: deck.id,
                      revision:
                        source === "revision"
                          ? revision
                          : publication!.snapshot.revision,
                      publicationId: source === "revision" ? null : source,
                    });
                    if (result.view) setPresentation({ view: result.view });
                  })
                }
              >
                Preview saved source
              </button>
              <button
                disabled={busy || dirty}
                onClick={() =>
                  void run(async () => {
                    const result = await briefings({
                      type: "generate",
                      operationId: op.id,
                      deckId: deck.id,
                      expectedRevision: op.revision,
                      source: chosenSource,
                    });
                    setRecords(
                      (
                        await briefings({
                          type: "list",
                          operationId: op.id,
                        })
                      ).records ?? [],
                    );
                    setRecordOffset(0);
                    setMessage(
                      "Briefing PDF retained from revision " +
                        result.record!.sourceRevision +
                        ". Save a copy below.",
                    );
                  })
                }
              >
                {busy ? "Working…" : "Generate briefing PDF"}
              </button>
            </div>
          </div>
        </>
      )}
      <section aria-label="Saved briefing PDFs">
        {" "}
        <h3>Saved briefing PDFs</h3>
        {records.slice(0, 30).map((r) => (
          <div className="briefing-record" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <small>
                {new Date(r.generatedAt).toLocaleString()} · Revision{" "}
                {r.sourceRevision}
                {r.sourcePublicationId ? " · Published source" : ""} ·{" "}
                {r.status}
                {r.superseded ? " · Superseded publication" : ""}
              </small>
            </div>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r2 = await briefings({
                    type: "save",
                    id: r.id,
                  });
                  setMessage(
                    r2.path
                      ? "Saved " + r2.path
                      : "Save canceled. The PDF remains in Ordo.",
                  );
                })
              }
            >
              Save PDF
            </button>
          </div>
        ))}
        {!records.length && <p>No briefing PDFs generated yet.</p>}
        <div className="button-row">
          <button
            disabled={busy || !recordOffset}
            onClick={() =>
              void run(async () => {
                const offset = recordOffset - 30;
                setRecords(
                  (
                    await briefings({
                      type: "list",
                      operationId: op.id,
                      offset,
                    })
                  ).records ?? [],
                );
                setRecordOffset(offset);
              })
            }
          >
            Previous PDFs
          </button>
          <button
            disabled={busy || records.length <= 30}
            onClick={() =>
              void run(async () => {
                const offset = recordOffset + 30;
                setRecords(
                  (
                    await briefings({
                      type: "list",
                      operationId: op.id,
                      offset,
                    })
                  ).records ?? [],
                );
                setRecordOffset(offset);
              })
            }
          >
            More PDFs
          </button>
        </div>
      </section>
      {picker && deck && slide && (
        <PlanningCardPicker
          op={op}
          config={config}
          onClose={() => setPicker(false)}
          onAdd={(card, isNew) => {
            change((o) => {
              if (isNew) {
                o.planningCards ??= { schemaVersion: 1, definitions: [] };
                o.planningCards.definitions.push(card);
              }
              const s = o
                .briefings!.decks.find((d) => d.id === deck.id)!
                .slides.find((s) => s.id === slide.id)!;
              if (!s.cardIds.includes(card.id)) s.cardIds.push(card.id);
            });
            setPicker(false);
          }}
        />
      )}
      {presentation && (
        <BriefingPresentation
          {...presentation}
          onClose={() => setPresentation(null)}
        />
      )}
    </section>
  );
}
