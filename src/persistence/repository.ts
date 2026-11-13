import { archivedOrderOperation } from "../application/recorded-graphic-layout";
import { validateCatalogItem } from "../application/catalog-service";
import { verifyDocumentLayout } from "../application/verify-document-layout";
import { validateNarratives } from "../domain/narrative";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import migration from "./migrations/001.sql?raw";
import migration2 from "./migrations/002.sql?raw";
import migration3 from "./migrations/003.sql?raw";
import migration4 from "./migrations/004.sql?raw";
import migration5 from "./migrations/005.sql?raw";
import migration6 from "./migrations/006.sql?raw";
import migration7 from "./migrations/007.sql?raw";
import migration8 from "./migrations/008.sql?raw";
import migration9 from "./migrations/009.sql?raw";
import migration10 from "./migrations/010.sql?raw";
import migration11 from "./migrations/011.sql?raw";
import migration12 from "./migrations/012.sql?raw";
import migration13 from "./migrations/013.sql?raw";
import migration14 from "./migrations/014.sql?raw";
import migration15 from "./migrations/015.sql?raw";
import migration16 from "./migrations/016.sql?raw";
import migration17 from "./migrations/017.sql?raw";
import migration18 from "./migrations/018.sql?raw";
import migration19 from "./migrations/019.sql?raw";
import migration20 from "./migrations/020.sql?raw";
import { AlternativeStore } from "./alternative-store";
import { OfficeStore } from "./office-store";
import { BriefingStore } from "./briefing-store";
import { WhiteboardStore } from "./whiteboard-store";
import { SearchStore } from "./search-store";
import { CatalogStore } from "./catalog-store";
import { DeletionGate, DeletionStore } from "./deletion-store";
import type { DeletionRepository } from "../application/deletion-service";
import { WorkingDraftStore } from "./working-draft-store";
import { DocumentStore } from "./document-store";
import type { DocumentExport } from "../domain/document-exports";
import type { DraftKey, WorkingDraft } from "../application/working-drafts";
import { SymbologyStore } from "./symbology-store";
import type { SymbologyRepository } from "../application/symbology-ports";
import { UnitProfileStore } from "./unit-profile-store";
import type { UnitProfile } from "../domain/unit-profiles";
import type { BrowseQuery } from "../application/workspace-ports";
import { ReviewStore, reviewHash } from "./review-store";
import type { EndpointSelector } from "../domain/diff/model";
import type { ReviewHeader, ReviewEvent } from "../domain/reviews";
import { ModularStore, validateAssetBytes } from "./modular-store";
import type { DoctrineVersion } from "../domain/doctrine-builder";
import type { ManagedAsset } from "../domain/modules";
import * as tables from "./schema";
import {
  doctrineSchema,
  echelonSchema,
  organizationSchema,
  operationSchema,
  exportProfileSchema,
  publicationSchema,
  exportRecordSchema,
  preferencesSchema,
  approvalSchema,
  renderTemplateSchema,
  resolvedConfigSchema,
  type RevisionApproval,
  type Operation,
  type ResolvedConfig,
  type ExportProfile,
  type Publication,
  type Preferences,
} from "../domain/model";
import { assertOperation, assertExportScope } from "../domain/invariants";
import { canonical } from "../export/projection";
import { projectConnectedVersion as projectVersion } from "../export/planning-cards";
import { validate } from "../validation/engine";
import type { Repository } from "../application/ports";

