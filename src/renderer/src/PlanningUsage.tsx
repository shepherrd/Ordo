import { useEffect, useState } from "react";
import type {
  OperationSearchTarget,
  SearchTarget,
} from "../../domain/planning-target";
import { targetKey } from "../../domain/planning-target";
import {
  planningReferences,
  referenceMatches,
  type PlanningReference,
} from "../../domain/planning-usage";
import { retainedPlanningUsage } from "../../domain/planning-retained-usage";
import { documentStaleness } from "../../application/verify-document-layout";
import type { AppState } from "../../application/service";
import type { WhiteboardSummary } from "../../application/whiteboard-service";
import type { OfficeSummary } from "../../application/office-service";
import { RetainedProduct } from "./RetainedProduct";
import { useWorkspaceApi, useWorkspaceSession } from "./WorkspaceContext";
export function CatalogPlanningUsage({
  target,
  onOpen,
}: {
  target: SearchTarget;
  onOpen: (target: SearchTarget) => void;
}) {
  const api = useWorkspaceApi(),
    session = useWorkspaceSession();
  const [saved, setSaved] = useState<PlanningReference[]>([]),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void api
      .searchUsage({ target, excludedOwners: session.search.owners(), offset })
      .then((r) => {
        if (alive) {
          setSaved(r.references);
          setMore(r.more);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [target, offset]);
  const working = offset
    ? []
    : session.search
        .operationContexts()
        .flatMap((c) =>
          planningReferences(c.operation, c.config, c.cardOrigins).filter((r) =>
            referenceMatches(r.to, target),
          ),
        );
  return (
    <section aria-label="Catalog usage">
      <h4>Organization and symbol origins</h4>
      {error && <p role="alert">{error}</p>}
      {[...working, ...saved].map((r, i) => (
        <button key={i} onClick={() => onOpen(r.from)}>
          {r.label}
        </button>
      ))}
      {!working.length && !saved.length && !error && (
        <p>No current operation origins found.</p>
      )}
      <p>
        These are explicit consumption snapshots, not live links. Historical
        catalog coverage is unavailable where retained products do not record
        catalog IDs.
      </p>
      <button disabled={!offset} onClick={() => setOffset((n) => n - 50)}>
        Previous references
      </button>
      <button disabled={!more} onClick={() => setOffset((n) => n + 50)}>
        More references
      </button>
    </section>
  );
}

export function PlanningUsage({
  operationId,
  target,
  onOpen,
}: {
  operationId: string;
  target: OperationSearchTarget;
  onOpen?: () => void;
}) {
  const api = useWorkspaceApi(),
    session = useWorkspaceSession();
  const [state, setState] = useState<AppState | null>(null),
    [whiteboards, setWhiteboards] = useState<WhiteboardSummary[]>([]),
    [office, setOffice] = useState<OfficeSummary[]>([]),
    [savedRefs, setSavedRefs] = useState<PlanningReference[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  const ownersKey = session.search.owners().sort().join("|");
  useEffect(() => {
    setOffset(0);
  }, [operationId, targetKey(target)]);
  useEffect(() => {
    let alive = true;
    setSavedRefs([]);
    void api
      .searchUsage({
        target: { area: "operation", operationId, target },
        excludedOwners: session.search.owners(),
        offset,
      })
      .then((r) => {
        if (alive) {
          setSavedRefs(r.references);
          setMore(r.more);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [api, operationId, targetKey(target), offset, ownersKey]);
  useEffect(() => {
    let alive = true;
    setState(null);
    setOffice([]);
    setWhiteboards([]);
    setError("");
    void api
      .office({ type: "list", operationId })
      .then((r) => {
        if (alive) setOffice(r.records ?? []);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    void api
      .whiteboards({ type: "list", operationId })
      .then((r) => {
        if (alive) setWhiteboards(r.records ?? []);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    void api
      .execute({ type: "load", operationId })
      .then((s) => {
        if (alive) setState(s);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [operationId]);
  const context = session.search.context(operationId),
    op = context?.operation ?? state?.operation;
  const key = targetKey({ area: "operation", operationId, target });
  const references = [
    ...(offset
      ? []
      : session.search
          .operationContexts()
          .flatMap((c) =>
            planningReferences(c.operation, c.config, c.cardOrigins),
          )
          .filter((r) => targetKey(r.to) === key)),
    ...savedRefs,
  ];
  const retained = (state?.exports ?? []).map((record) => ({
    record,
    evidence: retainedPlanningUsage(record, target),
    status: op ? documentStaleness(record, op) : record.staleness,
  }));
  return (
    <section className="card-usage" aria-label="Used in">
      <h4>Current references and copy origins</h4>
      {!references.length && <p>No typed references found in the workspace.</p>}
      {references.map((r, i) => (
        <button
          key={i}
          onClick={() => {
            session.search.open(r.from);
            onOpen?.();
          }}
        >
          {r.kind}: {r.label}
        </button>
      ))}
      {(offset > 0 || more) && (
        <div className="button-row">
          <button
            disabled={!offset}
            onClick={() => setOffset((n) => Math.max(0, n - 50))}
          >
            Previous references
          </button>
          <button disabled={!more} onClick={() => setOffset((n) => n + 50)}>
            More references
          </button>
        </div>
      )}
      <h4>Retained order products</h4>
      {error && <p role="alert">{error}</p>}
      {!state && !error && <p>Checking retained products…</p>}
      {state && !retained.length && <p>No retained order products.</p>}
      {retained
        .filter(
          (r) =>
            r.evidence.used ||
            r.evidence.coverage.startsWith("Partial") ||
            r.evidence.coverage.startsWith("Unsupported"),
        )
        .map(({ record, evidence, status }) => (
          <div className="retained-usage-record" key={record.id}>
            <strong>{record.profile.name}</strong> · revision{" "}
            {record.sourceRevision} ·{" "}
            {record.supersededSource
              ? "Superseded"
              : status.compatibility !== "supported"
                ? "Unsupported"
                : status.outdated
                  ? "Outdated"
                  : "Current"}
            <br />
            {evidence.used
              ? "Source recorded in this product"
              : evidence.coverage}
            <RetainedProduct
              id={record.id}
              kind="order"
              name={record.profile.name}
              html={record.html}
            />
          </div>
        ))}
      {state && !!retained.length && !retained.some((r) => r.evidence.used) && (
        <p>No exact usage found in recorded dependencies.</p>
      )}
      <h4>Recent whiteboard snapshots</h4>
      {whiteboards
        .slice(0, 30)
        .filter((r) =>
          target.kind === "card"
            ? r.cardIds.includes(target.cardId)
            : r.sourceTargets.some((s) => targetKey(s) === key),
        )
        .map((r) => (
          <div className="retained-usage-record" key={r.id}>
            <strong>{r.name}</strong> · revision {r.sourceRevision} · {r.status}
            <br />
            Source captured in this saved snapshot
            <RetainedProduct id={r.id} kind="whiteboard" name={r.name} />
          </div>
        ))}
      {whiteboards.length > 30 && (
        <p>More retained snapshots are available in Whiteboards.</p>
      )}
      <h4>Recent Word exports</h4>
      {office.slice(0, 30).flatMap((r) => {
        if (r.source.kind !== "order") return [];
        const exportId = r.source.exportId;
        const evidence = retained.find(
          (e) => e.record.id === exportId,
        )?.evidence;
        if (
          !evidence ||
          !(
            evidence.used ||
            evidence.coverage.startsWith("Partial") ||
            evidence.coverage.startsWith("Unsupported")
          )
        )
          return [];
        return (
          <div className="retained-usage-record" key={r.id}>
            <strong>{r.name}</strong> · {r.format} · revision {r.sourceRevision}{" "}
            · {r.superseded ? "Superseded" : r.status}
            <br />
            {evidence.used
              ? "Source recorded in this order"
              : evidence.coverage}
            <RetainedProduct id={r.id} kind="office" name={r.name} />
          </div>
        );
      })}
      {office.length > 30 && (
        <p>More saved Word files are available in Export Studio.</p>
      )}
      <p>
        Independent copy origins are provenance, not live links. Historical
        coverage uses recorded dependencies; ordinary prose matches remain
        search results.
      </p>
    </section>
  );
}
