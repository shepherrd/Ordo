import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { canonical } from "../export/projections/v1";
import {
  catalogItemSchema,
  type CatalogEntry,
  type CatalogItem,
  type CatalogKind,
} from "../domain/catalog";
import type { CatalogRepository } from "../application/catalog-ports";

const hash = (item: CatalogItem) =>
  createHash("sha256").update(canonical(item)).digest("hex");
type Row = {
  id: string;
  kind: CatalogKind;
  document: string;
  edit_token: string;
};
export class CatalogStore implements CatalogRepository {
  constructor(
    private db: Database.Database,
    private onSave?: (item: CatalogItem, token: string) => void,
  ) {}
  private read(row: Row | undefined): CatalogEntry {
    if (!row)
      throw Error("This library item no longer exists. Return to the catalog.");
    const item = catalogItemSchema.parse(JSON.parse(row.document));
    if (
      item.id !== row.id ||
      item.kind !== row.kind ||
      hash(item) !== row.edit_token
    )
      throw Error("Library content failed its integrity check.");
    return { item, editToken: row.edit_token };
  }
  catalogGet(id: string) {
    return this.read(
      this.db.prepare("SELECT * FROM catalog_items WHERE id=?").get(id) as
        Row | undefined,
    );
  }
  catalogFind(id: string) {
    const row = this.db
      .prepare("SELECT * FROM catalog_items WHERE id=?")
      .get(id) as Row | undefined;
    return row ? this.read(row) : null;
  }
  catalogList(kind: CatalogKind) {
    return (
      this.db
        .prepare("SELECT * FROM catalog_items WHERE kind=? ORDER BY rowid")
        .all(kind) as Row[]
    ).map((row) => this.read(row));
  }
  catalogSave(input: CatalogItem, expectedToken: string | null) {
    return this.db.transaction(() => {
      const entry = this.save(input, expectedToken);
      this.onSave?.(entry.item, entry.editToken);
      return entry;
    })();
  }
  private save(input: CatalogItem, expectedToken: string | null) {
    const item = catalogItemSchema.parse(input),
      editToken = hash(item);
    if (expectedToken === null) {
      this.db
        .prepare("INSERT INTO catalog_items VALUES(?,?,?,?)")
        .run(item.id, item.kind, JSON.stringify(item), editToken);
    } else {
      const current = this.catalogGet(item.id);
      if (
        current.item.kind !== item.kind ||
        current.item.createdAt !== item.createdAt
      )
        throw Error("Library identity cannot change when editing.");
      const changed = this.db
        .prepare(
          "UPDATE catalog_items SET document=?,edit_token=? WHERE id=? AND edit_token=?",
        )
        .run(JSON.stringify(item), editToken, item.id, expectedToken);
      if (changed.changes !== 1)
        throw Error("This item changed. Reload it before saving your edits.");
    }
    return { item, editToken };
  }
  catalogDelete(id: string, expectedToken: string) {
    const changed = this.db
      .prepare("DELETE FROM catalog_items WHERE id=? AND edit_token=?")
      .run(id, expectedToken);
    if (changed.changes !== 1)
      throw Error("This item changed. Review it again before deleting.");
  }
  catalogWasImported(kind: CatalogKind, sourceId: string) {
    return !!this.db
      .prepare("SELECT 1 FROM catalog_imports WHERE kind=? AND source_id=?")
      .get(kind, sourceId);
  }
  catalogMarkImported(
    kind: CatalogKind,
    sourceId: string,
    itemId: string,
    sourceHash: string,
  ) {
    this.db
      .prepare("INSERT INTO catalog_imports VALUES(?,?,?,?)")
      .run(kind, sourceId, itemId, sourceHash);
  }
  catalogSnapshot(itemId: string, contentHash: string) {
    return (
      (
        this.db
          .prepare(
            "SELECT snapshot_id FROM catalog_snapshots WHERE item_id=? AND content_hash=?",
          )
          .get(itemId, contentHash) as { snapshot_id: string } | undefined
      )?.snapshot_id ?? null
    );
  }
  catalogSnapshotCount(itemId: string) {
    return (
      this.db
        .prepare("SELECT count(*) AS n FROM catalog_snapshots WHERE item_id=?")
        .get(itemId) as { n: number }
    ).n;
  }
  catalogRememberSnapshot(
    itemId: string,
    contentHash: string,
    snapshotId: string,
  ) {
    this.db
      .prepare("INSERT INTO catalog_snapshots VALUES(?,?,?)")
      .run(itemId, contentHash, snapshotId);
  }
  catalogSnapshotOrigin(snapshotId: string) {
    return (
      (
        this.db
          .prepare("SELECT item_id FROM catalog_snapshots WHERE snapshot_id=?")
          .get(snapshotId) as { item_id: string } | undefined
      )?.item_id ?? null
    );
  }
  catalogAssetOwner(itemId: string) {
    return (
      (
        this.db
          .prepare("SELECT owner_id FROM catalog_asset_owners WHERE item_id=?")
          .get(itemId) as { owner_id: string } | undefined
      )?.owner_id ?? null
    );
  }
  catalogRememberAssetOwner(itemId: string, ownerId: string) {
    this.db
      .prepare("INSERT INTO catalog_asset_owners VALUES(?,?)")
      .run(itemId, ownerId);
  }
  catalogOrigin(itemId: string) {
    return (
      (
        this.db
          .prepare("SELECT source_id FROM catalog_origins WHERE item_id=?")
          .get(itemId) as { source_id: string } | undefined
      )?.source_id ?? null
    );
  }
  catalogRememberOrigin(itemId: string, sourceId: string) {
    this.db
      .prepare("INSERT INTO catalog_origins VALUES(?,?)")
      .run(itemId, sourceId);
  }
  verifyAll() {
    for (const table of [
      "catalog_imports",
      "catalog_snapshots",
      "catalog_asset_owners",
      "catalog_origins",
    ])
      for (const action of ["UPDATE", "DELETE"]) {
        const sql = (
          this.db
            .prepare("SELECT sql FROM sqlite_master WHERE name=?")
            .get(`protect_${table}_${action}`) as { sql: string } | undefined
        )?.sql;
        if (
          sql !==
          `CREATE TRIGGER protect_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'Retained catalog evidence is immutable'); END`
        )
          throw Error("Missing or altered catalog evidence protection");
      }
    for (const row of this.db
      .prepare("SELECT * FROM catalog_items")
      .all() as Row[])
      this.read(row);
  }
}