const immutableTables = [
  "profile_versions",
  "operation_revisions",
  "export_profile_versions",
  "publications",
  "exports",
  "audit_events",
];
const addedImmutableTables = [
  "revision_approvals",
  "publication_approvals",
  "render_template_versions",
  "export_templates",
];
const doctrineImmutableTables = ["doctrine_nodes"];
const modularImmutableTables = ["managed_assets", "doctrine_retirements"];
const reviewImmutableTables = [
  "revision_identities",
  "change_review_changes",
  "change_review_events",
];
const migrations = [
  migration,
  migration2,
  migration3,
  migration4,
  migration5,
  migration6,
  migration7,
  migration8,
  migration9,
  migration10,
  migration11,
  migration12,
  migration13,
  migration14,
  migration15,
  migration16,
  migration17,
  migration18,
  migration19,
  migration20,
];
const entityTables = [
  "tasks",
  "events",
  "attachments",
  "net_participants",
  "radio_nets",
  "pace_plans",
  "units",
  "phases",
  "objectives",
];
type JsonRow = { document: string };
export class SqliteRepository implements Repository {
  readonly search: SearchStore;
  readonly catalog: CatalogStore;
  readonly sqlite: Database.Database;
  private db: ReturnType<typeof drizzle>;
  readonly modular: ModularStore;
  readonly reviews: ReviewStore;
  readonly unitProfiles: UnitProfileStore;
  readonly symbology: SymbologyStore;
  readonly workingDrafts: WorkingDraftStore;
  readonly documents: DocumentStore;
  readonly briefings: BriefingStore;
  readonly whiteboards: WhiteboardStore;
  readonly alternatives: AlternativeStore;
  cardOrigins(op: Operation) {
    return this.alternatives.cardOrigins(op);
  }
  readonly office: OfficeStore;
  private readonly deletionGate: DeletionGate;
  readonly deletions: DeletionStore;
  constructor(path: string, requireExisting = false) {
    this.sqlite = new Database(path, { fileMustExist: requireExisting });
    this.deletionGate = new DeletionGate(this.sqlite);
    try {
      if (
        requireExisting &&
        (this.sqlite.pragma("application_id", { simple: true }) !==
          1330791503 ||
          !this.sqlite
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            )
            .get() ||
          (requireExisting &&
            !(
              this.sqlite
                .prepare("SELECT count(*) AS n FROM schema_migrations")
                .get() as { n: number }
            ).n))
      )
        throw Error("The selected file is not an Ordo workspace backup");
      this.sqlite.pragma("foreign_keys = ON");
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.pragma("busy_timeout = 5000");
      this.migrate();
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
    this.db = drizzle(this.sqlite);
    this.search = new SearchStore(
      this.sqlite,
      (id) => this.getOperation(id),
      (op) => this.getConfig(op),
      (op) => this.cardOrigins(op),
    );
    this.catalog = new CatalogStore(this.sqlite, (item, token) =>
      this.search.indexCatalog(item, token),
    );
    this.workingDrafts = new WorkingDraftStore(this.sqlite);
    this.documents = new DocumentStore(this.sqlite, this);
    this.briefings = new BriefingStore(this.sqlite, this);
    this.office = new OfficeStore(this.sqlite, this);
    this.modular = new ModularStore(
      this.sqlite,
      (config) => this.seedConfig(config),
      (asset) => this.search.indexAsset(asset),
    );
    this.reviews = new ReviewStore(this.sqlite, this);
    this.whiteboards = new WhiteboardStore(this.sqlite, this, this.modular);
    this.alternatives = new AlternativeStore(this.sqlite, this);
    this.unitProfiles = new UnitProfileStore(this.sqlite, this, this.modular);
    this.symbology = new SymbologyStore(
      this.sqlite,
      this,
      migration7 + "\n" + migration8 + "\n" + migration11,
    );
    this.deletions = new DeletionStore(this.sqlite, this.deletionGate, () =>
      this.verifyAll(),
    );
  }
  prepareDeletion: DeletionRepository["prepareDeletion"] = (target) =>
    this.deletions.prepareDeletion(target);
  permanentlyDelete: DeletionRepository["permanentlyDelete"] = (
    target,
    fingerprint,
  ) => this.deletions.permanentlyDelete(target, fingerprint);
  private migrate() {
    this.sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)",
    );
    const rows = this.sqlite
      .prepare(
        "SELECT version,checksum FROM schema_migrations ORDER BY version",
      )
      .all() as { version: number; checksum: string }[];
    const checksums = migrations.map((sql) =>
      createHash("sha256").update(sql).digest("hex"),
    );
    // Migration 8 only changed its opening comment for release. Accept the
    // original digest exclusively for that exact revision of the SQL.
    const originalExchangeMigration =
      "62b51a39cb526f64f042d4a9114d35b52c29cb17da66b5e9fea2da065051fdb4";
    const releaseExchangeMigration =
      "36fab8e67e3b2e914f9d1e8103c6c487ae1bc4b0f960d03de27d3d6dffa422ac";
    if (
      rows.some(
        (r, i) =>
          r.version !== i + 1 ||
          (r.checksum !== checksums[i] &&
            !(
              r.version === 8 &&
              r.checksum === originalExchangeMigration &&
              checksums[i] === releaseExchangeMigration
            )),
      )
    )
      throw Error(
        "Database migration is newer or differs from this application. Restore with the matching app version.",
      );
    for (let i = rows.length; i < migrations.length; i++)
      this.sqlite.transaction(() => {
        const beforeAssets =
          i === 5
            ? (this.sqlite
                .prepare(
                  "SELECT id,operation_id,doctrine_version_id,document,bytes FROM managed_assets ORDER BY id",
                )
                .all() as {
                id: string;
                operation_id: string | null;
                doctrine_version_id: string | null;
                document: string;
                bytes: Buffer;
              }[])
            : [];
        for (const a of beforeAssets) {
          const metadata = JSON.parse(a.document);
          validateAssetBytes(metadata, a.bytes);
          if (
            metadata.assetId !== a.id ||
            metadata.operationId !== a.operation_id ||
            metadata.doctrineVersionId !== a.doctrine_version_id
          )
            throw Error("Asset migration source owner/identity mismatch");
        }
        this.sqlite.exec(migrations[i]);
        if (i === 5) {
          const afterAssets = this.sqlite
            .prepare(
              "SELECT id,operation_id,doctrine_version_id,document,bytes FROM managed_assets ORDER BY id",
            )
            .all() as typeof beforeAssets;
          if (
            beforeAssets.length !== afterAssets.length ||
            beforeAssets.some((a, n) => {
              const b = afterAssets[n];
              return (
                a.id !== b.id ||
                a.operation_id !== b.operation_id ||
                a.doctrine_version_id !== b.doctrine_version_id ||
                a.document !== b.document ||
                !a.bytes.equals(b.bytes)
              );
            })
          )
            throw Error("Asset migration changed existing managed assets");
          for (const name of [
            "immutable_managed_assets_UPDATE",
            "immutable_managed_assets_DELETE",
            "doctrine_asset_insert",
          ])
            if (
              !this.sqlite
                .prepare(
                  "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
                )
                .get(name)
            )
              throw Error("Asset migration lost immutability protection");
        }
        this.sqlite.pragma("application_id = 1330791503");
        for (const table of i === 0
          ? immutableTables
          : i === 1
            ? addedImmutableTables
            : i === 2
              ? doctrineImmutableTables
              : i === 3
                ? modularImmutableTables
                : i === 4
                  ? reviewImmutableTables
                  : [])
          for (const action of ["UPDATE", "DELETE"])
            this.sqlite.exec(
              `CREATE TRIGGER immutable_${table}_${action} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT, 'History is immutable'); END;`,
            );
        this.sqlite
          .prepare("INSERT INTO schema_migrations VALUES(?,?)")
          .run(i + 1, checksums[i]);
      })();
  }
  close() {
    this.sqlite.close();
  }
  hash(text: string) {
    return reviewHash(text);
  }
  revisionHistory(operationId: string) {
    return this.reviews.revisionHistory(operationId);
  }
  resolveEndpoint(selector: EndpointSelector) {
    return this.reviews.resolveEndpoint(selector);
  }
  insertReview(review: ReviewHeader) {
    this.reviews.insertReview(review);
  }
  listReviews(operationId: string) {
    return this.reviews.listReviews(operationId);
  }
  getReview(id: string) {
    return this.reviews.getReview(id);
  }
  appendReviewEvent(event: ReviewEvent, expectedSequence: number) {
    this.reviews.appendReviewEvent(event, expectedSequence);
  }
  listDoctrines() {
    return this.modular.listDoctrines();
  }
  saveDoctrine(v: DoctrineVersion, expected: number | null) {
    this.modular.saveDoctrine(v, expected);
  }
  retireDoctrine(id: string, at: string) {
    this.modular.retireDoctrine(id, at);
  }
  listAssets() {
    return this.modular.listAssets();
  }
  assetData(id: string) {
    return this.modular.assetData(id);
  }
  verifyAssetReferences(assets: ManagedAsset[]) {
    this.modular.verifyAssetReferences(assets);
  }
  copyDoctrineAssets(
    source: DoctrineVersion,
    target: DoctrineVersion,
    id: () => string,
    now: string,
  ) {
    this.modular.copyDoctrineAssets(source, target, id, now);
  }
  exportDoctrinePackage(id: string) {
    return this.modular.exportDoctrinePackage(id);
  }
  importDoctrinePackage(input: unknown) {
    return this.modular.importDoctrinePackage(input);
  }
  transaction<T>(work: () => T): T {
    return this.sqlite.transaction(work)();
  }
  getSymbol: SymbologyRepository["getSymbol"] = (id) =>
    this.symbology.getSymbol(id);
  lookupExchangeDependency: SymbologyRepository["lookupExchangeDependency"] = (
    kind,
    id,
  ) => this.symbology.lookupExchangeDependency(kind, id);
  insertExchangeImport: SymbologyRepository["insertExchangeImport"] = (
    receipt,
  ) => this.symbology.insertExchangeImport(receipt);
  getExchangeImport: SymbologyRepository["getExchangeImport"] = (id) =>
    this.symbology.getExchangeImport(id);
  hashBinary: SymbologyRepository["hashBinary"] = (bytes) =>
    createHash("sha256").update(bytes).digest("hex");
  getOrbat: SymbologyRepository["getOrbat"] = (id) =>
    this.symbology.getOrbat(id);
  libraryHash: SymbologyRepository["libraryHash"] = (kind, id) =>
    this.symbology.hash(kind, id);
  saveLibrary: SymbologyRepository["saveLibrary"] = (kind, v, expected) =>
    this.symbology.save(kind, v, expected);
  retireLibrary: SymbologyRepository["retireLibrary"] = (kind, id, at) =>
    this.symbology.retire(kind, id, at);
  deleteLibraryDraft: SymbologyRepository["deleteLibraryDraft"] = (kind, id) =>
    this.symbology.deleteDraft(kind, id);
  browseLibrary: SymbologyRepository["browseLibrary"] = (kind, query) =>
    this.symbology.browse(kind, query);
  resolveSymbolPin: SymbologyRepository["resolveSymbolPin"] = (id) =>
    this.symbology.resolveSymbolPin(id);
  verifySymbolPin: SymbologyRepository["verifySymbolPin"] = (
    pin,
    allowRetired,
  ) => this.symbology.verifySymbolPin(pin, allowRetired);
  verifyOperationSymbology: SymbologyRepository["verifyOperationSymbology"] = (
    op,
  ) => {
    this.symbology.verifyOperation(op);
    this.verifyWhiteboardResources(op);
  };
  private verifyWhiteboardResources(op: Operation) {
    for (const board of op.whiteboards?.boards ?? [])
      for (const item of board.items) {
        if (item.kind === "symbol") this.verifySymbolPin(item.pin, true);
        if (item.kind === "graphic") this.getGraphicExport(item.exportId);
      }
  }
  getOrbatImport: SymbologyRepository["getOrbatImport"] = (op, id) =>
    this.symbology.getImport(op, id);
  insertOrbatImport: SymbologyRepository["insertOrbatImport"] = (r) =>
    this.symbology.insertImport(r);
  saveGraphicProfile: SymbologyRepository["saveGraphicProfile"] = (p) =>
    this.symbology.saveGraphicProfile(p);
  getGraphicProfile: SymbologyRepository["getGraphicProfile"] = (id, version) =>
    this.symbology.getGraphicProfile(id, version);
  insertGraphicExport: SymbologyRepository["insertGraphicExport"] = (
    r,
    bytes,
  ) => this.symbology.insertGraphic(r, bytes);
  getGraphicExport: SymbologyRepository["getGraphicExport"] = (id) =>
    this.symbology.getGraphic(id);
  listGraphicExports: SymbologyRepository["listGraphicExports"] = () =>
    this.symbology.listGraphics();
  listOperationGraphicExportIds: SymbologyRepository["listOperationGraphicExportIds"] =
    (id) =>
      (
        this.sqlite
          .prepare(
            "SELECT id FROM graphic_exports WHERE operation_id=? ORDER BY id",
          )
          .all(id) as { id: string }[]
      ).map((r) => r.id);
  getUnitProfile(id: string) {
    return this.unitProfiles.get(id);
  }
  unitProfileHash(id: string) {
    return this.unitProfiles.hash(id);
  }
  saveUnitProfile(v: UnitProfile, expected: number | null) {
    this.unitProfiles.save(v, expected);
  }
  retireUnitProfile(id: string, at: string) {
    this.unitProfiles.retire(id, at);
  }
  copyUnitProfileAsset(
    source: UnitProfile,
    target: UnitProfile,
    id: () => string,
    now: string,
  ) {
    this.unitProfiles.copyAsset(source, target, id, now);
  }
  verifyOperationOrganization(op: Operation) {
    this.unitProfiles.verifyOperation(op);
  }
  browseUnitProfiles(q: BrowseQuery) {
    return this.unitProfiles.browse(q);
  }
  browseOperations(q: BrowseQuery) {
    return this.unitProfiles.operations(q);
  }
  doctrineSummaries(includeStaff = false) {
    return this.unitProfiles.doctrines(includeStaff);
  }
  dashboard() {
    return this.unitProfiles.dashboard();
  }
  seedConfig(config: ResolvedConfig) {
    resolvedConfigSchema.parse(config);
    this.transaction(() => {
      for (const [kind, schema] of [
        ["doctrine", doctrineSchema],
        ["echelon", echelonSchema],
        ["organization", organizationSchema],
      ] as const) {
        const value = schema.parse(config[kind]);
        const existing = this.db
          .select()
          .from(tables.profileVersions)
          .where(
            and(
              eq(tables.profileVersions.kind, kind),
              eq(tables.profileVersions.id, value.id),
              eq(tables.profileVersions.version, value.version),
            ),
          )
          .get();
        if (existing) {
          if (canonical(JSON.parse(existing.document)) !== canonical(value))
            throw Error("Profile versions cannot be overwritten");
          continue;
        }
        this.sqlite
          .prepare("INSERT INTO profile_versions VALUES(?,?,?,?)")
          .run(kind, value.id, value.version, JSON.stringify(value));
      }
      for (const node of config.doctrine.catalog?.nodes ?? []) {
        const row = this.sqlite
          .prepare(
            "SELECT stable_key,parent_stable_key FROM doctrine_nodes WHERE profile_id=? AND profile_version=? AND node_id=?",
          )
          .get(config.doctrine.id, config.doctrine.version, node.id) as
          { stable_key: string; parent_stable_key: string | null } | undefined;
        if (row) {
          if (
            row.stable_key !== node.stableKey ||
            row.parent_stable_key !== node.parentStableKey
          )
            throw Error("Doctrine index differs from immutable profile");
        } else
          this.sqlite
            .prepare(
              "INSERT INTO doctrine_nodes(profile_id,profile_version,node_id,stable_key,parent_stable_key) VALUES(?,?,?,?,?)",
            )
            .run(
              config.doctrine.id,
              config.doctrine.version,
              node.id,
              node.stableKey,
              node.parentStableKey,
            );
      }
    });
  }
  listConfigurations(): ResolvedConfig[] {
    return (
      this.sqlite
        .prepare(
          "SELECT document FROM profile_versions WHERE kind='organization' ORDER BY id,version DESC",
        )
        .all() as JsonRow[]
    ).map((row) => {
      const org = organizationSchema.parse(JSON.parse(row.document));
      return this.getConfig({
        organizationRef: { id: org.id, version: org.version },
        doctrineRef: org.doctrineRef,
        echelonRef: org.echelonRef,
      });
    });
  }
  getConfig(
    op?: Pick<Operation, "doctrineRef" | "organizationRef" | "echelonRef">,
  ): ResolvedConfig {
    const read = (kind: "doctrine" | "echelon" | "organization") => {
      const ref = op?.[`${kind}Ref`];
      if (!ref && kind === "organization") {
        // Retain the first installed organization family as the default. New
        // randomly identified custom doctrines must not change the default.
        const original = this.sqlite
          .prepare(
            "SELECT document FROM profile_versions WHERE kind='organization' AND id=(SELECT id FROM profile_versions WHERE kind='organization' ORDER BY rowid LIMIT 1) ORDER BY version DESC LIMIT 1",
          )
          .get() as JsonRow | undefined;
        if (!original) throw Error("Missing organization profile version");
        return JSON.parse(original.document);
      }
      const row = ref
        ? this.db
            .select()
            .from(tables.profileVersions)
            .where(
              and(
                eq(tables.profileVersions.kind, kind),
                eq(tables.profileVersions.id, ref.id),
                eq(tables.profileVersions.version, ref.version),
              ),
            )
            .get()
        : this.db
            .select()
            .from(tables.profileVersions)
            .where(eq(tables.profileVersions.kind, kind))
            .orderBy(
              tables.profileVersions.id,
              desc(tables.profileVersions.version),
            )
            .get();
      if (!row) throw Error(`Missing ${kind} profile version`);
      return JSON.parse(row.document);
    };
    const organization = organizationSchema.parse(read("organization"));
    const readPinned = (kind: string, ref: { id: string; version: number }) => {
      const row = this.db
        .select()
        .from(tables.profileVersions)
        .where(
          and(
            eq(tables.profileVersions.kind, kind),
            eq(tables.profileVersions.id, ref.id),
            eq(tables.profileVersions.version, ref.version),
          ),
        )
        .get();
      if (!row) throw Error(`Missing default ${kind} profile version`);
      return JSON.parse(row.document);
    };
    return {
      doctrine: doctrineSchema.parse(
        op
          ? read("doctrine")
          : readPinned("doctrine", organization.doctrineRef),
      ),
      echelon: echelonSchema.parse(
        op ? read("echelon") : readPinned("echelon", organization.echelonRef),
      ),
      organization,
    };
  }
  listOperations() {
    return this.db
      .select()
      .from(tables.operations)
      .all()
      .map((r) => {
        const d = JSON.parse(r.document);
        return {
          id: r.id,
          name: d.name as string,
          revision: r.revision,
          updatedAt: d.updatedAt as string,
          demo: d.demo as boolean,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  getOperation(id: string, revision?: number): Operation {
    if (revision !== undefined) {
      const row = this.sqlite
        .prepare(
          "SELECT snapshot FROM operation_revisions WHERE operation_id=? AND revision=?",
        )
        .get(id, revision) as { snapshot: string } | undefined;
      if (!row) throw Error("Operation revision not found");
      return operationSchema.parse(JSON.parse(row.snapshot));
    }
    const row = this.db
      .select()
      .from(tables.operations)
      .where(eq(tables.operations.id, id))
      .get();
    if (!row) throw Error("Operation not found");
    const header = JSON.parse(row.document);
    const read = (table: string) =>
      (
        this.sqlite
          .prepare(
            `SELECT document FROM ${table} WHERE operation_id=? ORDER BY ordinal`,
          )
          .all(id) as JsonRow[]
      ).map((r) => JSON.parse(r.document));
    return operationSchema.parse({
      ...header,
      revision: row.revision,
      units: read("units"),
      phases: read("phases"),
      objectives: read("objectives"),
      tasks: read("tasks"),
      events: read("events"),
      attachments: read("attachments"),
      signal: {
        ...header.signal,
        nets: read("radio_nets"),
        pacePlans: read("pace_plans"),
      },
    });
  }
  saveOperation(op: Operation, expectedRevision: number | null, actor: string) {
    validateNarratives(op);
    this.verifyOperationOrganization(op);
    this.verifyOperationSymbology(op);
    this.verifyAssetReferences([
      ...(op.briefings?.decks.flatMap((d) =>
        d.slides.flatMap((s) =>
          s.graphic?.kind === "image" ? [s.graphic.asset] : [],
        ),
      ) ?? []),
      ...(op.modules?.assets ?? []),
      ...(op.metadata.documentLayout?.header.logo
        ? [op.metadata.documentLayout.header.logo]
        : []),
    ]);
    assertOperation(op, this.getConfig(op));
    this.transaction(() => {
      const existing = this.db
        .select()
        .from(tables.operations)
        .where(eq(tables.operations.id, op.id))
        .get();
      if (
        (existing?.revision ?? null) !== expectedRevision ||
        op.revision !== (expectedRevision ?? 0) + 1
      )
        throw Error(
          "This operation changed. Reload before saving to avoid overwriting newer work.",
        );
      const {
        units,
        phases,
        objectives,
        tasks,
        events,
        attachments,
        signal,
        ...header
      } = op;
      const document = JSON.stringify({
        ...header,
        signal: { ...signal, nets: undefined, pacePlans: undefined },
      });
      if (existing)
        this.sqlite
          .prepare(
            "UPDATE operations SET revision=?,document=?,doctrine_id=?,doctrine_version=?,organization_id=?,organization_version=?,echelon_id=?,echelon_version=? WHERE id=?",
          )
          .run(
            op.revision,
            document,
            op.doctrineRef.id,
            op.doctrineRef.version,
            op.organizationRef.id,
            op.organizationRef.version,
            op.echelonRef.id,
            op.echelonRef.version,
            op.id,
          );
      else
        this.sqlite
          .prepare(
            "INSERT INTO operations(id,revision,document,doctrine_id,doctrine_version,organization_id,organization_version,echelon_id,echelon_version) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            op.id,
            op.revision,
            document,
            op.doctrineRef.id,
            op.doctrineRef.version,
            op.organizationRef.id,
            op.organizationRef.version,
            op.echelonRef.id,
            op.echelonRef.version,
          );
      for (const table of entityTables)
        this.sqlite
          .prepare(`DELETE FROM ${table} WHERE operation_id=?`)
          .run(op.id);
      const insert = (
        table: string,
        list: { id: string }[],
        columns: string[] = [],
        values: (item: any) => unknown[] = () => [],
      ) => {
        const stmt = this.sqlite.prepare(
          `INSERT INTO ${table}(id,operation_id,ordinal,document${columns.length ? "," + columns.join(",") : ""}) VALUES(${Array(
            4 + columns.length,
          )
            .fill("?")
            .join(",")})`,
        );
        list.forEach((item, i) =>
          stmt.run(item.id, op.id, i, JSON.stringify(item), ...values(item)),
        );
      };
      insert("units", units, ["parent_id"], (u) => [u.parentUnitId]);
      insert("phases", phases);
      insert("objectives", objectives);
      insert("tasks", tasks, ["unit_id", "phase_id", "objective_id"], (t) => [
        t.unitId,
        t.phaseId,
        t.objectiveId,
      ]);
      insert("events", events, ["relative_to_id", "phase_id"], (e) => [
        e.relativeToEventId,
        e.phaseId,
      ]);
      insert(
        "attachments",
        attachments,
        ["kind", "parent_attachment_id", "doctrine_node_id", "applicability"],
        (a) => [
          a.kind,
          a.kind === "annex" ? null : a.parentId,
          a.doctrineNodeId ?? null,
          a.applicability ?? null,
        ],
      );
      insert("radio_nets", signal.nets);
      insert("pace_plans", signal.pacePlans);
      for (const n of signal.nets)
        for (const unit of n.participantUnitIds)
          this.sqlite
            .prepare("INSERT INTO net_participants VALUES(?,?,?)")
            .run(op.id, n.id, unit);
      this.sqlite
        .prepare("INSERT INTO operation_revisions VALUES(?,?,?,?,?)")
        .run(op.id, op.revision, op.updatedAt, actor, JSON.stringify(op));
      this.symbology.indexOperation(op);
      this.search.indexOperation(op);
      this.audit(
        op.id,
        op.updatedAt,
        actor,
        "operation-saved",
        op.id,
        op.revision,
      );
    });
  }
  private audit(
    opId: string,
    at: string,
    actor: string,
    kind: string,
    entityId: string,
    revision: number,
  ) {
    this.sqlite
      .prepare(
        "INSERT INTO audit_events(operation_id,at,actor,kind,entity_id,revision) VALUES(?,?,?,?,?,?)",
      )
      .run(opId, at, actor, kind, entityId, revision);
  }
  saveExportProfile(profile: ExportProfile) {
    const p = exportProfileSchema.parse(profile);
    assertExportScope(this.getOperation(p.operationId), p);
    const latest = this.db
      .select()
      .from(tables.exportProfiles)
      .where(eq(tables.exportProfiles.id, p.id))
      .orderBy(desc(tables.exportProfiles.version))
      .get();
    if (
      p.version !== (latest?.version ?? 0) + 1 ||
      (latest && latest.operationId !== p.operationId)
    )
      throw Error("Export profile version conflict");
    this.sqlite
      .prepare("INSERT INTO export_profile_versions VALUES(?,?,?,?)")
      .run(p.id, p.version, p.operationId, JSON.stringify(p));
  }
  getExportProfile(id: string, version: number) {
    const row = this.db
      .select()
      .from(tables.exportProfiles)
      .where(
        and(
          eq(tables.exportProfiles.id, id),
          eq(tables.exportProfiles.version, version),
        ),
      )
      .get();
    if (!row) throw Error("Export profile version not found");
    return exportProfileSchema.parse(JSON.parse(row.document));
  }
  listExportProfiles(operationId: string) {
    return this.db
      .select()
      .from(tables.exportProfiles)
      .where(eq(tables.exportProfiles.operationId, operationId))
      .orderBy(desc(tables.exportProfiles.version))
      .all()
      .map((r) => exportProfileSchema.parse(JSON.parse(r.document)))
      .filter((p, i, all) => all.findIndex((a) => a.id === p.id) === i);
  }
  insertApproval(input: RevisionApproval) {
    const a = approvalSchema.parse(input);
    const op = this.getOperation(a.operationId);
    const config = this.getConfig(op);
    if (
      a.origin !== "explicit-approval" ||
      a.sourceRevision !== op.revision ||
      op.metadata.statusId !== config.doctrine.publicationRequiredStatus ||
      validate(op, config).some((f) => f.severity === "error")
    )
      throw Error(
        "Approval requires the exact current revision, acceptable workflow state, and no validation errors",
      );
    this.transaction(() => {
      this.sqlite
        .prepare("INSERT INTO revision_approvals VALUES(?,?,?,?,?,?)")
        .run(
          a.id,
          a.operationId,
          a.sourceRevision,
          a.scope,
          a.origin,
          JSON.stringify(a),
        );
      this.audit(
        a.operationId,
        a.at,
        a.actor,
        "revision-approved",
        a.id,
        a.sourceRevision,
      );
    });
  }
  listApprovals(operationId: string): RevisionApproval[] {
    return (
      this.sqlite
        .prepare(
          "SELECT * FROM revision_approvals WHERE operation_id=? ORDER BY source_revision DESC",
        )
        .all(operationId) as {
        id: string;
        operation_id: string;
        source_revision: number;
        scope: string;
        origin: string;
        document: string;
      }[]
    ).map((r) => {
      const a = approvalSchema.parse(JSON.parse(r.document));
      if (
        a.id !== r.id ||
        a.operationId !== r.operation_id ||
        a.sourceRevision !== r.source_revision ||
        a.scope !== r.scope ||
        a.origin !== r.origin
      )
        throw Error("Approval record identity mismatch");
      return a;
    });
  }
  getRenderTemplate(id: string, version: number) {
    const row = this.sqlite
      .prepare(
        "SELECT document FROM render_template_versions WHERE id=? AND version=?",
      )
      .get(id, version) as JsonRow | undefined;
    if (!row) throw Error("Render template version not found");
    const t = renderTemplateSchema.parse(JSON.parse(row.document));
    if (t.id !== id || t.version !== version)
      throw Error("Render template identity mismatch");
    return t;
  }
  insertPublication(input: Publication) {
    const p = publicationSchema.parse(input);
    if (
      p.operationId !== p.snapshot.id ||
      p.orderId !== p.snapshot.orderId ||
      p.sourceRevision !== p.snapshot.revision ||
      p.orderNumber !== p.snapshot.orderNumber ||
      canonical(p.snapshot) !==
        canonical(this.getOperation(p.operationId, p.sourceRevision)) ||
      canonical(p.config) !== canonical(this.getConfig(p.snapshot))
    )
      throw Error(
        "Publication must preserve its exact source revision and configuration",
      );
    const approval = this.listApprovals(p.operationId).find(
      (a) => a.id === p.approvalId,
    );
    if (
      p.schemaVersion !== 2 ||
      !approval ||
      approval.origin !== "explicit-approval" ||
      approval.sourceRevision !== p.sourceRevision ||
      approval.scope !== p.productType ||
      canonical(p.approval) !==
        canonical({
          actor: approval.actor,
          at: approval.at,
          note: approval.note,
        }) ||
      p.snapshot.metadata.statusId !==
        p.config.doctrine.publicationRequiredStatus ||
      validate(p.snapshot, p.config).some((f) => f.severity === "error")
    )
      throw Error(
        "Publication requires a valid explicit approval of this exact revision",
      );
    this.sqlite
      .prepare("INSERT INTO publications VALUES(?,?,?,?,?,?)")
      .run(
        p.id,
        p.operationId,
        p.sourceRevision,
        p.version,
        p.supersedesId,
        JSON.stringify(p),
      );
    this.audit(
      p.operationId,
      p.publishedAt,
      p.approval.actor,
      "published",
      p.id,
      p.sourceRevision,
    );
  }
  listPublications(operationId: string) {
    return this.db
      .select()
      .from(tables.publications)
      .where(eq(tables.publications.operationId, operationId))
      .orderBy(desc(tables.publications.version))
      .all()
      .map((r) => {
        const binding = this.sqlite
          .prepare(
            "SELECT approval_id FROM publication_approvals WHERE publication_id=?",
          )
          .get(r.id) as { approval_id: string } | undefined;
        if (!binding) throw Error("Missing publication approval binding");
        const doc = JSON.parse(r.document);
        if (
          doc.id !== r.id ||
          doc.operationId !== r.operationId ||
          doc.sourceRevision !== r.sourceRevision ||
          doc.version !== r.version ||
          doc.supersedesId !== r.supersedesId
        )
          throw Error("Publication row identity mismatch");
        if (doc.approvalId && doc.approvalId !== binding.approval_id)
          throw Error("Publication approval binding mismatch");
        return publicationSchema.parse({
          ...doc,
          approvalId: binding.approval_id,
        });
      });
  }
  insertExport(input: unknown) {
    const e = exportRecordSchema.parse(input);
    const source = archivedOrderOperation(
      e,
      this.getOperation(e.operationId, e.sourceRevision),
    );
    if (
      canonical(e.profile) !==
        canonical(this.getExportProfile(e.profile.id, e.profile.version)) ||
      canonical(e.config) !== canonical(this.getConfig(source)) ||
      canonical(e.dependencies) !==
        canonical(
          projectVersion(e.projectionVersion, source, e.profile, e.config)
            .dependencies,
        )
    )
      throw Error("Export provenance does not match its exact source");
    verifyDocumentLayout(e, source, (text) =>
      this.hashBinary(new TextEncoder().encode(text)),
    );
    if (
      (e.schemaVersion !== 2 &&
        e.schemaVersion !== 3 &&
        e.schemaVersion !== 4 &&
        e.schemaVersion !== 5 &&
        e.schemaVersion !== 6 &&
        e.schemaVersion !== 7) ||
      !e.renderTemplateId ||
      !e.renderTemplateVersion ||
      this.getRenderTemplate(e.renderTemplateId, e.renderTemplateVersion)
        .product !== e.profile.product
    )
      throw Error("Export requires its product's render template");
    if (
      e.sourcePublicationId &&
      !this.listPublications(e.operationId).some(
        (p) =>
          p.id === e.sourcePublicationId &&
          p.sourceRevision === e.sourceRevision,
      )
    )
      throw Error("Export publication source mismatch");
    this.sqlite
      .prepare("INSERT INTO exports VALUES(?,?,?,?,?,?,?)")
      .run(
        e.id,
        e.operationId,
        e.sourceRevision,
        e.sourcePublicationId,
        e.profile.id,
        e.profile.version,
        JSON.stringify(e),
      );
    this.audit(
      e.operationId,
      e.generatedAt,
      e.actor,
      "export-generated",
      e.id,
      e.sourceRevision,
    );
  }
  listExports(operationId: string) {
    return this.db
      .select()
      .from(tables.exportsTable)
      .where(eq(tables.exportsTable.operationId, operationId))
      .all()
      .map((r) => {
        const binding = this.sqlite
          .prepare(
            "SELECT template_id,template_version FROM export_templates WHERE export_id=?",
          )
          .get(r.id) as
          { template_id: string; template_version: number } | undefined;
        if (!binding) throw Error("Missing export template binding");
        const doc = JSON.parse(r.document);
        if (
          doc.id !== r.id ||
          doc.operationId !== r.operationId ||
          doc.sourceRevision !== r.sourceRevision ||
          doc.sourcePublicationId !== r.publicationId ||
          doc.profile?.id !== r.profileId ||
          doc.profile?.version !== r.profileVersion
        )
          throw Error("Export row identity mismatch");
        if (
          (doc.renderTemplateId &&
            doc.renderTemplateId !== binding.template_id) ||
          (doc.renderTemplateVersion &&
            doc.renderTemplateVersion !== binding.template_version)
        )
          throw Error("Export template binding mismatch");
        return exportRecordSchema.parse({
          ...doc,
          renderTemplateId: binding.template_id,
          renderTemplateVersion: binding.template_version,
        });
      })
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }
  preferences(input?: Preferences): Preferences {
    if (input)
      this.sqlite
        .prepare(
          "INSERT INTO preferences VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
        )
        .run(JSON.stringify(preferencesSchema.parse(input)));
    const row = this.sqlite
      .prepare("SELECT document FROM preferences WHERE id=1")
      .get() as JsonRow | undefined;
    return row
      ? preferencesSchema.parse(JSON.parse(row.document))
      : { schemaVersion: 1, timeDisplay: "utc", pageSize: "letter" };
  }
  async backup(path: string) {
    await this.sqlite.backup(path);
  }
  listWorkingDrafts() {
    return this.workingDrafts.listWorkingDrafts();
  }
  insertDocument(record: DocumentExport, bytes: Uint8Array) {
    this.documents.insertDocument(record, bytes);
  }
  getDocument(id: string) {
    return this.documents.getDocument(id);
  }
  listDocuments(operationId: string) {
    return this.documents.listDocuments(operationId);
  }
  getWorkingDraft(key: DraftKey) {
    return this.workingDrafts.getWorkingDraft(key);
  }
  putWorkingDraft(draft: WorkingDraft, expected: number) {
    return this.workingDrafts.putWorkingDraft(draft, expected);
  }
  removeWorkingDraft(key: DraftKey, expected: number) {
    this.workingDrafts.removeWorkingDraft(key, expected);
  }
  verifyAll() {
    this.catalog.verifyAll();
    for (const kind of ["DOCTRINE", "ORGANIZATION", "SYMBOL", "ORBAT"] as const)
      for (const { item } of this.catalog.catalogList(kind))
        validateCatalogItem(item, this, this.catalog);
    this.workingDrafts.verifyAll();
    this.documents.verifyAll();
    this.briefings.verifyAll();
    this.whiteboards.verifyAll();
    this.alternatives.verifyAll();
    this.office.verifyAll();
    const actualExportGuard = this.sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='export_requires_template'",
      )
      .get() as { sql: string } | undefined;
    const expectedExportGuard = migration16
      .slice(migration16.indexOf("CREATE TRIGGER export_requires_template"))
      .trim()
      .replace(/;$/, "");
    if (
      actualExportGuard?.sql.replace(/\s+/g, " ").trim() !==
      expectedExportGuard.replace(/\s+/g, " ").trim()
    )
      throw Error("Missing or altered export-envelope protection");
    this.symbology.verifyAll();
    this.unitProfiles.verifyAll();
    this.reviews.verifyAll();
    this.getConfig();
    this.modular.verifyAll();
    if (
      this.sqlite.pragma("integrity_check", { simple: true }) !== "ok" ||
      (this.sqlite.pragma("foreign_key_check") as unknown[]).length
    )
      throw Error("Database integrity check failed");
    for (const table of [
      ...immutableTables,
      ...addedImmutableTables,
      ...doctrineImmutableTables,
      ...modularImmutableTables,
    ])
      for (const action of ["UPDATE", "DELETE"])
        if (
          !this.sqlite
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
            )
            .get(`immutable_${table}_${action}`)
        )
          throw Error("Missing immutable-history protection");
    for (const r of this.sqlite
      .prepare("SELECT id,version FROM render_template_versions")
      .all() as { id: string; version: number }[])
      this.getRenderTemplate(r.id, r.version);
    for (const r of this.db.select().from(tables.profileVersions).all()) {
      const parsed = {
        doctrine: doctrineSchema,
        echelon: echelonSchema,
        organization: organizationSchema,
      }[r.kind]!.parse(JSON.parse(r.document));
      if (parsed.id !== r.id || parsed.version !== r.version)
        throw Error("Configuration row identity mismatch");
      if (r.kind === "doctrine") {
        const doctrine = doctrineSchema.parse(parsed);
        if (doctrine.modules) {
          this.verifyAssetReferences(doctrine.modules.assets);
          if (
            !this.listDoctrines().some(
              (v) =>
                v.doctrineVersionId === doctrine.modules!.doctrineVersionId &&
                v.doctrineFamilyId === doctrine.id &&
                v.config.doctrine.version === doctrine.version &&
                v.status !== "DRAFT",
            )
          )
            throw Error(
              "Module doctrine profile is missing its published lifecycle record",
            );
        }
        const actual = this.sqlite
          .prepare(
            "SELECT node_id,stable_key,parent_stable_key FROM doctrine_nodes WHERE profile_id=? AND profile_version=? ORDER BY node_id",
          )
          .all(r.id, r.version);
        const expected = (doctrine.catalog?.nodes ?? [])
          .map((n) => ({
            node_id: n.id,
            stable_key: n.stableKey,
            parent_stable_key: n.parentStableKey,
          }))
          .sort((a, b) => a.node_id.localeCompare(b.node_id));
        if (canonical(actual) !== canonical(expected))
          throw Error("Doctrine node index differs from immutable profile");
      }
    }
    for (const row of this.sqlite
      .prepare(
        "SELECT doctrine_node_id,applicability,document FROM attachments",
      )
      .all() as {
      doctrine_node_id: string | null;
      applicability: string | null;
      document: string;
    }[]) {
      const document = JSON.parse(row.document);
      if (
        row.doctrine_node_id !== (document.doctrineNodeId ?? null) ||
        row.applicability !== (document.applicability ?? null)
      )
        throw Error(
          "Authored product index differs from its operation document",
        );
    }
    for (const name of [
      "authored_product_binding_insert",
      "authored_product_binding_update",
    ])
      if (
        !this.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(name)
      )
        throw Error("Missing authored product binding protection");
    for (const summary of this.listOperations()) {
      const op = this.getOperation(summary.id);
      assertOperation(op, this.getConfig(op));
      this.verifyOperationOrganization(op);
      this.verifyWhiteboardResources(op);
      const revisions = this.sqlite
        .prepare(
          "SELECT revision,saved_at,actor,snapshot FROM operation_revisions WHERE operation_id=? ORDER BY revision",
        )
        .all(op.id) as {
        revision: number;
        saved_at: string;
        actor: string;
        snapshot: string;
      }[];
      revisions.forEach((r, i) => {
        const old = operationSchema.parse(JSON.parse(r.snapshot));
        if (
          old.id !== op.id ||
          old.revision !== i + 1 ||
          old.revision !== r.revision ||
          old.updatedAt !== r.saved_at ||
          !r.actor.trim()
        )
          throw Error("Invalid revision sequence");
        assertOperation(old, this.getConfig(old));
        this.verifyOperationOrganization(old);
        this.verifyWhiteboardResources(old);
        this.verifyAssetReferences([
          ...(old.briefings?.decks.flatMap((d) =>
            d.slides.flatMap((s) =>
              s.graphic?.kind === "image" ? [s.graphic.asset] : [],
            ),
          ) ?? []),
          ...(old.modules?.assets ?? []),
          ...(old.metadata.documentLayout?.header.logo
            ? [old.metadata.documentLayout.header.logo]
            : []),
        ]);
      });
      if (
        revisions.length !== op.revision ||
        canonical(JSON.parse(revisions.at(-1)!.snapshot)) !== canonical(op)
      )
        throw Error("Current operation differs from its revision");
      this.listPublications(op.id).forEach((p) => {
        const a = this.listApprovals(op.id).find((a) => a.id === p.approvalId);
        if (
          !a ||
          a.sourceRevision !== p.sourceRevision ||
          a.scope !== p.productType ||
          (p.schemaVersion === 2 && a.origin !== "explicit-approval") ||
          canonical(p.approval) !==
            canonical({ actor: a.actor, at: a.at, note: a.note }) ||
          canonical(p.snapshot) !==
            canonical(this.getOperation(op.id, p.sourceRevision)) ||
          canonical(p.config) !== canonical(this.getConfig(p.snapshot))
        )
          throw Error("Publication does not match its source revision");
      });
      for (const a of this.listApprovals(op.id)) {
        const approved = this.getOperation(op.id, a.sourceRevision);
        const config = this.getConfig(approved);
        if (
          approved.metadata.statusId !==
            config.doctrine.publicationRequiredStatus ||
          validate(approved, config).some((f) => f.severity === "error")
        )
          throw Error("Approval refers to an ineligible source revision");
      }
      this.listExports(op.id).forEach((e) => {
        const source = archivedOrderOperation(
          e,
          this.getOperation(op.id, e.sourceRevision),
        );
        verifyDocumentLayout(e, source, (text) =>
          this.hashBinary(new TextEncoder().encode(text)),
        );
        if (
          !e.renderTemplateId ||
          !e.renderTemplateVersion ||
          this.getRenderTemplate(e.renderTemplateId, e.renderTemplateVersion)
            .product !== e.profile.product ||
          canonical(e.profile) !==
            canonical(this.getExportProfile(e.profile.id, e.profile.version)) ||
          canonical(e.config) !== canonical(this.getConfig(source)) ||
          canonical(e.dependencies) !==
            canonical(
              projectVersion(e.projectionVersion, source, e.profile, e.config)
                .dependencies,
            )
        )
          throw Error("Export provenance mismatch");
        if (
          e.sourcePublicationId &&
          !this.listPublications(op.id).some(
            (p) =>
              p.id === e.sourcePublicationId &&
              p.sourceRevision === e.sourceRevision,
          )
        )
          throw Error("Export publication mismatch");
      });
    }
    for (const r of this.db.select().from(tables.exportProfiles).all()) {
      const parsed = exportProfileSchema.parse(JSON.parse(r.document));
      if (
        parsed.id !== r.id ||
        parsed.version !== r.version ||
        parsed.operationId !== r.operationId
      )
        throw Error("Export profile row identity mismatch");
    }
    this.preferences();
  }
}
