import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  documentExportSchema,
  type DocumentExport,
} from "../domain/document-exports";
import {
  verifyConfiguredDocument,
  type DocumentRepository,
} from "../application/configured-document-service";
import type { Repository } from "../application/ports";
export class DocumentStore implements DocumentRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly repo: Repository,
  ) {}
  private verify(record: DocumentExport, bytes: Uint8Array) {
    const source = this.repo
      .listExports(record.operationId)
      .find((e) => e.id === record.sourceExportId);
    if (!source) throw Error("PDF source export is unavailable");
    verifyConfiguredDocument(record, bytes, source, (v) =>
      createHash("sha256").update(v).digest("hex"),
    );
  }
  insertDocument(record: DocumentExport, bytes: Uint8Array) {
    this.verify(record, bytes);
    this.db
      .prepare("INSERT INTO document_exports VALUES(?,?,?,?,?)")
      .run(
        record.id,
        record.operationId,
        record.sourceExportId,
        JSON.stringify(record),
        bytes,
      );
  }
  getDocument(id: string) {
    const row = this.db
      .prepare("SELECT * FROM document_exports WHERE id=?")
      .get(id) as
      | {
          id: string;
          operation_id: string;
          source_export_id: string;
          document: string;
          bytes: Buffer;
        }
      | undefined;
    if (!row) throw Error("PDF not found");
    const record = documentExportSchema.parse(JSON.parse(row.document));
    if (
      record.id !== row.id ||
      record.operationId !== row.operation_id ||
      record.sourceExportId !== row.source_export_id
    )
      throw Error("PDF row identity mismatch");
    this.verify(record, row.bytes);
    return { record, bytes: row.bytes };
  }
  listDocuments(operationId: string) {
    return (
      this.db
        .prepare(
          "SELECT document FROM document_exports WHERE operation_id=? ORDER BY rowid DESC",
        )
        .all(operationId) as { document: string }[]
    ).map((r) => documentExportSchema.parse(JSON.parse(r.document)));
  }
  verifyAll() {
    for (const action of ["UPDATE", "DELETE"])
      if (
        !this.db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(`immutable_document_exports_${action}`)
      )
        throw Error("Missing PDF immutability protection");
    for (const row of this.db
      .prepare("SELECT id FROM document_exports")
      .all() as { id: string }[])
      this.getDocument(row.id);
  }
}
