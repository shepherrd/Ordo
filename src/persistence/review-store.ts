import { documentComparisonSchema as comparisonSchema } from "../domain/document-review";
import { documentPresentationImpacts } from "../application/document-layout-review";
import { planningCardComparison } from "../application/planning-card-review";
import { briefingComparison } from "../application/briefing-review";
import { planningScheduleComparison } from "../application/planning-schedule-review";
import { hasM6State } from "../domain/diff/m6-state";
import { semanticDiff } from "../domain/diff";
import { reviewImpactsV3 } from "../application/review-impact-v3";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { Repository } from "../application/ports";
import type { HistoryEntry } from "../application/review-ports";
import { fingerprintId } from "../domain/diff/model";
import { idSchema } from "../domain/model";
import {
  endpointSelectorSchema,
  endpointSchema,
  canonicalValue,
  type EndpointSelector,
  type ResolvedEndpoint,
  type ComparisonEndpoint,
} from "../domain/diff/model";
import {
  reviewHeaderSchema,
  reviewEventSchema,
  reviewState,
  type ReviewHeader,
  type ReviewEvent,
  type ChangeReview,
} from "../domain/reviews";
export const reviewHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const endpointSelector = (e: ComparisonEndpoint): EndpointSelector =>
  e.kind === "PUBLICATION"
    ? {
        kind: "PUBLICATION",
        operationId: e.operationId,
        publicationId: e.publicationId!,
      }
    : {
        kind: "REVISION",
        operationId: e.operationId,
        revisionId: e.revisionId,
      };
