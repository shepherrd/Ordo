import type Database from "better-sqlite3";
import {
  unitProfileSchema,
  assertStandingHierarchy,
  bindOrganization,
  assertOrganizationState,
  type UnitProfile,
  profileSymbol,
} from "../domain/unit-profiles";
import type { Operation } from "../domain/model";
import type { Repository } from "../application/ports";
import type {
  BrowseQuery,
  UnitProfileSummary,
  GlobalOperationSummary,
  DoctrineSummary,
} from "../application/workspace-ports";
import { canonical } from "../export/projection";
import { hashBytes, type ModularStore } from "./modular-store";
type Row = {
  id: string;
  family_id: string;
  content_version: number;
  status: string;
  document: string;
  content_hash: string;
  retired_at: string | null;
};
export class UnitProfileStore {
  constructor(
    private db: Database.Database,
    private repo: Repository,
    private assets: ModularStore,
  ) {}
  get(id: string): UnitProfile {
    const row = this.db
      .prepare(
        "SELECT v.*,r.retired_at FROM unit_profile_versions v LEFT JOIN unit_profile_retirements r ON r.version_id=v.id WHERE v.id=?",
      )
      .get(id) as Row | undefined;
    if (!row) throw Error("Unit Profile version not found");
    const v = unitProfileSchema.parse(JSON.parse(row.document));
    if (
      v.unitProfileVersionId !== row.id ||
      v.unitProfileFamilyId !== row.family_id ||
      v.status !== row.status ||
      v.contentVersion !== row.content_version ||
      hashBytes(canonical(v)) !== row.content_hash
    )
      throw Error("Unit Profile identity/content hash mismatch");
    return row.retired_at
      ? unitProfileSchema.parse({
          ...v,
          status: "RETIRED",
          retiredAt: row.retired_at,
        })
      : v;
  }
  hash(id: string): string {
    this.get(id);
    return (
      this.db
        .prepare("SELECT content_hash FROM unit_profile_versions WHERE id=?")
        .get(id) as { content_hash: string }
    ).content_hash;
  }
  save(input: UnitProfile, expected: number | null): void {
    const v = unitProfileSchema.parse(input);
    if (v.status === "RETIRED")
      throw Error("Use retirement without modifying published content");
    const exists = this.db
      .prepare("SELECT id FROM unit_profile_versions WHERE id=?")
      .get(v.unitProfileVersionId);
    const old = exists ? this.get(v.unitProfileVersionId) : null;
    if (old) {
      if (old.status !== "DRAFT")
        throw Error(
          "Published Unit Profile is immutable; create a new Draft version",
        );
      if (
        expected !== old.contentVersion ||
        v.contentVersion !== old.contentVersion + 1
      )
        throw Error("Unit Profile draft changed; reload before saving");
      for (const field of [
        "unitProfileFamilyId",
        "createdAt",
        "parentVersionId",
        "duplicatedFrom",
        "sourceKind",
      ] as const)
        if (canonical(v[field]) !== canonical(old[field]))
          throw Error("Unit Profile identity and ancestry are immutable");
    } else if (
      expected !== null ||
      v.status !== "DRAFT" ||
      v.contentVersion !== 1
    )
      throw Error("Create a new Draft first");
    const previous =
      old ??
      (v.parentVersionId
        ? this.get(v.parentVersionId)
        : v.duplicatedFrom
          ? this.get(v.duplicatedFrom.unitProfileVersionId)
          : null);
    const symbol = profileSymbol(v);
    if (symbol)
      this.repo.verifySymbolPin(
        symbol,
        !!previous && canonical(profileSymbol(previous)) === canonical(symbol),
      );
    // Retired dependencies remain valid when already pinned. A new selection
    // must be published; transitive dependencies belong to their frozen parent.
    for (const r of v.standingSubordinates) {
      if (
        this.get(r.unitProfileVersionId).status === "RETIRED" &&
        !previous?.standingSubordinates.some(
          (p) =>
            p.unitProfileFamilyId === r.unitProfileFamilyId &&
            p.unitProfileVersionId === r.unitProfileVersionId,
        )
      )
        throw Error("Select an exact published subordinate version");
    }
    assertStandingHierarchy(v, (id) => this.get(id), true);
    for (const mapping of v.roleMappings) {
      const d = this.repo
        .listDoctrines()
        .find(
          (d) =>
            d.doctrineFamilyId === mapping.doctrineFamilyId &&
            d.config.doctrine.version === mapping.doctrineVersion,
        );
      if (
        !d ||
        d.status !== "PUBLISHED" ||
        !d.config.doctrine.staff.some((s) => s.id === mapping.staffId)
      )
        throw Error(
          "Role mapping must reference a staff ID in an exact published doctrine version",
        );
    }
    if (v.defaultDoctrine) {
      const d = this.repo
        .listDoctrines()
        .find(
          (d) => d.doctrineVersionId === v.defaultDoctrine!.doctrineVersionId,
        );
      if (
        !d ||
        d.status !== "PUBLISHED" ||
        d.doctrineFamilyId !== v.defaultDoctrine.doctrineFamilyId ||
        d.config.doctrine.version !== v.defaultDoctrine.profileVersion ||
        canonical(v.defaultDoctrine.configuration) !==
          canonical({
            id: d.config.organization.id,
            version: d.config.organization.version,
          })
      )
        throw Error(
          "Default doctrine must identify an exact published version",
        );
    }
    if (v.parentVersionId) {
      const parent = this.get(v.parentVersionId);
      if (
        parent.unitProfileFamilyId !== v.unitProfileFamilyId ||
        parent.status === "DRAFT"
      )
        throw Error("Invalid Unit Profile parent version");
    }
    if (v.duplicatedFrom) {
      const source = this.get(v.duplicatedFrom.unitProfileVersionId);
      if (
        source.unitProfileFamilyId !== v.duplicatedFrom.unitProfileFamilyId ||
        source.unitProfileFamilyId === v.unitProfileFamilyId
      )
        throw Error("Invalid duplication provenance");
    }
    if (v.insigniaAssetId) {
      const a = this.assets.readAsset(v.insigniaAssetId).metadata;
      if (
        a.unitProfileVersionId !== v.unitProfileVersionId ||
        !a.mimeType.startsWith("image/")
      )
        throw Error(
          "Insignia must be a managed image owned by this profile version",
        );
    }
    this.db.transaction(() => {
      if (!old) {
        this.db
          .prepare("INSERT OR IGNORE INTO unit_profile_families VALUES(?,?)")
          .run(v.unitProfileFamilyId, v.createdAt);
        this.db
          .prepare("INSERT INTO unit_profile_versions VALUES(?,?,?,?,?,?)")
          .run(
            v.unitProfileVersionId,
            v.unitProfileFamilyId,
            v.contentVersion,
            v.status,
            JSON.stringify(v),
            hashBytes(canonical(v)),
          );
      }
      // Relationship index is replaced while the source version is still a Draft.
      this.db
        .prepare(
          "DELETE FROM unit_profile_relationships WHERE parent_version_id=?",
        )
        .run(v.unitProfileVersionId);
      for (const [i, r] of v.standingSubordinates.entries())
        this.db
          .prepare("INSERT INTO unit_profile_relationships VALUES(?,?,?,?,?)")
          .run(
            v.unitProfileVersionId,
            r.relationshipId,
            i,
            r.unitProfileFamilyId,
            r.unitProfileVersionId,
          );
      const symbol = profileSymbol(v);
      this.db
        .prepare(
          "DELETE FROM unit_profile_symbol_pins WHERE owner_version_id=?",
        )
        .run(v.unitProfileVersionId);
      if (symbol)
        this.db
          .prepare("INSERT INTO unit_profile_symbol_pins VALUES(?,?,?,?,?)")
          .run(
            v.unitProfileVersionId,
            symbol.familyId,
            symbol.versionId,
            symbol.contentHash,
            symbol.definitionHash,
          );
      if (old)
        this.db
          .prepare(
            "UPDATE unit_profile_versions SET content_version=?,status=?,document=?,content_hash=? WHERE id=?",
          )
          .run(
            v.contentVersion,
            v.status,
            JSON.stringify(v),
            hashBytes(canonical(v)),
            v.unitProfileVersionId,
          );
    })();
  }
  retire(id: string, at: string) {
    if (this.get(id).status !== "PUBLISHED")
      throw Error("Only a published Unit Profile can be retired");
    this.db
      .prepare("INSERT INTO unit_profile_retirements VALUES(?,?)")
      .run(id, at);
  }
  copyAsset(
    source: UnitProfile,
    target: UnitProfile,
    id: () => string,
    now: string,
  ) {
    if (!source.insigniaAssetId) return;
    const a = this.assets.readAsset(source.insigniaAssetId),
      nextId = id();
    this.assets.insertAsset(
      {
        ...a.metadata,
        assetId: nextId,
        unitProfileVersionId: target.unitProfileVersionId,
        createdAt: now,
        storageReference: `asset:${nextId}`,
      },
      a.bytes,
    );
    target.insigniaAssetId = nextId;
  }
  verifyOperation(op: Operation) {
    assertOrganizationState(op);
    if (op.operationOrganizationBinding) {
      const b = op.operationOrganizationBinding,
        v = this.get(b.unitProfileVersionId);
      if (
        v.status === "DRAFT" ||
        canonical(
          bindOrganization(
            v,
            this.repo.getConfig(op),
            this.hash(v.unitProfileVersionId),
          ),
        ) !== canonical(b)
      )
        throw Error(
          "Operation organization snapshot differs from its exact published source",
        );
    }
    for (const u of op.units)
      if (u.sourceUnitProfile) {
        const p = u.sourceUnitProfile,
          v = this.get(p.sourceUnitProfileVersionId);
        if (
          v.status === "DRAFT" ||
          v.unitProfileFamilyId !== p.sourceUnitProfileFamilyId ||
          this.hash(v.unitProfileVersionId) !== p.sourceContentHash
        )
          throw Error("Operation unit profile provenance is invalid");
      }
  }
  browse(q: BrowseQuery) {
    const where =
      " WHERE (json_extract(v.document,'$.identity.fullDesignation') LIKE ? OR json_extract(v.document,'$.identity.shortDesignation') LIKE ?) AND (?='' OR COALESCE(CASE WHEN r.version_id IS NOT NULL THEN 'RETIRED' END,v.status)=?) AND (?='' OR json_extract(v.document,'$.identity.echelon')=?)";
    const args = [
      `%${q.search}%`,
      `%${q.search}%`,
      q.status,
      q.status,
      q.echelon,
      q.echelon,
    ];
    const from =
      " FROM unit_profile_versions v LEFT JOIN unit_profile_retirements r ON r.version_id=v.id";
    const items = this.db
      .prepare(
        `SELECT v.id AS unitProfileVersionId,v.family_id AS unitProfileFamilyId,json_extract(v.document,'$.identity.fullDesignation') AS name,json_extract(v.document,'$.identity.shortDesignation') AS shortDesignation,json_extract(v.document,'$.identity.echelon') AS echelon,json_extract(v.document,'$.identity.unitType') AS unitType,json_extract(v.document,'$.versionLabel') AS versionLabel,COALESCE(CASE WHEN r.version_id IS NOT NULL THEN 'RETIRED' END,v.status) AS status,json_extract(v.document,'$.updatedAt') AS updatedAt,COALESCE((SELECT group_concat(json_extract(p.document,'$.identity.shortDesignation'),', ') FROM unit_profile_relationships x JOIN unit_profile_versions p ON p.id=x.parent_version_id WHERE x.child_version_id=v.id),'') AS parentNames,(SELECT json_extract(d.document,'$.displayName') FROM doctrine_versions d WHERE d.id=json_extract(v.document,'$.defaultDoctrine.doctrineVersionId')) AS defaultDoctrineName${from}${where} ORDER BY ${q.sort === "name" ? "name COLLATE NOCASE" : "updatedAt DESC"},v.id LIMIT ? OFFSET ?`,
      )
      .all(...args, q.limit, q.offset) as UnitProfileSummary[];
    return {
      items,
      total: (
        this.db.prepare(`SELECT count(*) AS n${from}${where}`).get(...args) as {
          n: number;
        }
      ).n,
    };
  }
  operations(q: BrowseQuery) {
    const organization =
      "COALESCE(NULLIF(json_extract(o.document,'$.operationOrganizationBinding.identity.shortDesignation'),''),json_extract(o.document,'$.operationOrganizationBinding.identity.fullDesignation'))";
    const from = ` FROM operations o JOIN profile_versions d ON d.kind='doctrine' AND d.id=o.doctrine_id AND d.version=o.doctrine_version`;
    const where =
      " WHERE json_extract(o.document,'$.name') LIKE ? AND (?='' OR json_extract(o.document,'$.metadata.statusId')=?)";
    const args = [`%${q.search}%`, q.status, q.status];
    const items = this.db
      .prepare(
        `SELECT o.id,json_extract(o.document,'$.name') AS name,o.revision,json_extract(o.document,'$.updatedAt') AS updatedAt,json_extract(o.document,'$.metadata.statusId') AS status,${organization} AS organization,json_extract(d.document,'$.name') AS doctrine,json_extract(o.document,'$.demo') AS demo,(SELECT count(*) FROM publications p WHERE p.operation_id=o.id) AS publicationCount,(SELECT count(*) FROM change_reviews r WHERE r.operation_id=o.id AND NOT EXISTS(SELECT 1 FROM change_review_events e WHERE e.review_id=r.id AND json_extract(e.document,'$.action.type') IN ('COMPLETE','ARCHIVE','SUPERSEDE'))) AS openReviews${from}${where} ORDER BY ${q.sort === "name" ? "name COLLATE NOCASE" : "updatedAt DESC"},o.id LIMIT ? OFFSET ?`,
      )
      .all(...args, q.limit, q.offset) as GlobalOperationSummary[];
    return {
      items,
      total: (
        this.db.prepare(`SELECT count(*) AS n${from}${where}`).get(...args) as {
          n: number;
        }
      ).n,
    };
  }
  doctrines(includeStaff = false): DoctrineSummary[] {
    return (
      this.db
        .prepare(
          `SELECT v.id,v.family_id AS familyId,json_extract(v.document,'$.displayName') AS name,json_extract(v.document,'$.versionLabel') AS versionLabel,v.profile_version AS profileVersion,COALESCE(CASE WHEN r.version_id IS NOT NULL THEN 'RETIRED' END,v.status) AS status,json_extract(v.document,'$.sourceKind') AS sourceKind,json_extract(v.document,'$.config.organization.id') AS configId,json_extract(v.document,'$.config.organization.version') AS configVersion,${includeStaff ? "json_extract(v.document,'$.config.doctrine.staff')" : "'[]'"} AS staff FROM doctrine_versions v LEFT JOIN doctrine_retirements r ON r.version_id=v.id ORDER BY name,profileVersion DESC`,
        )
        .all() as (Omit<DoctrineSummary, "configuration" | "staff"> & {
        configId: string;
        configVersion: number;
        staff: string;
      })[]
    ).map(({ configId, configVersion, staff, ...d }) => ({
      ...d,
      configuration: { id: configId, version: configVersion },
      staff: JSON.parse(staff),
    }));
  }
  dashboard() {
    const q: BrowseQuery = {
      search: "",
      status: "",
      echelon: "",
      sort: "updated",
      limit: 6,
      offset: 0,
    };
    return {
      recentOperations: this.operations(q).items,
      draftOperations: this.operations({ ...q, status: "draft" }).items,
      publications: this.db
        .prepare(
          "SELECT p.id,p.operation_id AS operationId,json_extract(o.document,'$.name') AS name,p.version,json_extract(p.document,'$.publishedAt') AS publishedAt FROM publications p JOIN operations o ON o.id=p.operation_id ORDER BY publishedAt DESC LIMIT 6",
        )
        .all() as {
        id: string;
        operationId: string;
        name: string;
        version: number;
        publishedAt: string;
      }[],
      reviews: this.db
        .prepare(
          "SELECT r.id,r.operation_id AS operationId,COALESCE((SELECT json_extract(e.document,'$.action.title') FROM change_review_events e WHERE e.review_id=r.id AND json_extract(e.document,'$.action.type')='METADATA' ORDER BY e.sequence DESC LIMIT 1),json_extract(r.document,'$.title')) AS title,json_extract(r.document,'$.createdAt') AS createdAt FROM change_reviews r WHERE NOT EXISTS(SELECT 1 FROM change_review_events e WHERE e.review_id=r.id AND json_extract(e.document,'$.action.type') IN ('COMPLETE','ARCHIVE','SUPERSEDE')) ORDER BY createdAt DESC LIMIT 6",
        )
        .all() as {
        id: string;
        operationId: string;
        title: string;
        createdAt: string;
      }[],
      organizations: this.browse(q).items,
      doctrines: this.doctrines()
        .slice(0, 6)
        .map(({ staff: _, ...d }) => d),
      preferences: this.repo.preferences(),
    };
  }
  verifyAll() {
    for (const row of this.db
      .prepare("SELECT id FROM unit_profile_versions")
      .all() as { id: string }[]) {
      const v = this.get(row.id);
      if (v.parentVersionId) {
        const parent = this.get(v.parentVersionId);
        if (
          parent.unitProfileFamilyId !== v.unitProfileFamilyId ||
          parent.status === "DRAFT"
        )
          throw Error("Invalid Unit Profile ancestry");
      }
      if (
        v.duplicatedFrom &&
        this.get(v.duplicatedFrom.unitProfileVersionId).unitProfileFamilyId !==
          v.duplicatedFrom.unitProfileFamilyId
      )
        throw Error("Invalid Unit Profile duplication source");
      for (const m of v.roleMappings) {
        const d = this.repo
          .listDoctrines()
          .find(
            (d) =>
              d.doctrineFamilyId === m.doctrineFamilyId &&
              d.config.doctrine.version === m.doctrineVersion,
          );
        if (
          !d ||
          d.status === "DRAFT" ||
          !d.config.doctrine.staff.some((s) => s.id === m.staffId)
        )
          throw Error("Missing doctrine role mapping source");
      }
      assertStandingHierarchy(v, (id) => this.get(id), true);
      const indexed = this.db
        .prepare(
          "SELECT id AS relationshipId,child_family_id AS unitProfileFamilyId,child_version_id AS unitProfileVersionId FROM unit_profile_relationships WHERE parent_version_id=? ORDER BY ordinal",
        )
        .all(row.id);
      if (canonical(indexed) !== canonical(v.standingSubordinates))
        throw Error(
          "Standing relationship index differs from profile document",
        );
      if (v.insigniaAssetId) {
        const a = this.assets.readAsset(v.insigniaAssetId);
        if (a.metadata.unitProfileVersionId !== row.id)
          throw Error("Unit Profile asset owner mismatch");
      }
      if (
        v.defaultDoctrine &&
        !this.repo.listDoctrines().some(
          (d) =>
            d.doctrineVersionId === v.defaultDoctrine!.doctrineVersionId &&
            d.doctrineFamilyId === v.defaultDoctrine!.doctrineFamilyId &&
            d.config.doctrine.version === v.defaultDoctrine!.profileVersion &&
            canonical(v.defaultDoctrine!.configuration) ===
              canonical({
                id: d.config.organization.id,
                version: d.config.organization.version,
              }) &&
            d.status !== "DRAFT",
        )
      )
        throw Error("Missing default doctrine source");
    }
    const indexed = this.db
      .prepare(
        "SELECT operation_id,revision,family_id,version_id,content_hash FROM operation_unit_profile_pins ORDER BY operation_id,revision",
      )
      .all();
    const expected = this.db
      .prepare(
        "SELECT operation_id,revision,json_extract(snapshot,'$.operationOrganizationBinding.unitProfileFamilyId') AS family_id,json_extract(snapshot,'$.operationOrganizationBinding.unitProfileVersionId') AS version_id,json_extract(snapshot,'$.operationOrganizationBinding.contentHash') AS content_hash FROM operation_revisions WHERE json_type(snapshot,'$.operationOrganizationBinding')='object' ORDER BY operation_id,revision",
      )
      .all();
    if (canonical(indexed) !== canonical(expected))
      throw Error("Organization pin index differs from saved revisions");
    for (const name of [
      "unit_profile_frozen_update",
      "unit_profile_no_delete",
      "unit_profile_identity",
      "unit_profile_binding_insert",
      "unit_profile_binding_update",
      "unit_relationship_insert",
      "unit_relationship_update",
      "unit_relationship_delete",
      "unit_retirement_insert",
      "unit_retirement_update",
      "unit_retirement_delete",
      "unit_family_update",
      "unit_family_delete",
      "unit_profile_asset_insert",
      "operation_unit_profile_pin",
      "unit_pin_update",
      "unit_pin_delete",
    ])
      if (
        !this.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(name)
      )
        throw Error("Missing Unit Profile history protection");
  }
}
