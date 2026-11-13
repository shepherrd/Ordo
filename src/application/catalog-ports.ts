import type { CatalogEntry, CatalogItem, CatalogKind } from "../domain/catalog";

export interface CatalogRepository {
  catalogFind(id: string): CatalogEntry | null;
  catalogGet(id: string): CatalogEntry;
  catalogList(kind: CatalogKind): CatalogEntry[];
  catalogSave(item: CatalogItem, expectedToken: string | null): CatalogEntry;
  catalogDelete(id: string, expectedToken: string): void;
  catalogWasImported(kind: CatalogKind, sourceId: string): boolean;
  catalogMarkImported(
    kind: CatalogKind,
    sourceId: string,
    itemId: string,
    sourceHash: string,
  ): void;
  catalogSnapshot(itemId: string, contentHash: string): string | null;
  catalogSnapshotCount(itemId: string): number;
  catalogRememberSnapshot(
    itemId: string,
    contentHash: string,
    snapshotId: string,
  ): void;
  catalogSnapshotOrigin(snapshotId: string): string | null;
  catalogAssetOwner(itemId: string): string | null;
  catalogRememberAssetOwner(itemId: string, ownerId: string): void;
  catalogOrigin(itemId: string): string | null;
  catalogRememberOrigin(itemId: string, sourceId: string): void;
}
