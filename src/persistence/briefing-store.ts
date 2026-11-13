import type Database from "better-sqlite3";
import {
  briefingExportSchema,
  verifyBriefing,
  type BriefingExport,
  type BriefingRepository,
  type BriefingStorePort,
} from "../application/briefing-service";
export class BriefingStore implements BriefingStorePort {
  constructor(
    private db: Database.Database,
    private repo: BriefingRepository,
  ) {}
  insert(record: BriefingExport, bytes: Uint8Array) {
    verifyBriefing(this.repo, record, bytes);
    this.db
      .prepare("INSERT INTO briefing_exports VALUES(?,?,?,?,?)")
      .run(
        record.id,
        record.operationId,
        record.sourceRevision,
        JSON.stringify(record),
        bytes,
      );
  }
  get(id: string) {
    const row = this.db
      .prepare("SELECT * FROM briefing_exports WHERE id=?")
      .get(id) as
      | {
          id: string;
          operation_id: string;
          source_revision: number;
          document: string;
          bytes: Buffer;
        }
      | undefined;
    if (!row) throw Error("Briefing PDF not found.");
    const record = briefingExportSchema.parse(JSON.parse(row.document));
    if (
      record.id !== row.id ||
      record.operationId !== row.operation_id ||
      record.sourceRevision !== row.source_revision
    )
      throw Error("Briefing PDF identity mismatch.");
    verifyBriefing(this.repo, record, row.bytes);
    return { record, bytes: row.bytes };
  }
  list(operationId: string, offset = 0) {
    return (
      this.db
        .prepare(
          "SELECT document FROM briefing_exports WHERE operation_id=? ORDER BY rowid DESC LIMIT 31 OFFSET ?",
        )
        .all(operationId, offset) as { document: string }[]
    ).map((r) => briefingExportSchema.parse(JSON.parse(r.document)));
  }
  verifyAll() {
    for (const action of ["UPDATE", "DELETE"])
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(`immutable_briefing_exports_${action}`)
      )
        throw Error("Missing briefing immutability protection.");
    for (const r of this.db
      .prepare("SELECT id FROM briefing_exports")
      .iterate() as Iterable<{ id: string }>)
      this.get(r.id);
  }
}
