import type Database from "better-sqlite3";
import type { Repository } from "../application/ports";
import {
  alternativeRecordSchema,
  initialAlternative,
  alternativeIdentities,
  type AlternativeRecord,
} from "../domain/alternative-plan";
import type { Operation } from "../domain/model";
import { canonical } from "../export/projection";
import { assertOperation } from "../domain/invariants";
type Row = {
  operation_id: string;
  source_operation_id: string;
  source_revision: number;
  baseline_hash: string;
  document: string;
  content_hash: string;
};
/** Read provenance retained in older workspaces and verify it on restore. */
export class AlternativeStore {
  constructor(
    private db: Database.Database,
    private repo: Repository,
  ) {}
  get(operationId: string): AlternativeRecord | null {
    const row = this.db
      .prepare("SELECT * FROM alternative_plans WHERE operation_id=?")
      .get(operationId) as Row | undefined;
    if (!row) return null;
    const r = alternativeRecordSchema.parse(JSON.parse(row.document));
    if (
      r.operationId !== row.operation_id ||
      r.sourceOperationId !== row.source_operation_id ||
      r.sourceRevision !== row.source_revision ||
      r.baselineHash !== row.baseline_hash ||
      this.repo.hash(canonical(r)) !== row.content_hash ||
      r.baselineHash !==
        this.repo.hash(canonical({ baseline: r.baseline, config: r.config })) ||
      r.baseline.id !== r.sourceOperationId ||
      r.baseline.revision !== r.sourceRevision
    )
      throw Error("Alternative baseline or provenance is inconsistent.");
    return r;
  }
  /** Resolve old copy origins from immutable baselines, without rewriting revisions. */
  cardOrigins(op: Operation, seen = new Set<string>()): Record<string, string> {
    if (seen.has(op.id)) throw Error("Alternative origin cycle.");
    seen.add(op.id);
    const r = this.get(op.id);
    const previous = r ? this.cardOrigins(r.baseline, seen) : {};
    const sourceIds = new Map(
      r?.identities.map((i) => [i.target, i.source]) ?? [],
    );
    return Object.fromEntries(
      (op.planningCards?.definitions ?? []).flatMap((c) => {
        if (c.mode !== "independent") return [];
        const sourceId = sourceIds.get(c.id);
        return [
          [
            c.id,
            c.origin.operationId ??
              (sourceId && r
                ? (r.cardOrigins?.[sourceId] ??
                  previous[sourceId] ??
                  r.sourceOperationId)
                : op.id),
          ],
        ];
      }),
    );
  }
  verifyAll() {
    for (const name of [
      "immutable_alternative_plans_UPDATE",
      "immutable_alternative_plans_DELETE",
    ])
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(name)
      )
        throw Error("Missing alternative baseline protection.");
    for (const row of this.db
      .prepare("SELECT operation_id FROM alternative_plans")
      .iterate() as Iterable<{ operation_id: string }>) {
      const r = this.get(row.operation_id)!;
      assertOperation(r.baseline, r.config);
      if (canonical(r.config) !== canonical(this.repo.getConfig(r.baseline)))
        throw Error(
          "Alternative configuration differs from its pinned baseline.",
        );
      let index = 0;
      const expected = alternativeIdentities(
        r.baseline,
        r.config,
        () => r.identities[index++]?.target ?? "",
      );
      if (
        index !== r.identities.length ||
        canonical([...expected]) !==
          canonical(r.identities.map((i) => [i.source, i.target])) ||
        expected.get(r.sourceOperationId) !== r.operationId ||
        canonical(initialAlternative(r)) !==
          canonical(this.repo.getOperation(r.operationId, 1))
      )
        throw Error(
          "Alternative identity mapping differs from its initial revision.",
        );
    }
  }
}
