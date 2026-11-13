import type { DocumentComparison as Comparison } from "../../domain/document-review";
import { editorError } from "./editor-error";
import { countLabel } from "./ui-text";
import { Field } from "./Fields";
import { NarrativeContent } from "./NarrativeContent";
import { narrativeDisplayText } from "../../domain/narrative";
import {
  BusyBoundary,
  useWorkspaceApi,
  useEditorProtection,
} from "./WorkspaceContext";
import { useEffect, useMemo, useState } from "react";
import type { Operation } from "../../domain/model";
import type { ComparisonEndpoint, ChangeRecord } from "../../domain/diff/model";
import { categories } from "../../domain/diff/model";
import {
  dispositions,
  reviewState,
  type ChangeReview,
  type ReviewAction,
} from "../../domain/reviews";
import type { ReviewResult } from "../../application/document-layout-review";
import { renderReviewReport } from "../../export/narrative-review-report";
import { textDifference } from "../../domain/diff/text";
import { useWorkingCopy, useRecoveryOpen } from "./WorkingCopies";

const human = (v: string) =>
  v
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
const key = (e: ComparisonEndpoint) =>
  e.kind === "PUBLICATION" ? `p:${e.publicationId}` : `r:${e.revisionId}`;
const selector = (e: ComparisonEndpoint) =>
  e.kind === "PUBLICATION"
    ? {
        kind: "PUBLICATION" as const,
        operationId: e.operationId,
        publicationId: e.publicationId!,
      }
    : {
        kind: "REVISION" as const,
        operationId: e.operationId,
        revisionId: e.revisionId,
      };