export class ReviewStore {
  constructor(
    private db: Database.Database,
    private repo: Repository,
  ) {}
  resolveEndpoint(input: EndpointSelector): ResolvedEndpoint {
    const selector = endpointSelectorSchema.parse(input);
    const publication =
      selector.kind === "PUBLICATION"
        ? this.repo
            .listPublications(selector.operationId)
            .find((p) => p.id === selector.publicationId)
        : null;
    if (selector.kind === "PUBLICATION" && !publication)
      throw Error("Publication endpoint not found in this operation");
    const row = publication
      ? this.db
          .prepare(
            "SELECT * FROM revision_identities WHERE operation_id=? AND revision=?",
          )
          .get(selector.operationId, publication.sourceRevision)
      : this.db
          .prepare(
            "SELECT * FROM revision_identities WHERE operation_id=? AND id=?",
          )
          .get(
            selector.operationId,
            selector.kind === "REVISION" ? selector.revisionId : "",
          );
    const identity = row as
      { id: string; operation_id: string; revision: number } | undefined;
    if (!identity) throw Error("Revision endpoint not found in this operation");
    const operation =
      publication?.snapshot ??
      this.repo.getOperation(selector.operationId, identity.revision);
    const config = publication?.config ?? this.repo.getConfig(operation);
    return {
      operation,
      config,
      endpoint: endpointSchema.parse({
        kind: selector.kind,
        operationId: operation.id,
        revisionId: identity.id,
        revisionNumber: identity.revision,
        publicationId: publication?.id ?? null,
        doctrineRef: operation.doctrineRef,
        organizationRef: operation.organizationRef,
        ...(operation.operationOrganizationBinding ||
        operation.staffPositionOverrides?.length ||
        operation.units.some((u) => u.sourceUnitProfile || u.profileIdentity)
          ? { unitProfileStateVersion: 1 }
          : {}),
        ...(operation.operationOrganizationBinding
          ? {
              unitProfileProvenance: {
                unitProfileFamilyId:
                  operation.operationOrganizationBinding.unitProfileFamilyId,
                unitProfileVersionId:
                  operation.operationOrganizationBinding.unitProfileVersionId,
                versionLabel:
                  operation.operationOrganizationBinding.versionLabel,
                contentHash: operation.operationOrganizationBinding.contentHash,
                designation:
                  operation.operationOrganizationBinding.identity
                    .fullDesignation,
              },
            }
          : {}),
        ...(hasM6State(operation) ? { symbologyStateVersion: 1 } : {}),
        echelonRef: operation.echelonRef,
        stateHash: reviewHash(canonicalValue(operation)),
        configHash: reviewHash(canonicalValue(config)),
        timestamp: publication?.publishedAt ?? operation.updatedAt,
        operationName: operation.name,
        label: publication
          ? `${publication.orderNumber} · Publication ${publication.version} · Revision ${identity.revision}`
          : `Revision ${identity.revision} · ${operation.name}`,
      }),
    };
  }
  revisionHistory(operationId: string): HistoryEntry[] {
    const current = this.repo.getOperation(operationId),
      approvals = this.repo.listApprovals(operationId),
      publications = this.repo.listPublications(operationId);
    return (
      this.db
        .prepare(
          "SELECT i.id,i.revision,r.actor FROM revision_identities i JOIN operation_revisions r ON r.operation_id=i.operation_id AND r.revision=i.revision WHERE i.operation_id=? ORDER BY i.revision DESC",
        )
        .all(operationId) as { id: string; revision: number; actor: string }[]
    ).map((r) => {
      const { endpoint, operation, config } = this.resolveEndpoint({
        kind: "REVISION",
        operationId,
        revisionId: r.id,
      });
      return {
        endpoint,
        actor: r.actor,
        status:
          config.doctrine.statuses.find(
            (s) => s.id === operation.metadata.statusId,
          )?.name ?? operation.metadata.statusId,
        approvalIds: approvals
          .filter((a) => a.sourceRevision === r.revision)
          .map((a) => a.id),
        publicationIds: publications
          .filter((p) => p.sourceRevision === r.revision)
          .map((p) => p.id),
        current: r.revision === current.revision,
      };
    });
  }
  private verifyHeader(h: ReviewHeader) {
    const endpoints = [h.comparison.baseline, h.comparison.target].map((e) =>
      this.resolveEndpoint(endpointSelector(e)),
    );
    for (const [i, e] of [
      h.comparison.baseline,
      h.comparison.target,
    ].entries()) {
      const resolved = { ...endpoints[i].endpoint };
      if (
        h.comparison.diffEngineVersion !== "diff-engine-v3" &&
        !e.symbologyStateVersion
      )
        delete resolved.symbologyStateVersion;
      if (canonicalValue(resolved) !== canonicalValue(e))
        throw Error("Review endpoint no longer matches its immutable source");
    }
    const products = new Set(
      endpoints.flatMap((e) => [
        e.operation.orderId,
        ...e.operation.attachments.map((p) => p.id),
      ]),
    );
    const modules = new Set(
      endpoints.flatMap(
        (e) =>
          e.operation.modules?.instances.map((m) => m.moduleInstanceId) ?? [],
      ),
    );
    const definitions = new Set(
      endpoints.flatMap(
        (e) =>
          e.config.doctrine.modules?.layouts.flatMap((l) =>
            l.definitions.map((d) => d.moduleDefinitionId),
          ) ?? [],
      ),
    );
    const entities = new Set(
      endpoints.flatMap(({ operation: o }) => [
        `operation:${o.id}`,
        `base:${o.orderId}`,
        `signal:${o.signal.id}`,
        ...[
          ["unit", o.units],
          ["task", o.tasks],
          ["objective", o.objectives],
          ["phase", o.phases],
          ["event", o.events],
          ["net", o.signal.nets],
          ["pace", o.signal.pacePlans],
          ["product", o.attachments],
        ].flatMap(([kind, list]) =>
          (list as { id: string }[]).map((e) => `${kind}:${e.id}`),
        ),
        ...(o.modules?.instances.map((m) => `module:${m.moduleInstanceId}`) ??
          []),
      ]),
    );
    for (const c of h.comparison.changes) {
      const fingerprint = reviewHash(
        canonicalValue({
          engine: h.comparison.diffEngineVersion,
          entityType: c.entityType,
          entityId: c.entityId,
          module: c.moduleInstanceId,
          field: c.fieldPath,
          type: c.changeType,
          before: c.beforeValue,
          after: c.afterValue,
        }),
      );
      if (
        c.semanticFingerprint !== fingerprint ||
        c.changeId !== fingerprintId(fingerprint)
      )
        throw Error("Review semantic fingerprint mismatch");
      if (
        !entities.has(`${c.entityType}:${c.entityId}`) ||
        c.canonicalEntityReferences.some((r) => !entities.has(r)) ||
        c.directProductReferences.some((id) => !products.has(id)) ||
        (c.productId && !products.has(c.productId)) ||
        (c.moduleInstanceId && !modules.has(c.moduleInstanceId)) ||
        (c.moduleDefinitionId && !definitions.has(c.moduleDefinitionId))
      )
        throw Error("Review refers to an unresolved source entity");
    }
    for (const i of h.comparison.impacts) {
      if (
        (i.productId && !products.has(i.productId)) ||
        (i.kind === "PRODUCT" && !products.has(i.targetId)) ||
        (i.kind === "MODULE" && !modules.has(i.targetId)) ||
        (i.kind === "EFFECTIVE_OWNER" && !products.has(i.targetId)) ||
        (i.kind === "PREVIEW" &&
          !["timeline", "communications-card"].includes(i.targetId)) ||
        (i.kind === "PUBLICATION_DIVERGENCE" &&
          !this.repo
            .listPublications(h.operationId)
            .some((p) => p.id === i.targetId))
      )
        throw Error("Review refers to an unresolved impact target");
    }
    const graphicIds =
      h.comparison.diffEngineVersion === "diff-engine-v3"
        ? this.repo.listOperationGraphicExportIds(h.operationId)
        : [];
    for (const id of h.comparison.analyzedExportIds)
      if (
        !this.repo.listExports(h.operationId).some((e) => e.id === id) &&
        !graphicIds.includes(id)
      )
        throw Error("Review refers to a missing analyzed export");
    if (h.comparison.diffEngineVersion === "diff-engine-v3") {
      const changes = semanticDiff(
        "diff-engine-v3",
        endpoints[0],
        endpoints[1],
        reviewHash,
      );
      const exports = this.repo
        .listExports(h.operationId)
        .filter((e) => h.comparison.analyzedExportIds.includes(e.id))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (
        canonicalValue(changes) !== canonicalValue(h.comparison.changes) ||
        canonicalValue(
          reviewImpactsV3(
            endpoints[0],
            endpoints[1],
            changes,
            exports,
            reviewHash,
            graphicIds
              .filter((id) => h.comparison.analyzedExportIds.includes(id))
              .map((id) => this.repo.getGraphicExport(id).record),
          ),
        ) !== canonicalValue(h.comparison.impacts)
      )
        throw Error("V3 review does not match its retained semantic inputs");
    }
    if (
      h.comparison.documentPresentation &&
      canonicalValue(h.comparison.documentPresentation) !==
        canonicalValue(documentPresentationImpacts(this.repo, h.comparison))
    )
      throw Error(
        "Document presentation impact differs from its retained sources",
      );
    if (
      h.comparison.planningCards &&
      canonicalValue(h.comparison.planningCards) !==
        canonicalValue(planningCardComparison(this.repo, h.comparison))
    )
      throw Error("Planning card comparison differs from its retained sources");
    if (
      h.comparison.briefings &&
      canonicalValue(h.comparison.briefings) !==
        canonicalValue(briefingComparison(this.repo, h.comparison))
    )
      throw Error("Briefing comparison differs from its sources");
    if (
      h.comparison.planningSchedule &&
      canonicalValue(h.comparison.planningSchedule) !==
        canonicalValue(planningScheduleComparison(this.repo, h.comparison))
    )
      throw Error(
        "Timeline and progress comparison differs from its retained sources",
      );
    for (const id of [h.parentReviewId, h.supersedesReviewId])
      if (
        id &&
        !this.db
          .prepare(
            "SELECT id FROM change_reviews WHERE id=? AND operation_id=? AND sealed=1",
          )
          .get(id, h.operationId)
      )
        throw Error("Related review must belong to this operation");
  }
  insertReview(input: ReviewHeader) {
    const h = reviewHeaderSchema.parse(input);
    this.verifyHeader(h);
    this.db.transaction(() => {
      const { changes, ...comparison } = h.comparison;
      const document = { ...h, comparison };
      this.db
        .prepare(
          "INSERT INTO change_reviews(id,operation_id,baseline_revision_id,target_revision_id,baseline_publication_id,target_publication_id,parent_review_id,supersedes_review_id,document,comparison_hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          h.id,
          h.operationId,
          h.comparison.baseline.revisionId,
          h.comparison.target.revisionId,
          h.comparison.baseline.publicationId,
          h.comparison.target.publicationId,
          h.parentReviewId,
          h.supersedesReviewId,
          JSON.stringify(document),
          reviewHash(canonicalValue(h.comparison)),
        );
      for (const [i, c] of changes.entries())
        this.db
          .prepare("INSERT INTO change_review_changes VALUES(?,?,?,?,?)")
          .run(h.id, c.changeId, c.semanticFingerprint, i, JSON.stringify(c));
      this.db
        .prepare("UPDATE change_reviews SET sealed=1 WHERE id=?")
        .run(h.id);
    })();
  }
  getReview(id: string): ChangeReview {
    const row = this.db
      .prepare("SELECT * FROM change_reviews WHERE id=?")
      .get(id) as any;
    if (!row || row.sealed !== 1) throw Error("Sealed Change Review not found");
    const doc = JSON.parse(row.document);
    const changes = (
      this.db
        .prepare(
          "SELECT * FROM change_review_changes WHERE review_id=? ORDER BY ordinal",
        )
        .all(id) as any[]
    ).map((r, i) => {
      const c = JSON.parse(r.document);
      if (
        r.ordinal !== i ||
        r.id !== c.changeId ||
        r.fingerprint !== c.semanticFingerprint
      )
        throw Error("Review change identity mismatch");
      return c;
    });
    const h = reviewHeaderSchema.parse({
      ...doc,
      comparison: { ...doc.comparison, changes },
    });
    if (
      h.id !== row.id ||
      h.operationId !== row.operation_id ||
      h.comparison.baseline.revisionId !== row.baseline_revision_id ||
      h.comparison.target.revisionId !== row.target_revision_id ||
      h.comparison.baseline.publicationId !== row.baseline_publication_id ||
      h.comparison.target.publicationId !== row.target_publication_id ||
      h.parentReviewId !== row.parent_review_id ||
      h.supersedesReviewId !== row.supersedes_review_id ||
      reviewHash(canonicalValue(h.comparison)) !== row.comparison_hash
    )
      throw Error("Review comparison hash or binding mismatch");
    const events = (
      this.db
        .prepare(
          "SELECT * FROM change_review_events WHERE review_id=? ORDER BY sequence",
        )
        .all(id) as any[]
    ).map((r) => {
      const e = reviewEventSchema.parse(JSON.parse(r.document));
      if (
        e.id !== r.id ||
        e.reviewId !== r.review_id ||
        e.sequence !== r.sequence ||
        ("changeId" in e.action ? e.action.changeId : null) !== r.change_id
      )
        throw Error("Review event identity mismatch");
      return e;
    });
    const result = { ...h, events };
    reviewState(result);
    return result;
  }
  listReviews(operationId: string) {
    return (
      this.db
        .prepare(
          "SELECT id FROM change_reviews WHERE operation_id=? AND sealed=1 ORDER BY rowid DESC",
        )
        .all(operationId) as { id: string }[]
    ).map((r) => this.getReview(r.id));
  }
  appendReviewEvent(input: ReviewEvent, expectedSequence: number) {
    const e = reviewEventSchema.parse(input);
    this.db.transaction(() => {
      const review = this.getReview(e.reviewId);
      if (
        review.events.length !== expectedSequence ||
        e.sequence !== expectedSequence + 1
      )
        throw Error("Review changed. Reload before recording another action.");
      reviewState({ ...review, events: [...review.events, e] });
      if (e.action.type === "SUPERSEDE") {
        const replacement = this.getReview(e.action.replacementReviewId);
        if (
          replacement.operationId !== review.operationId ||
          replacement.supersedesReviewId !== review.id
        )
          throw Error("Replacement review has an invalid supersession link");
      }
      this.db
        .prepare("INSERT INTO change_review_events VALUES(?,?,?,?,?)")
        .run(
          e.id,
          e.reviewId,
          e.sequence,
          "changeId" in e.action ? e.action.changeId : null,
          JSON.stringify(e),
        );
    })();
  }
  verifyAll() {
    for (const r of this.db
      .prepare("SELECT id FROM revision_identities")
      .all() as { id: string }[])
      idSchema.parse(r.id);
    if (
      (
        this.db
          .prepare(
            "SELECT count(*) AS n FROM operation_revisions r LEFT JOIN revision_identities i ON r.operation_id=i.operation_id AND r.revision=i.revision WHERE i.id IS NULL",
          )
          .get() as { n: number }
      ).n
    )
      throw Error("Missing revision identity");
    for (const { id } of this.db
      .prepare("SELECT id FROM change_reviews")
      .all() as { id: string }[]) {
      const review = this.getReview(id);
      this.verifyHeader(review);
      for (const e of review.events)
        if (e.action.type === "SUPERSEDE") {
          const next = this.getReview(e.action.replacementReviewId);
          if (
            next.operationId !== review.operationId ||
            next.supersedesReviewId !== review.id
          )
            throw Error("Broken review supersession");
        }
      comparisonSchema.parse(review.comparison);
    }
    for (const name of [
      "create_revision_identity",
      "review_header_update",
      "review_header_delete",
      "review_change_insert",
      "review_change_identity",
      "review_event_insert",
      "review_endpoint_binding",
      ...[
        "revision_identities",
        "change_review_changes",
        "change_review_events",
      ].flatMap((t) => ["UPDATE", "DELETE"].map((a) => `immutable_${t}_${a}`)),
    ])
      if (
        !this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(name)
      )
        throw Error("Missing review history protection");
  }
}
