import type Database from "better-sqlite3";
import {
  officeExportSchema,
  verifyOffice,
  type OfficeExport,
  type OfficeStorePort,
} from "../application/office-service";
import type { BriefingRepository } from "../application/briefing-service";
export class OfficeStore implements OfficeStorePort {
  constructor(
    private db: Database.Database,
    private repo: BriefingRepository,
  ) {}
  insert(record: OfficeExport, bytes: Uint8Array) {
    verifyOffice(this.repo, record, bytes);
    this.db
      .prepare("INSERT INTO office_exports VALUES(?,?,?,?,?)")
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
      .prepare("SELECT * FROM office_exports WHERE id=?")
      .get(id) as
      | {
          id: string;
          operation_id: string;
          source_revision: number;
          document: string;
          bytes: Buffer;
        }
      | undefined;
    if (!row) throw Error("Office export not found.");
    const record = officeExportSchema.parse(JSON.parse(row.document));
    if (
      record.id !== row.id ||
      record.operationId !== row.operation_id ||
      record.sourceRevision !== row.source_revision
    )
      throw Error("Office export identity mismatch.");
    verifyOffice(this.repo, record, row.bytes);
    return { record, bytes: row.bytes };
  }
  list(operationId: string, offset = 0, format?: OfficeExport["format"]) {
    return (
      this.db
        .prepare(
          "SELECT document FROM office_exports WHERE operation_id=? AND (? IS NULL OR json_extract(document,'$.format')=?) ORDER BY rowid DESC LIMIT 31 OFFSET ?",
        )
        .all(operationId, format ?? null, format ?? null, offset) as {
        document: string;
      }[]
    ).map((r) => officeExportSchema.parse(JSON.parse(r.document)));
  }
  verifyAll() {
    for (const action of ["UPDATE", "DELETE"])
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(`immutable_office_exports_${action}`)
      )
        throw Error("Missing Office export immutability protection.");
    for (const r of this.db
      .prepare("SELECT id FROM office_exports")
      .iterate() as Iterable<{ id: string }>)
      this.get(r.id);
  }
}