type ChangeDraft = {
  decision?: (typeof dispositions)[number];
  note?: string;
  comment?: string;
};
export function ReviewWorkspace({
  op,
  unsaved,
  active,
  onSource,
}: {
  op: Operation;
  unsaved: boolean;
  active: boolean;
  onSource: (c: ChangeRecord) => void;
}) {
  const desktop = useWorkspaceApi();
  const [data, setData] = useState<ReviewResult | null>(null),
    [review, setReview] = useState<ChangeReview | null>(null),
    [quick, setQuick] = useState<Comparison | null>(null);
  const [baseline, setBaseline] = useState(""),
    [target, setTarget] = useState(""),
    [title, setTitle] = useState("Planning change review"),
    [description, setDescription] = useState("");
  const [parent, setParent] = useState<string | null>(null),
    [supersedes, setSupersedes] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [report, setReport] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [product, setProduct] = useState(""),
    [disposition, setDisposition] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [bulk, setBulk] = useState<(typeof dispositions)[number]>("NOTED"),
    [confirm, setConfirm] = useState(false),
    [note, setNote] = useState("");
  const [comment, setComment] = useState(""),
    [metadata, setMetadata] = useState(false),
    [limit, setLimit] = useState(100),
    [historyLimit, setHistoryLimit] = useState(30);
  const [detailsBaseline, setDetailsBaseline] = useState({
    title: "Planning change review",
    description: "",
  });
  // Keep unsubmitted change text outside filtered cards so filtering or source
  // navigation cannot discard it. This is editor state, not review history.
  const [changeDrafts, setChangeDrafts] = useState<Record<string, ChangeDraft>>(
    {},
  );
  const notesDirty = !!(
    comment ||
    note ||
    Object.values(changeDrafts).some(
      (draft) => draft.decision !== undefined || draft.note || draft.comment,
    )
  );
  const detailsDirty =
    title !== detailsBaseline.title ||
    description !== detailsBaseline.description;
  const dirty = notesDirty || detailsDirty || !!parent || !!supersedes;
  const workingNotes = {
    baseline,
    target,
    title,
    description,
    comment,
    note,
    parent,
    supersedes,
    changeDrafts,
  };
  const recovery = useWorkingCopy({
    kind: review ? "review" : "review-new",
    id: review?.id ?? op.id,
    scope: op.id,
    label: review?.title ?? "New change review",
    source: review ?? { id: op.id, revision: op.revision },
    value: workingNotes,
    dirty,
    busy,
    apply: (v) => {
      setBaseline(v.baseline);
      setTarget(v.target);
      setTitle(v.title);
      setDescription(v.description);
      setComment(v.comment);
      setNote(v.note);
      setParent(v.parent);
      setSupersedes(v.supersedes);
      setChangeDrafts(v.changeDrafts);
    },
  });
  useRecoveryOpen("review", (d) => {
    if (d.scope === op.id) void run(() => loadReview(d.id));
  });
  useEditorProtection({ name: "Change review notes and details", dirty, busy });
  const requireCleanNotes = () => {
    if (notesDirty)
      throw Error(
        "Record or discard unsubmitted review notes before changing the review.",
      );
  };
  const requireCleanReview = () => {
    if (dirty)
      throw Error(
        "Record or discard unsubmitted review notes and details before opening another review.",
      );
  };
  const state = review ? reviewState(review) : null,
    comparison = review?.comparison ?? quick,
    open = state?.status === "OPEN";
  const endpoints = [
    ...(data?.history.map((h) => h.endpoint) ?? []),
    ...(data?.publicationEndpoints ?? []),
  ];
  const refresh = async () => {
    const d = await desktop.reviews({
      type: "history",
      operationId: op.id,
    });
    setData(d);
    setBaseline(
      (v) =>
        v ||
        (d.history[1]
          ? key(d.history[1].endpoint)
          : d.history[0]
            ? key(d.history[0].endpoint)
            : ""),
    );
    setTarget((v) => v || (d.history[0] ? key(d.history[0].endpoint) : ""));
    return d;
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      return true;
    } catch (e) {
      setError(
        editorError(e).replace(
          /^Error: Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (active)
      void run(async () => {
        await refresh();
      });
  }, [active, op.revision]);
  const actions = async (items: ReviewAction[], confirmedBulk = false) => {
    if (!review) return;
    if (items.some((a) => a.type === "COMPLETE" || a.type === "ARCHIVE"))
      requireCleanReview();
    const r = await desktop.reviews({
      type: "review-actions",
      id: review.id,
      expectedSequence: review.events.length,
      actions: items,
      confirmedBulk,
    });
    setReview(r.review);
    // Clear only text acknowledged by the append-only review command. Failed
    // requests leave every draft intact, including cards hidden by filters.
    for (const action of items) {
      if (action.type === "METADATA") {
        setDetailsBaseline({
          title: action.title,
          description: action.description,
        });
      } else if (action.type === "COMMENT" && !action.changeId) {
        setComment("");
      } else if (
        (action.type === "COMMENT" || action.type === "DECISION") &&
        action.changeId
      ) {
        setChangeDrafts((previous) => {
          const next = { ...previous },
            draft = { ...next[action.changeId!] };
          if (action.type === "COMMENT") delete draft.comment;
          else {
            delete draft.decision;
            delete draft.note;
          }
          if (Object.keys(draft).length) next[action.changeId!] = draft;
          else delete next[action.changeId!];
          return next;
        });
      }
    }
    if (confirmedBulk) setNote("");
    setNotice("Review history recorded. Planning content is unchanged.");
    setSelected([]);
    setConfirm(false);
    await refresh();
  };
  const pair = () => {
    const a = endpoints.find((e) => key(e) === baseline),
      b = endpoints.find((e) => key(e) === target);
    if (!a || !b) throw Error("Choose two saved revisions or publications");
    return {
      baseline: selector(a),
      target: selector(b),
      engineVersion: (data?.requiresGraphicalReview ||
      endpoints.some((e) => e.symbologyStateVersion)
        ? "diff-engine-v3"
        : a.unitProfileStateVersion || b.unitProfileStateVersion
          ? "diff-engine-v2"
          : "diff-engine-v1") as
        "diff-engine-v1" | "diff-engine-v2" | "diff-engine-v3",
    };
  };
  const resetFilters = () => {
    setSearch("");
    setCategory("");
    setProduct("");
    setDisposition("");
    setSelected([]);
    setLimit(100);
  };
  const loadReview = async (id: string) => {
    requireCleanReview();
    const r = await desktop.reviews({ type: "get-review", id });
    setReview(r.review);
    setQuick(null);
    setReport(false);
    setMetadata(false);
    resetFilters();
  };
  const filtered = useMemo(
    () =>
      comparison?.changes.filter(
        (c) =>
          (!category || c.category === category) &&
          (!product ||
            c.productId === product ||
            comparison.impacts.some(
              (i) =>
                i.productId === product && i.changeIds.includes(c.changeId),
            )) &&
          (!disposition ||
            (state?.decisions[c.changeId] ?? "UNREVIEWED") === disposition) &&
          (!search ||
            `${c.humanSummary} ${c.beforeDisplay} ${c.afterDisplay} ${c.sourceLabel} ${c.targetLabel}`
              .toLowerCase()
              .includes(search.toLowerCase())),
      ) ?? [],
    [comparison, category, product, disposition, search, state],
  );
  const products = [
    ...new Map([
      ...(comparison?.changes
        .filter((c) => c.productId)
        .map(
          (c) =>
            [
              c.productId!,
              c.location.page === "base"
                ? "Base order"
                : c.entityType === "product"
                  ? c.targetLabel
                  : `Product ${c.productId!.slice(0, 8)}`,
            ] as const,
        ) ?? []),
      ...(comparison?.impacts
        .filter((i) => i.productId && i.kind === "PRODUCT")
        .map((i) => [i.productId!, i.label] as const) ?? []),
    ]),
  ];
  const sourceExists = (c: ChangeRecord) =>
    c.moduleInstanceId
      ? op.modules?.instances.some(
          (m) =>
            m.moduleInstanceId === c.moduleInstanceId &&
            m.layoutState === "ACTIVE",
        )
      : c.entityType === "product"
        ? op.attachments.some((p) => p.id === c.entityId)
        : c.entityType === "base" ||
            c.entityType === "operation" ||
            c.entityType === "signal"
          ? true
          : [
              ...op.units,
              ...op.tasks,
              ...op.objectives,
              ...op.phases,
              ...op.events,
              ...op.signal.nets,
              ...op.signal.pacePlans,
            ].some((e) => e.id === c.entityId);
  return (
    <BusyBoundary
      busy={busy}
      className="review-workspace"
      data-testid="review-workspace"
    >
      {recovery}
      <p className="eyebrow">SAVED HISTORY · CONTROLLED CHANGE REVIEW</p>
      <p>
        Compare saved planning states. Decisions record an assessment and never
        apply, revert, approve, or publish changes.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {dirty && (
        <p className="notice">
          Unsubmitted review notes or details are retained, including filtered
          changes.{" "}
          <button
            onClick={() => {
              setComment("");
              setNote("");
              setChangeDrafts({});
              setTitle(detailsBaseline.title);
              setDescription(detailsBaseline.description);
              setParent(null);
              setSupersedes(null);
              setMetadata(false);
            }}
          >
            Discard unsubmitted review edits
          </button>
        </p>
      )}
      {unsaved && (
        <p className="notice" role="status">
          Unsaved changes exist. Save a planning revision and save or discard
          export-profile edits before creating a controlled review. Quick
          comparisons use saved states only.
        </p>
      )}
      <details className="review-history" open={!comparison}>
        <summary>Saved revision history ({data?.history.length ?? 0})</summary>

        <table>
          <thead>
            <tr>
              <th>Revision</th>
              <th>Saved / actor</th>
              <th>Status / associations</th>
              <th>Comparison</th>
            </tr>
          </thead>
          <tbody>
            {data?.history.slice(0, historyLimit).map((h) => (
              <tr key={h.endpoint.revisionId}>
                <td>
                  <strong>
                    r{h.endpoint.revisionNumber}
                    {h.current ? " · Current" : ""}
                  </strong>
                  <br />
                  {h.endpoint.operationName}
                  <br />
                  <small>{h.endpoint.revisionId}</small>
                </td>
                <td>
                  {h.endpoint.timestamp}
                  <br />
                  {h.actor}
                </td>
                <td>
                  {h.status}
                  <br />
                  {h.approvalIds.length} approvals · {h.publicationIds.length}{" "}
                  publications
                </td>
                <td>
                  <button onClick={() => setBaseline(key(h.endpoint))}>
                    Use r{h.endpoint.revisionNumber} as baseline
                  </button>
                  <button onClick={() => setTarget(key(h.endpoint))}>
                    Use r{h.endpoint.revisionNumber} as target
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.history.length ?? 0) > historyLimit && (
          <button onClick={() => setHistoryLimit((n) => n + 30)}>
            Show more revisions
          </button>
        )}
      </details>
      <section className="review-panel">
        <h2>Quick comparison</h2>
        <div className="review-actions">
          <button
            disabled={busy || !data?.history[1]}
            onClick={() => {
              if (data?.history[1]) {
                setBaseline(key(data.history[1].endpoint));
                setTarget(key(data.history[0].endpoint));
                setReview(null);
                setQuick(null);
              }
            }}
          >
            Current saved vs previous
          </button>
          <button
            disabled={busy || !data?.publicationEndpoints.length}
            onClick={() => {
              if (data?.publicationEndpoints[0]) {
                setBaseline(key(data.publicationEndpoints[0]));
                setTarget(key(data.history[0].endpoint));
                setReview(null);
                setQuick(null);
              }
            }}
          >
            Current saved vs publication
          </button>
        </div>
        <div className="review-columns">
          {(["Baseline", "Target"] as const).map((side) => (
            <label className="field" key={side}>
              <span>{side} saved endpoint</span>
              <select
                aria-label={`${side} saved endpoint`}
                value={side === "Baseline" ? baseline : target}
                onChange={(e) =>
                  (side === "Baseline" ? setBaseline : setTarget)(
                    e.target.value,
                  )
                }
              >
                {endpoints.map((e) => (
                  <option key={key(e)} value={key(e)}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <button
          disabled={busy || !baseline || !target}
          onClick={() =>
            run(async () => {
              requireCleanNotes();
              const r = await desktop.reviews({
                type: "compare",
                ...pair(),
              });
              setQuick(r.comparison);
              setReview(null);
              setReport(false);
              resetFilters();
            })
          }
        >
          Compare saved states
        </button>
        <div className="review-columns">
          <label className="field">
            <span>Review title</span>
            <input
              aria-label="Review title"
              maxLength={160}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <Field
            area
            plain={
              !!review && review.reportRendererVersion !== "review-html-v4"
            }
            label="Review description"
            value={description}
            onChange={setDescription}
          />
        </div>
        {(parent || supersedes) && (
          <p>
            New review linked to {supersedes ? "supersede" : "follow on from"}{" "}
            {supersedes ?? parent}.{" "}
            <button
              onClick={() => {
                setParent(null);
                setSupersedes(null);
              }}
            >
              Clear link
            </button>
          </p>
        )}
        <button
          className="primary"
          disabled={busy || unsaved || !title.trim() || !baseline || !target}
          onClick={() =>
            run(async () => {
              if (unsaved) throw Error("Save a revision first");
              requireCleanNotes();
              const r = await desktop.reviews({
                type: "create-review",
                formattedText: true,
                ...pair(),
                title,
                description,
                expectedRevision: op.revision,
                parentReviewId: parent,
                supersedesReviewId: supersedes,
              });
              setReview(r.review);
              setDetailsBaseline({ title, description });
              setQuick(null);
              setParent(null);
              setSupersedes(null);
              setReport(false);
              resetFilters();
              await refresh();
              setNotice(
                "Change review created. Its compared revisions and change list are saved.",
              );
            })
          }
        >
          Create Change Review
        </button>
      </section>
      <section className="review-panel">
        <h2>Saved Change Reviews</h2>
        <label>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived reviews
        </label>
        <label className="field">
          <span>Open review</span>
          <select
            aria-label="Open review"
            value={review?.id ?? ""}
            onChange={(e) =>
              e.target.value && run(() => loadReview(e.target.value))
            }
          >
            <option value="">Choose a review</option>
            {data?.reviews
              .filter(
                (r) =>
                  showArchived ||
                  reviewState(r).status !== "ARCHIVED" ||
                  r.id === review?.id,
              )
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {reviewState(r).title} · {reviewState(r).status} · r
                  {r.comparison.baseline.revisionNumber} → r
                  {r.comparison.target.revisionNumber}
                </option>
              ))}
          </select>
        </label>
      </section>
      {comparison && (
        <section className="review-panel">
          <h2>{state?.title ?? "Quick Comparison"}</h2>
          <p>
            {state
              ? `${state.status} · ${review!.createdByLocalActor} · ${review!.createdAt}`
              : "Preview only · create a change review to keep it"}
          </p>
          <div className="review-columns">
            {(["baseline", "target"] as const).map((side) => (
              <div key={side}>
                <strong>
                  {human(side)}: {comparison[side].label}
                </strong>
                <p>
                  {comparison[side].timestamp}
                  <br />
                </p>
                <details>
                  <summary>Source details</summary>
                  <small>
                    Doctrine {comparison[side].doctrineRef.id} v
                    {comparison[side].doctrineRef.version}
                    <br />
                    Revision {comparison[side].revisionId}
                    <br />
                    Publication {comparison[side].publicationId ?? "—"}
                    <br />
                    State SHA-256 {comparison[side].stateHash}
                    <br />
                    Configuration SHA-256 {comparison[side].configHash}
                  </small>
                </details>
              </div>
            ))}
          </div>
          <p>
            {countLabel(comparison.changes.length, "change")} ·{" "}
            {countLabel(comparison.impacts.length, "affected reference")}
          </p>
          {comparison.documentPresentation?.exports.map((e) => (
            <p className="notice" key={e.exportId}>
              {e.label}: header/footer{" "}
              {e.targetChangedPaths.length
                ? "needs a new export to match the selected revision."
                : "matches the selected revision."}
            </p>
          ))}
          {comparison.diagnostics.map((d) => (
            <p key={d.artifactId} className="notice">
              {d.message}
            </p>
          ))}
          {comparison.whiteboards && (
            <section>
              <h3>Planning whiteboards</h3>
              {comparison.whiteboards.changes.map((c, i) => (
                <article key={i}>
                  <h4>
                    {c.label} · {c.field}
                  </h4>
                  <p>Before: {c.before}</p>
                  <p>After: {c.after}</p>
                </article>
              ))}
              {!comparison.whiteboards.changes.length && (
                <p>No whiteboard changes.</p>
              )}
            </section>
          )}
          {comparison.planningSchedule && (
            <section aria-label="Timeline and writing progress changes">
              <h3>
                Timeline and writing progress ·{" "}
                {comparison.planningSchedule.changes.length} changes
              </h3>
              {comparison.planningSchedule.changes.map((c, i) => (
                <div className="entity" key={i}>
                  <h4>
                    {c.label} · {c.field}
                  </h4>
                  <p>Before: {c.before}</p>
                  <p>After: {c.after}</p>
                </div>
              ))}
            </section>
          )}
          {comparison.planningCards && (
            <section aria-label="Planning card changes">
              <h3>
                Planning cards · {comparison.planningCards.changes.length}{" "}
                changes
              </h3>
              {comparison.planningCards.changes.map((c) => (
                <div key={c.cardId}>
                  <strong>
                    {c.kind}: {c.label}
                  </strong>
                  <details>
                    <summary>Before and after</summary>
                    <pre>{c.before}</pre>
                    <pre>{c.after}</pre>
                  </details>
                </div>
              ))}
              {comparison.planningCards.exports.map((e) => (
                <p key={e.exportId}>
                  {e.label}:{" "}
                  {e.targetChangedPaths.length
                    ? "needs a new export"
                    : "matches this revision"}
                  .
                </p>
              ))}
            </section>
          )}
          {review && state && (
            <>
              <div className="review-actions">
                <button
                  disabled={busy || !open || state.counts.UNREVIEWED > 0}
                  onClick={() => run(() => actions([{ type: "COMPLETE" }]))}
                >
                  Complete review
                </button>
                <button
                  disabled={busy || state.status === "ARCHIVED"}
                  onClick={() => run(() => actions([{ type: "ARCHIVE" }]))}
                >
                  Archive review
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    if (dirty) {
                      setError(
                        "Record or discard unsubmitted review edits first.",
                      );
                      return;
                    }
                    setParent(review.id);
                    setSupersedes(null);
                    setBaseline(key(comparison.target));
                    setTarget(key(data!.history[0].endpoint));
                    setTitle(`${state.title.slice(0, 140)} · follow-on`);
                    setNotice(
                      "Choose saved endpoints and create the separate follow-on review above.",
                    );
                  }}
                >
                  Prepare follow-on review
                </button>
                <button
                  disabled={
                    busy || ["ARCHIVED", "SUPERSEDED"].includes(state.status)
                  }
                  onClick={() => {
                    if (dirty) {
                      setError(
                        "Record or discard unsubmitted review edits first.",
                      );
                      return;
                    }
                    setParent(null);
                    setSupersedes(review.id);
                    setBaseline(key(comparison.baseline));
                    setTarget(key(data!.history[0].endpoint));
                    setTitle(`${state.title.slice(0, 140)} · replacement`);
                    setNotice(
                      "Create the replacement above to mark this review as superseded.",
                    );
                  }}
                >
                  Prepare superseding review
                </button>
                <button onClick={() => setReport((v) => !v)}>
                  Preview review report
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const p = await desktop.saveReviewReport(review.id);
                      if (p) setNotice(`Review report saved: ${p}`);
                    })
                  }
                >
                  Save review report
                </button>
                {open && (
                  <button
                    onClick={() => {
                      if (dirty) {
                        setError(
                          "Record or discard unsubmitted review edits first.",
                        );
                        return;
                      }
                      setTitle(state.title);
                      setDescription(state.description);
                      setDetailsBaseline({
                        title: state.title,
                        description: state.description,
                      });
                      setMetadata((v) => !v);
                    }}
                  >
                    Edit review details
                  </button>
                )}
              </div>
              {metadata && open && (
                <button
                  disabled={busy || !title.trim()}
                  onClick={() =>
                    run(async () => {
                      await actions([{ type: "METADATA", title, description }]);
                      setMetadata(false);
                    })
                  }
                >
                  Record updated title and description
                </button>
              )}
              <NarrativeContent value={state.description} />
              <p>
                {dispositions
                  .map((d) => `${human(d)}: ${state.counts[d]}`)
                  .join(" · ")}
              </p>
              {state.completedAt && (
                <p>
                  Completed {state.completedAt} by {state.completedByLocalActor}
                  . Target remains revision {comparison.target.revisionNumber}.
                </p>
              )}
              {report && (
                <iframe
                  title="Change Review report"
                  className="review-report"
                  sandbox=""
                  srcDoc={renderReviewReport(review)}
                />
              )}
              <details>
                <summary>Review notes and lifecycle history</summary>
                {review.events
                  .filter(
                    (e) =>
                      e.action.type !== "DECISION" &&
                      (e.action.type !== "COMMENT" || !e.action.changeId),
                  )
                  .map((e) => (
                    <p key={e.id}>
                      #{e.sequence} · {e.at} · {e.actor} · {e.action.type}
                      {e.action.type === "COMMENT"
                        ? `: ${narrativeDisplayText(e.action.text)}`
                        : ""}
                    </p>
                  ))}
              </details>
              {open && (
                <div className="review-actions">
                  <Field
                    area
                    plain={review?.reportRendererVersion !== "review-html-v4"}
                    label="Review-level note"
                    value={comment}
                    onChange={setComment}
                  />
                  <button
                    disabled={busy || !comment.trim()}
                    onClick={() =>
                      run(async () => {
                        await actions([
                          { type: "COMMENT", changeId: null, text: comment },
                        ]);
                      })
                    }
                  >
                    Add review note
                  </button>
                </div>
              )}
            </>
          )}
          <div className="review-filters">
            <label className="field">
              <span>Search changes</span>
              <input
                aria-label="Search changes"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(100);
                }}
              />
            </label>
            <label className="field">
              <span>Disposition filter</span>
              <select
                aria-label="Disposition filter"
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
              >
                <option value="">All dispositions</option>
                {dispositions.map((d) => (
                  <option key={d} value={d}>
                    {human(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Category filter</span>
              <select
                aria-label="Category filter"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {human(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Product filter</span>
              <select
                aria-label="Product filter"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
              >
                <option value="">All products</option>
                {products.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={resetFilters}>Clear filters</button>
          </div>
          <p>{filtered.length} matching changes</p>
          {open && (
            <div className="review-bulk">
              <button
                onClick={() => {
                  setSelected(filtered.map((c) => c.changeId));
                  setConfirm(false);
                }}
              >
                Select filtered changes
              </button>
              <button
                onClick={() => {
                  setSelected([]);
                  setConfirm(false);
                }}
              >
                Clear selection
              </button>
              <label>
                Bulk disposition{" "}
                <select
                  aria-label="Bulk disposition"
                  value={bulk}
                  onChange={(e) => {
                    setBulk(e.target.value as typeof bulk);
                    setConfirm(false);
                  }}
                >
                  {dispositions.map((d) => (
                    <option key={d} value={d}>
                      {human(d)}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                area
                plain={review?.reportRendererVersion !== "review-html-v4"}
                label="Bulk decision note"
                value={note}
                onChange={setNote}
              />
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                Confirm {human(bulk)} for {selected.length} selected changes
              </label>
              <button
                disabled={busy || !selected.length || !confirm}
                onClick={() =>
                  run(() =>
                    actions(
                      selected.map((changeId) => ({
                        type: "DECISION",
                        changeId,
                        disposition: bulk,
                        note,
                      })),
                      true,
                    ),
                  )
                }
              >
                Record bulk decisions
              </button>
            </div>
          )}
          {filtered.slice(0, limit).map((c, i) => (
            <div key={c.changeId}>
              {(i === 0 || filtered[i - 1].category !== c.category) && (
                <h3>{human(c.category)}</h3>
              )}
              <ChangeCard
                change={c}
                draft={changeDrafts[c.changeId] ?? {}}
                onDraft={(patch) =>
                  setChangeDrafts((previous) => ({
                    ...previous,
                    [c.changeId]: { ...previous[c.changeId], ...patch },
                  }))
                }
                review={review}
                busy={busy}
                impacts={comparison.impacts.filter((v) =>
                  v.changeIds.includes(c.changeId),
                )}
                selected={selected.includes(c.changeId)}
                onSelect={() => {
                  setSelected((v) =>
                    v.includes(c.changeId)
                      ? v.filter((id) => id !== c.changeId)
                      : [...v, c.changeId],
                  );
                  setConfirm(false);
                }}
                onAction={(a) => run(() => actions([a]))}
                onSource={() => onSource(c)}
                exists={!!sourceExists(c)}
              />
            </div>
          ))}
          {filtered.length > limit && (
            <button onClick={() => setLimit((n) => n + 100)}>
              Show more changes
            </button>
          )}
          {!comparison.changes.length && (
            <p>No planning changes found between the selected saved records.</p>
          )}
        </section>
      )}
    </BusyBoundary>
  );
}
function ChangeCard({
  change: c,
  draft,
  onDraft,
  review,
  busy,
  impacts,
  selected,
  onSelect,
  onAction,
  onSource,
  exists,
}: {
  change: ChangeRecord;
  draft: ChangeDraft;
  onDraft: (patch: ChangeDraft) => void;
  review: ChangeReview | null;
  busy: boolean;
  impacts: Comparison["impacts"];
  selected: boolean;
  onSelect: () => void;
  onAction: (a: ReviewAction) => void;
  onSource: () => void;
  exists: boolean;
}) {
  const state = review ? reviewState(review) : null,
    open = state?.status === "OPEN",
    current = state?.decisions[c.changeId] ?? "UNREVIEWED";
  const decision = draft.decision ?? current,
    note = draft.note ?? "",
    comment = draft.comment ?? "";
  const delta = textDifference(
    narrativeDisplayText(c.beforeDisplay),
    narrativeDisplayText(c.afterDisplay),
  );
  return (
    <article className="review-change" data-change-id={c.changeId}>
      <div className="review-actions">
        {open && (
          <input
            type="checkbox"
            aria-label={`Select ${c.humanSummary}`}
            checked={selected}
            onChange={onSelect}
          />
        )}
        <strong>
          {human(c.changeType)} · {human(current)}
        </strong>
        <button disabled={!exists} onClick={onSource}>
          {exists ? "Open current source" : "Source removed from current plan"}
        </button>
      </div>
      <h3>{c.humanSummary}</h3>
      <p>
        {c.sourceLabel !== c.targetLabel
          ? `${c.sourceLabel} → ${c.targetLabel}`
          : c.targetLabel}
      </p>
      <div className="review-columns">
        {(["before", "after"] as const).map((side) => (
          <section key={side}>
            <strong>{human(side)}</strong>
            <pre>
              {delta[side].map((p, i) =>
                p.changed ? (
                  side === "before" ? (
                    <del key={i}>{p.text}</del>
                  ) : (
                    <ins key={i}>{p.text}</ins>
                  )
                ) : (
                  p.text
                ),
              )}
            </pre>
          </section>
        ))}
      </div>
      {impacts.length > 0 && (
        <details>
          <summary>Affected products and references ({impacts.length})</summary>
          {impacts.map((i) => (
            <section className="review-impact" key={i.id}>
              <strong>{i.label}</strong>
              <p>{i.reason}</p>
              <p>{i.chain.join(" → ")}</p>
              <div className="review-columns">
                <pre>{narrativeDisplayText(i.beforeDisplay)}</pre>
                <pre>{narrativeDisplayText(i.afterDisplay)}</pre>
              </div>
              {i.dependencyPaths.length > 0 && (
                <small>
                  Changed source references: {i.dependencyPaths.join(", ")}
                </small>
              )}
            </section>
          ))}
        </details>
      )}
      {open && (
        <>
          <div className="review-actions">
            <label>
              Disposition{" "}
              <select
                aria-label={`Disposition for ${c.humanSummary}`}
                value={decision}
                onChange={(e) =>
                  onDraft({
                    decision:
                      e.target.value === current
                        ? undefined
                        : (e.target.value as typeof decision),
                  })
                }
              >
                {dispositions.map((d) => (
                  <option key={d} value={d}>
                    {human(d)}
                  </option>
                ))}
              </select>
            </label>
            <Field
              area
              plain={review?.reportRendererVersion !== "review-html-v4"}
              label={`Decision note for ${c.humanSummary}`}
              value={note}
              onChange={(note) => onDraft({ note })}
            />
            <button
              disabled={busy}
              onClick={() =>
                onAction({
                  type: "DECISION",
                  changeId: c.changeId,
                  disposition: decision,
                  note,
                })
              }
            >
              Record decision
            </button>
          </div>
          <div className="review-actions">
            <Field
              area
              plain={review?.reportRendererVersion !== "review-html-v4"}
              label={`Comment for ${c.humanSummary}`}
              value={comment}
              onChange={(comment) => onDraft({ comment })}
            />
            <button
              disabled={busy || !comment.trim()}
              onClick={() => {
                onAction({
                  type: "COMMENT",
                  changeId: c.changeId,
                  text: comment,
                });
              }}
            >
              Add change comment
            </button>
          </div>
        </>
      )}
      {review && (
        <details>
          <summary>Decision and comment history</summary>
          {review.events
            .filter(
              (e) => "changeId" in e.action && e.action.changeId === c.changeId,
            )
            .map((e) => (
              <p key={e.id}>
                #{e.sequence} · {e.at} · {e.actor}:{" "}
                {e.action.type === "DECISION"
                  ? `${human(e.action.disposition)} · ${narrativeDisplayText(e.action.note)}`
                  : e.action.type === "COMMENT"
                    ? narrativeDisplayText(e.action.text)
                    : ""}
              </p>
            ))}
        </details>
      )}
      <details>
        <summary>Change details</summary>
        <small>
          {c.fieldPath}
          <br />
          Change {c.changeId}
          <br />
          Fingerprint {c.semanticFingerprint}
        </small>
      </details>
    </article>
  );
}
