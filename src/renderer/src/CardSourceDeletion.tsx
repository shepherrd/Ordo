import { useState } from "react";
import { ModalBackdrop } from "./ModalBackdrop";
import type { Operation, ResolvedConfig } from "../../domain/model";
import {
  removedCardSources,
  handleRemovedCardSources,
} from "../../domain/planning-card-actions";
import {
  resolvePlanningCard,
  cardPlacements,
} from "../../domain/planning-card-resolution";
import type { CardOrigin } from "../../domain/planning-cards";
import { cardHash } from "./PlanningCards";
import { useEditorProtection, useWorkspaceSession } from "./WorkspaceContext";
export function CardSourceDeletion({
  before,
  after,
  config,
  onCommit,
  onCancel,
}: {
  before: Operation;
  after: Operation;
  config: ResolvedConfig;
  onCommit: (op: Operation) => void;
  onCancel: () => void;
}) {
  const affected = removedCardSources(before, after),
    session = useWorkspaceSession();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEditorProtection({ name: "Pending source deletion", dirty: true, busy });
  const apply = async (action: "remove" | "copy") => {
    setBusy(true);
    setError("");
    try {
      const origins = new Map<string, CardOrigin>();
      if (action === "copy")
        for (const card of affected)
          if (card.mode === "linked")
            origins.set(card.id, {
              target: card.source,
              contentHash: await cardHash(
                resolvePlanningCard(before, config, card).values,
              ),
              state: session.search.originState(before.id),
            });
      onCommit(
        handleRemovedCardSources(before, after, config, action, origins),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalBackdrop>
      <section className="modal" aria-label="Delete linked source">
        <h2>This source has linked cards</h2>
        <p>
          Choose what happens to these cards before removing the source. The
          entire change can be undone before saving.
        </p>
        <ul>
          {affected.map((c) => (
            <li key={c.id}>
              {c.title} · {cardPlacements(before, c.id).length} order placements
              ·{" "}
              {before.whiteboards?.boards.reduce(
                (n, b) =>
                  n +
                  b.items.filter((i) => i.kind === "card" && i.cardId === c.id)
                    .length,
                0,
              ) ?? 0}{" "}
              whiteboard placements
              {before.briefings?.decks.some((d) =>
                d.slides.some((s) => s.cardIds.includes(c.id)),
              ) && " · also used in an archived briefing"}
            </li>
          ))}
        </ul>
        {error && <p role="alert">{error}</p>}
        <div className="button-row">
          <button disabled={busy} data-dialog-cancel onClick={onCancel}>
            Cancel
          </button>
          <button disabled={busy} onClick={() => void apply("copy")}>
            Keep cards as independent copies
          </button>
          <button
            disabled={busy}
            className="danger"
            onClick={() => void apply("remove")}
          >
            Remove dependent cards
          </button>
        </div>
      </section>
    </ModalBackdrop>
  );
}
