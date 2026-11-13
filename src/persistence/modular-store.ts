import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  doctrineVersionSchema,
  doctrinePackageSchema,
  type DoctrineVersion,
  type DoctrinePackage,
} from "../domain/doctrine-builder";
import {
  assetSchema,
  type ManagedAsset,
  type RichNode,
} from "../domain/modules";
import { canonical } from "../export/projections/v1";
import type { ResolvedConfig } from "../domain/model";

export const hashBytes = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function validateAssetBytes(
  metadata: ManagedAsset,
  bytes: Buffer,
): void {
  assetSchema.parse(metadata);
  if (
    bytes.length !== metadata.sizeBytes ||
    hashBytes(bytes) !== metadata.sha256
  )
    throw Error("Asset size or SHA-256 mismatch");
  if (
    /\.(exe|dll|com|bat|cmd|ps1|js|mjs|cjs|html?|svg|vbs|msi|scr|lnk|url)$/i.test(
      metadata.originalFilename,
    ) ||
    bytes.subarray(0, 2).toString() === "MZ" ||
    bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  )
    throw Error(
      "Executable or active content is not an accepted managed asset",
    );
  const signatures: Record<string, (b: Buffer) => boolean> = {
    "image/png": (b) =>
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/jpeg": (b) => b[0] === 255 && b[1] === 216 && b[2] === 255,
    "image/gif": (b) => /^GIF8[79]a/.test(b.subarray(0, 6).toString()),
    "image/webp": (b) =>
      b.subarray(0, 4).toString() === "RIFF" &&
      b.subarray(8, 12).toString() === "WEBP",
    "application/pdf": (b) => b.subarray(0, 5).toString() === "%PDF-",
  };
  if (signatures[metadata.mimeType] && !signatures[metadata.mimeType](bytes))
    throw Error("Asset contents do not match its MIME type");
}
export class ModularStore {
  constructor(
    private db: Database.Database,
    private seed: (config: ResolvedConfig) => void,
    private onAsset?: (asset: ManagedAsset) => void,
  ) {}
  listDoctrines(): DoctrineVersion[] {
    return (
      this.db
        .prepare(
          "SELECT v.document,r.retired_at FROM doctrine_versions v LEFT JOIN doctrine_retirements r ON r.version_id=v.id ORDER BY v.rowid",
        )
        .all() as { document: string; retired_at: string | null }[]
    ).map((row) => {
      const v = doctrineVersionSchema.parse(JSON.parse(row.document));
      return row.retired_at
        ? { ...v, status: "RETIRED", retiredAt: row.retired_at }
        : v;
    });
  }
  saveDoctrine(input: DoctrineVersion, expected: number | null): void {
    const v = doctrineVersionSchema.parse(input);
    if (
      this.listDoctrines().some(
        (other) =>
          other.doctrineFamilyId === v.doctrineFamilyId &&
          other.stableKey !== v.stableKey,
      )
    )
      throw Error(
        "Doctrine family stable identity cannot change between versions",
      );
    if (v.status === "RETIRED")
      throw Error("Use retirement without modifying published content");
    const row = this.db
      .prepare("SELECT document FROM doctrine_versions WHERE id=?")
      .get(v.doctrineVersionId) as { document: string } | undefined;
    if (row) {
      const old = doctrineVersionSchema.parse(JSON.parse(row.document));
      if (old.status !== "DRAFT" || old.sourceKind === "BUNDLED")
        throw Error(
          "Published or bundled doctrine is immutable; create a new version",
        );
      if (
        expected !== old.contentVersion ||
        v.contentVersion !== old.contentVersion + 1
      )
        throw Error("Doctrine draft changed; reload before saving");
      if (
        v.doctrineFamilyId !== old.doctrineFamilyId ||
        v.stableKey !== old.stableKey ||
        v.createdAt !== old.createdAt ||
        v.config.doctrine.version !== old.config.doctrine.version ||
        v.sourceKind !== old.sourceKind ||
        v.parentVersionId !== old.parentVersionId ||
        v.duplicatedFromVersionId !== old.duplicatedFromVersionId
      )
        throw Error("Doctrine identity and ancestry cannot change");
    } else if (expected !== null) throw Error("Doctrine version not found");
    if (v.status === "PUBLISHED")
      this.verifyAssetReferences(v.config.doctrine.modules?.assets ?? []);
    const args = [
      v.doctrineFamilyId,
      v.config.doctrine.version,
      v.contentVersion,
      v.status,
      JSON.stringify(v),
      v.doctrineVersionId,
    ];
    if (row)
      this.db
        .prepare(
          "UPDATE doctrine_versions SET family_id=?,profile_version=?,content_version=?,status=?,document=? WHERE id=?",
        )
        .run(...args);
    else
      this.db
        .prepare(
          "INSERT INTO doctrine_versions(family_id,profile_version,content_version,status,document,id) VALUES(?,?,?,?,?,?)",
        )
        .run(...args);
    if (v.status === "PUBLISHED") this.seed(v.config);
  }
  retireDoctrine(id: string, at: string): void {
    const v = this.listDoctrines().find((v) => v.doctrineVersionId === id);
    if (!v || v.status !== "PUBLISHED" || v.sourceKind === "BUNDLED")
      throw Error("Only published custom doctrine can be retired");
    this.db.prepare("INSERT INTO doctrine_retirements VALUES(?,?)").run(id, at);
  }
  listAssets(): ManagedAsset[] {
    return (
      this.db.prepare("SELECT document FROM managed_assets").all() as {
        document: string;
      }[]
    ).map((r) => assetSchema.parse(JSON.parse(r.document)));
  }
  readAsset(id: string): { metadata: ManagedAsset; bytes: Buffer } {
    const row = this.db
      .prepare(
        "SELECT id,operation_id,doctrine_version_id,unit_profile_version_id,document,bytes FROM managed_assets WHERE id=?",
      )
      .get(id) as
      | {
          id: string;
          operation_id: string | null;
          doctrine_version_id: string | null;
          unit_profile_version_id: string | null;
          document: string;
          bytes: Buffer;
        }
      | undefined;
    if (!row) throw Error(`Missing managed asset ${id}`);
    const metadata = assetSchema.parse(JSON.parse(row.document));
    if (
      metadata.assetId !== row.id ||
      metadata.operationId !== row.operation_id ||
      metadata.doctrineVersionId !== row.doctrine_version_id ||
      (metadata.unitProfileVersionId ?? null) !== row.unit_profile_version_id
    )
      throw Error("Managed asset storage binding differs from its metadata");
    validateAssetBytes(metadata, row.bytes);
    return { metadata, bytes: row.bytes };
  }
  insertAsset(metadata: ManagedAsset, bytes: Buffer): void {
    this.db.transaction(() => {
      this.writeAsset(metadata, bytes);
      this.onAsset?.(metadata);
    })();
  }
  private writeAsset(metadata: ManagedAsset, bytes: Buffer): void {
    validateAssetBytes(metadata, bytes);
    this.db
      .prepare(
        "INSERT INTO managed_assets(id,operation_id,doctrine_version_id,document,bytes,unit_profile_version_id) VALUES(?,?,?,?,?,?)",
      )
      .run(
        metadata.assetId,
        metadata.operationId,
        metadata.doctrineVersionId,
        JSON.stringify(metadata),
        bytes,
        metadata.unitProfileVersionId ?? null,
      );
  }
  assetData(id: string): string {
    const { metadata, bytes } = this.readAsset(id);
    if (!metadata.mimeType.startsWith("image/"))
      throw Error("Only raster images can be previewed inline");
    return `data:${metadata.mimeType};base64,${bytes.toString("base64")}`;
  }
  verifyAssetReferences(assets: ManagedAsset[]): void {
    if (new Set(assets.map((a) => a.assetId)).size !== assets.length)
      throw Error("Duplicate asset identities");
    for (const a of assets)
      if (canonical(this.readAsset(a.assetId).metadata) !== canonical(a))
        throw Error("Asset metadata does not match managed storage");
  }
  copyDoctrineAssets(
    source: DoctrineVersion,
    target: DoctrineVersion,
    id: () => string,
    now: string,
  ): void {
    const map = new Map<string, string>();
    for (const a of source.config.doctrine.modules?.assets ?? []) {
      const nextId = id(),
        next = {
          ...a,
          assetId: nextId,
          doctrineVersionId: target.doctrineVersionId,
          createdAt: now,
          storageReference: `asset:${nextId}`,
        };
      this.insertAsset(next, this.readAsset(a.assetId).bytes);
      target.config.doctrine.modules!.assets.push(next);
      map.set(a.assetId, nextId);
    }
    const remapRich = (node: RichNode) => {
      if (node.attrs?.assetId)
        node.attrs.assetId = map.get(node.attrs.assetId) ?? node.attrs.assetId;
      node.content?.forEach(remapRich);
    };
    for (const l of target.config.doctrine.modules?.layouts ?? [])
      for (const d of l.definitions) {
        if (d.configuration.defaultAssetIds)
          d.configuration.defaultAssetIds = d.configuration.defaultAssetIds.map(
            (a) => map.get(a) ?? a,
          );
        for (const field of [
          ...(d.configuration.fields ?? []),
          ...(d.configuration.columns ?? []),
        ])
          if (
            field.defaultValue &&
            typeof field.defaultValue === "object" &&
            !Array.isArray(field.defaultValue)
          )
            remapRich(field.defaultValue);
      }
  }
  exportDoctrinePackage(id: string): DoctrinePackage {
    const doctrine = this.listDoctrines().find(
      (v) => v.doctrineVersionId === id,
    );
    if (!doctrine) throw Error("Unknown doctrine version");
    const assets = (doctrine.config.doctrine.modules?.assets ?? []).map(
      (metadata) => ({
        metadata,
        base64: this.readAsset(metadata.assetId).bytes.toString("base64"),
      }),
    );
    const pkg = {
      format: "ordo-doctrine" as const,
      schemaVersion: 1 as const,
      doctrine,
      assets,
      contentHash: hashBytes(canonical({ doctrine, assets })),
    };
    if (JSON.stringify(pkg).length > 64 * 1024 * 1024)
      throw Error("Doctrine package exceeds 64 MiB limit");
    return doctrinePackageSchema.parse(pkg);
  }
  importDoctrinePackage(input: unknown): DoctrineVersion {
    if (JSON.stringify(input).length > 64 * 1024 * 1024)
      throw Error("Doctrine package exceeds 64 MiB limit");
    const pkg = doctrinePackageSchema.parse(input),
      { doctrine, assets } = pkg;
    if (pkg.contentHash !== hashBytes(canonical({ doctrine, assets })))
      throw Error("Doctrine package hash mismatch");
    const declared = doctrine.config.doctrine.modules?.assets ?? [];
    if (
      assets.length !== declared.length ||
      new Set(assets.map((a) => a.metadata.assetId)).size !== assets.length
    )
      throw Error("Doctrine asset manifest mismatch");
    for (const asset of assets) {
      if (
        asset.metadata.operationId ||
        asset.metadata.doctrineVersionId !== doctrine.doctrineVersionId ||
        !declared.some((a) => canonical(a) === canonical(asset.metadata))
      )
        throw Error("Package contains assets outside this doctrine");
      validateAssetBytes(asset.metadata, Buffer.from(asset.base64, "base64"));
    }
    const installed = this.listDoctrines().find(
      (v) =>
        v.doctrineVersionId === doctrine.doctrineVersionId ||
        (v.doctrineFamilyId === doctrine.doctrineFamilyId &&
          v.config.doctrine.version === doctrine.config.doctrine.version),
    );
    if (installed) {
      const normalized = { ...doctrine, sourceKind: installed.sourceKind };
      if (canonical(normalized) === canonical(installed)) {
        this.verifyAssetReferences(declared);
        return installed;
      }
      throw Error(
        "Doctrine identity collision: content differs. Duplicate into a new family before importing",
      );
    }
    const imported = { ...doctrine, sourceKind: "IMPORTED" as const };
    this.db.transaction(() => {
      const draft = {
        ...imported,
        status: "DRAFT" as const,
        publishedAt: null,
        retiredAt: null,
      };
      this.saveDoctrine(draft, null);
      for (const a of assets)
        this.insertAsset(a.metadata, Buffer.from(a.base64, "base64"));
      if (imported.status !== "DRAFT") {
        // Import is an atomic installation of an already versioned record, not a draft edit.
        this.db
          .prepare(
            "UPDATE doctrine_versions SET status='PUBLISHED',document=? WHERE id=?",
          )
          .run(
            JSON.stringify({
              ...imported,
              status: "PUBLISHED",
              retiredAt: null,
            }),
            imported.doctrineVersionId,
          );
        this.seed(imported.config);
        if (imported.status === "RETIRED")
          this.db
            .prepare("INSERT INTO doctrine_retirements VALUES(?,?)")
            .run(imported.doctrineVersionId, imported.retiredAt);
      }
    })();
    return imported;
  }
  verifyAll(): void {
    for (const row of this.db
      .prepare(
        "SELECT id,family_id,profile_version,content_version,status,document FROM doctrine_versions",
      )
      .all() as {
      id: string;
      family_id: string;
      profile_version: number;
      content_version: number;
      status: string;
      document: string;
    }[]) {
      const v = doctrineVersionSchema.parse(JSON.parse(row.document));
      if (
        v.doctrineVersionId !== row.id ||
        v.doctrineFamilyId !== row.family_id ||
        v.config.doctrine.version !== row.profile_version ||
        v.contentVersion !== row.content_version ||
        v.status !== row.status
      )
        throw Error("Doctrine lifecycle row identity mismatch");
      this.verifyAssetReferences(v.config.doctrine.modules?.assets ?? []);
      if (v.status === "PUBLISHED") {
        const stored = this.db
          .prepare(
            "SELECT document FROM profile_versions WHERE kind='doctrine' AND id=? AND version=?",
          )
          .get(v.doctrineFamilyId, v.config.doctrine.version) as
          { document: string } | undefined;
        if (
          !stored ||
          canonical(JSON.parse(stored.document)) !==
            canonical(v.config.doctrine)
        )
          throw Error("Published doctrine differs from frozen profile");
      }
    }
    for (const asset of this.listAssets()) this.readAsset(asset.assetId);
    for (const name of [
      "frozen_doctrine_update",
      "frozen_doctrine_delete",
      "doctrine_identity_update",
      "doctrine_asset_insert",
    ])
      if (
        !this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(name)
      )
        throw Error("Missing doctrine lifecycle protection");
  }
}
