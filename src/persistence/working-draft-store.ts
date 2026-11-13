import type Database from "better-sqlite3";
import {
  workingDraftSchema,
  validateWorkingDraft,
  type DraftKey,
  type WorkingDraft,
  type WorkingDraftRepository,
} from "../application/working-drafts";
export class WorkingDraftStore implements WorkingDraftRepository {
  constructor(private readonly db: Database.Database) {}
  listWorkingDrafts() {
    return (
      this.db
        .prepare("SELECT document FROM working_drafts ORDER BY kind,source_id")
        .all() as { document: string }[]
    ).map((r) => workingDraftSchema.parse(JSON.parse(r.document)));
  }
  getWorkingDraft(key: DraftKey) {
    const row = this.db
      .prepare(
        "SELECT document FROM working_drafts WHERE kind=? AND source_id=?",
      )
      .get(key.kind, key.id) as { document: string } | undefined;
    return row ? workingDraftSchema.parse(JSON.parse(row.document)) : null;
  }
  putWorkingDraft(draft: WorkingDraft, expected: number) {
    return this.db.transaction(() => {
      const old = this.getWorkingDraft(draft);
      if ((old?.sequence ?? 0) !== expected)
        throw Error(
          "Another editor updated this working copy. Reopen it before replacing recovery data.",
        );
      if (!old && this.listWorkingDrafts().length >= 200)
        throw Error(
          "Recovery storage is full. Review and discard older working copies.",
        );
      const usage = this.db
        .prepare(
          "SELECT coalesce(sum(length(CAST(document AS BLOB))),0) AS bytes FROM working_drafts WHERE NOT(kind=? AND source_id=?)",
        )
        .get(draft.kind, draft.id) as { bytes: number };
      if (
        usage.bytes + Buffer.byteLength(JSON.stringify(draft)) >
        64 * 1024 * 1024
      )
        throw Error(
          "Recovery storage exceeds 64 MiB. Review and discard older working copies.",
        );
      const clock = this.db
        .prepare(
          "UPDATE working_draft_clock SET sequence=sequence+1 WHERE id=1 RETURNING sequence",
        )
        .get() as { sequence: number };
      const stored = { ...draft, sequence: clock.sequence };
      this.db
        .prepare(
          "INSERT INTO working_drafts VALUES(?,?,?) ON CONFLICT(kind,source_id) DO UPDATE SET document=excluded.document",
        )
        .run(stored.kind, stored.id, JSON.stringify(stored));
      return stored;
    })();
  }
  removeWorkingDraft(key: DraftKey, expected: number) {
    const old = this.getWorkingDraft(key);
    if (!old) return;
    if (old.sequence !== expected)
      throw Error(
        "The recovery copy changed. Review it again before discarding.",
      );
    this.db
      .prepare("DELETE FROM working_drafts WHERE kind=? AND source_id=?")
      .run(key.kind, key.id);
  }
  verifyAll() {
    const clock = this.db
      .prepare("SELECT sequence FROM working_draft_clock WHERE id=1")
      .get() as { sequence: number } | undefined;
    if (!clock || !Number.isSafeInteger(clock.sequence) || clock.sequence < 0)
      throw Error("Invalid recovery generation counter");
    for (const row of this.db
      .prepare("SELECT kind,source_id,document FROM working_drafts")
      .all() as { kind: string; source_id: string; document: string }[]) {
      const d = workingDraftSchema.parse(JSON.parse(row.document));
      if (d.sequence > clock.sequence)
        throw Error("Working-copy generation exceeds its recovery counter");
      if (d.kind !== row.kind || d.id !== row.source_id)
        throw Error("Working-copy identity mismatch");
      validateWorkingDraft(d);
    }
  }
}
