import type {
  DoctrineVersion,
  DoctrinePackage,
} from "../domain/doctrine-builder";
import type { ManagedAsset } from "../domain/modules";
export interface ModularRepository {
  listDoctrines(): DoctrineVersion[];
  saveDoctrine(
    value: DoctrineVersion,
    expectedContentVersion: number | null,
  ): void;
  retireDoctrine(id: string, at: string): void;
  listAssets(): ManagedAsset[];
  assetData(id: string): string;
  copyDoctrineAssets(
    source: DoctrineVersion,
    target: DoctrineVersion,
    id: () => string,
    now: string,
  ): void;
  verifyAssetReferences(assets: ManagedAsset[]): void;
  exportDoctrinePackage(id: string): DoctrinePackage;
  importDoctrinePackage(input: unknown): DoctrineVersion;
}
