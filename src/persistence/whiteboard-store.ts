import type Database from "better-sqlite3";
import {
  whiteboardSnapshotSchema,
  verifyWhiteboard,
  type WhiteboardSnapshot,
  type WhiteboardRepository,
  type WhiteboardStorePort,
} from "../application/whiteboard-service";
import type { ModularStore } from "./modular-store";
import type { ManagedAsset } from "../domain/modules";
export class WhiteboardStore implements WhiteboardStorePort {
  constructor(
    private db: Database.Database,
    private repo: WhiteboardRepository,
    private assets: ModularStore,
  ) {}
  insert(record: WhiteboardSnapshot, bytes: Uint8Array) {
    verifyWhiteboard(this.repo, record, bytes);
    this.db
      .prepare("INSERT INTO whiteboard_snapshots VALUES(?,?,?,?,?)")
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
      .prepare("SELECT * FROM whiteboard_snapshots WHERE id=?")
      .get(id) as
      | {
          id: string;
          operation_id: string;
          source_revision: number;
          document: string;
          bytes: Buffer;
        }
      | undefined;
    if (!row) throw Error("Whiteboard snapshot not found");
    const record = whiteboardSnapshotSchema.parse(JSON.parse(row.document));
    if (
      record.id !== row.id ||
      record.operationId !== row.operation_id ||
      record.sourceRevision !== row.source_revision
    )
      throw Error("Whiteboard snapshot identity mismatch");
    verifyWhiteboard(this.repo, record, row.bytes);
    return { record, bytes: row.bytes };
  }
  list(operationId: string, offset = 0) {
    return (
      this.db
        .prepare(
          "SELECT document FROM whiteboard_snapshots WHERE operation_id=? ORDER BY rowid DESC LIMIT 31 OFFSET ?",
        )
        .all(operationId, offset) as { document: string }[]
    ).map((r) => whiteboardSnapshotSchema.parse(JSON.parse(r.document)));
  }
  image(id: string, asset: ManagedAsset) {
    const { record, bytes } = this.get(id);
    if (
      asset.operationId !== record.operationId ||
      asset.sha256 !== record.pngHash ||
      asset.mimeType !== "image/png" ||
      asset.sizeBytes !== bytes.byteLength
    )
      throw Error("Snapshot image provenance mismatch");
    this.db.transaction(() => {
      this.assets.insertAsset(asset, bytes);
      this.db
        .prepare("INSERT INTO whiteboard_snapshot_assets VALUES(?,?)")
        .run(asset.assetId, id);
    })();
  }
  verifyAll() {
    for (const table of ["whiteboard_snapshots", "whiteboard_snapshot_assets"])
      for (const action of ["UPDATE", "DELETE"])
        if (
          !this.db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
            )
            .get(`immutable_${table}_${action}`)
        )
          throw Error("Missing whiteboard immutability protection");
    const snapshots = new Map<string, WhiteboardSnapshot>();
    for (const row of this.db
      .prepare("SELECT id FROM whiteboard_snapshots")
      .iterate() as Iterable<{ id: string }>)
      snapshots.set(row.id, this.get(row.id).record);
    for (const row of this.db
      .prepare("SELECT * FROM whiteboard_snapshot_assets")
      .iterate() as Iterable<{ asset_id: string; snapshot_id: string }>) {
      const record = snapshots.get(row.snapshot_id),
        asset = this.assets.readAsset(row.asset_id).metadata;
      if (
        !record ||
        asset.sha256 !== record.pngHash ||
        asset.operationId !== record.operationId ||
        asset.mimeType !== "image/png"
      )
        throw Error("Snapshot image origin mismatch");
    }
  }
}
