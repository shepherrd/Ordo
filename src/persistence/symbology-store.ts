import type Database from "better-sqlite3";
import type { Repository } from "../application/ports";
import type {
  SymbolLibraryKind,
  SymbolLibraryVersion,
  LibraryQuery,
  SymbolLibrarySummary,
  GraphicExportSummary,
} from "../application/symbology-ports";
import {
  savedSymbolVersionSchema,
  type SavedSymbolVersion,
  type SavedSymbolPin,
  type ExactLibraryRef,
  type MilitarySymbolDefinition,
} from "../domain/symbology";
import {
  savedOrbatVersionSchema,
  orbatImportReceiptSchema,
  type SavedOrbatVersion,
  type OrbatImportReceipt,
} from "../domain/orbat";
import {
  graphicExportProfileSchema,
  graphicExportRecordSchema,
  type GraphicExportProfile,
  type GraphicExportRecord,
} from "../domain/graphic-exports";
import { profileSymbol, type UnitProfile } from "../domain/unit-profiles";
import { operationSchema, type Operation } from "../domain/model";
import { canonical } from "../export/projection";
import { hashBytes } from "./modular-store";
import { assertGeneratedSvg } from "../validation/generated-svg";
import { graphicRenderRequestSchema } from "../application/render-requests";
import type {
  ExchangeDependency,
  ExchangeImportReceipt,
} from "../domain/library-exchange";
import { assertExchangeReceipt } from "../application/exchange-receipt";
import { assertNativeExchange } from "../application/native-exchange";
import { parseExchangeJson } from "../application/exchange-json";
import { verifyGraphicV2 } from "../application/verify-graphic-v2";
import { verifyArchivedGraphic } from "../application/archived-graphic-v1";

const tables = { SYMBOL: "saved_symbol", ORBAT: "saved_orbat" } as const;
type Row = {
  id: string;
  family_id: string;
  content_version: number;
  status: string;
  document: string;
  content_hash: string;
  retired_at: string | null;
};
type Pin = {
  source_path: string;
  profile_family_id: string | null;
  profile_version_id: string | null;
  symbol_family_id: string | null;
  symbol_version_id: string | null;
  content_hash: string;
};
const pin = (
  path: string,
  kind: "PROFILE" | "SYMBOL",
  ref: ExactLibraryRef,
): Pin => ({
  source_path: path,
  profile_family_id: kind === "PROFILE" ? ref.familyId : null,
  profile_version_id: kind === "PROFILE" ? ref.versionId : null,
  symbol_family_id: kind === "SYMBOL" ? ref.familyId : null,
  symbol_version_id: kind === "SYMBOL" ? ref.versionId : null,
  content_hash: ref.contentHash,
});
export class SymbologyStore {
  private receiptCache = new Map<
    string,
    { hash: string; receipt: ExchangeImportReceipt }
  >();
  constructor(
    private db: Database.Database,
    private repo: Repository,
    private migrationSql: string,
  ) {}
  lookupExchangeDependency(
    kind: "SYMBOL" | "PROFILE",
    id: string,
  ): ExchangeDependency | null {
    const table =
      kind === "SYMBOL" ? "saved_symbol_versions" : "unit_profile_versions";
    if (!this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))
      return null;
    if (kind === "SYMBOL") {
      const document = this.getSymbol(id);
      return {
        kind,
        document,
        ref: {
          familyId: document.familyId,
          versionId: id,
          contentHash: this.hash("SYMBOL", id),
        },
      };
    }
    const document = this.repo.getUnitProfile(id);
    return {
      kind,
      document,
      ref: {
        familyId: document.unitProfileFamilyId,
        versionId: id,
        contentHash: this.repo.unitProfileHash(id),
      },
    };
  }
  insertExchangeImport(input: ExchangeImportReceipt) {
    const r = assertExchangeReceipt(input, hashBytes);
    this.db
      .prepare("INSERT INTO library_exchange_imports VALUES(?,?,?)")
      .run(r.id, JSON.stringify(r), hashBytes(canonical(r)));
    this.cacheReceipt(r);
  }
  private cacheReceipt(receipt: ExchangeImportReceipt) {
    if (this.receiptCache.size >= 4)
      this.receiptCache.delete(this.receiptCache.keys().next().value!);
    this.receiptCache.set(receipt.id, {
      hash: hashBytes(canonical(receipt)),
      receipt: structuredClone(receipt),
    });
  }
  private originReceipt(id: string) {
    // Immutable receipts are shared by every target in a batch. Rechecking the
    // entire file for each save would make a 2,000-symbol import quadratic.
    const cached = this.receiptCache.get(id),
      row = this.db
        .prepare("SELECT content_hash FROM library_exchange_imports WHERE id=?")
        .get(id) as { content_hash: string } | undefined;
    return cached && row?.content_hash === cached.hash
      ? cached.receipt
      : this.getExchangeImport(id);
  }
  getExchangeImport(id: string): ExchangeImportReceipt {
    const row = this.db
      .prepare(
        "SELECT document,content_hash FROM library_exchange_imports WHERE id=?",
      )
      .get(id) as { document: string; content_hash: string } | undefined;
    if (!row) throw Error("Exchange import receipt not found");
    const r = assertExchangeReceipt(JSON.parse(row.document), hashBytes);
    if (r.id !== id || hashBytes(canonical(r)) !== row.content_hash)
      throw Error("Exchange receipt identity/hash mismatch");
    this.cacheReceipt(r);
    return r;
  }
  private verifyExchangeOrigin(
    kind: SymbolLibraryKind,
    v: SymbolLibraryVersion,
  ) {
    if (!v.exchangeOrigin) return;
    const receipt = this.originReceipt(v.exchangeOrigin.importId);
    if (
      !receipt.targets.some(
        (t) =>
          t.kind === kind &&
          t.value.versionId === v.exchangeOrigin!.targetVersionId,
      )
    )
      throw Error("Missing exchange origin target");
  }
  private get(kind: SymbolLibraryKind, id: string): SymbolLibraryVersion {
    const p = tables[kind];
    if (!p) throw Error("Unknown library kind");
    const row = this.db
      .prepare(
        `SELECT v.*,r.retired_at FROM ${p}_versions v LEFT JOIN ${p}_retirements r ON r.version_id=v.id WHERE v.id=?`,
      )
      .get(id) as Row | undefined;
    if (!row) throw Error(`${kind} version not found`);
    const v = (
      kind === "SYMBOL" ? savedSymbolVersionSchema : savedOrbatVersionSchema
    ).parse(JSON.parse(row.document));
    if (
      v.versionId !== row.id ||
      v.familyId !== row.family_id ||
      v.contentVersion !== row.content_version ||
      v.status !== row.status ||
      hashBytes(canonical(v)) !== row.content_hash
    )
      throw Error("Library identity/content hash mismatch");
    this.verifyExchangeOrigin(kind, v);
    return row.retired_at
      ? { ...v, status: "RETIRED", retiredAt: row.retired_at }
      : v;
  }
  getSymbol(id: string) {
    return this.get("SYMBOL", id) as SavedSymbolVersion;
  }
  getOrbat(id: string) {
    return this.get("ORBAT", id) as SavedOrbatVersion;
  }
  hash(kind: SymbolLibraryKind, id: string) {
    this.get(kind, id);
    return (
      this.db
        .prepare(`SELECT content_hash FROM ${tables[kind]}_versions WHERE id=?`)
        .get(id) as { content_hash: string }
    ).content_hash;
  }
  private checkRef(kind: SymbolLibraryKind, ref: ExactLibraryRef) {
    const v = this.get(kind, ref.versionId);
    if (
      v.familyId !== ref.familyId ||
      v.status === "DRAFT" ||
      this.hash(kind, ref.versionId) !== ref.contentHash
    )
      throw Error("Invalid exact published library reference");
    return v;
  }
  resolveSymbolPin(id: string): SavedSymbolPin {
    const s = this.getSymbol(id);
    if (s.status === "DRAFT")
      throw Error("Select an exact published Saved Symbol");
    return {
      familyId: s.familyId,
      versionId: s.versionId,
      contentHash: this.hash("SYMBOL", id),
      definition: s.definition,
      definitionHash: hashBytes(canonical(s.definition)),
    };
  }
  verifySymbolPin(p: SavedSymbolPin, allowRetired = true) {
    const s = this.getSymbol(p.versionId);
    if (!allowRetired && s.status !== "PUBLISHED")
      throw Error("Select a published non-retired Saved Symbol");
    if (canonical(this.resolveSymbolPin(p.versionId)) !== canonical(p))
      throw Error("Symbol snapshot differs from its exact published source");
  }
  private verifyDefinitionOrigin(d: MilitarySymbolDefinition) {
    if (d.origin.kind === "SAVED_SYMBOL")
      this.checkRef("SYMBOL", d.origin.source);
  }
  private verifySnapshot(s: {
    definition: MilitarySymbolDefinition;
    source: ExactLibraryRef | null;
  }) {
    this.verifyDefinitionOrigin(s.definition);
    if (s.source) {
      const v = this.checkRef("SYMBOL", s.source) as SavedSymbolVersion;
      if (canonical(v.definition) !== canonical(s.definition))
        throw Error("Symbol snapshot differs from its exact published source");
    }
  }
  private orbatPins(v: SavedOrbatVersion): Pin[] {
    const out: Pin[] = [];
    for (const n of v.nodes) {
      const path = `nodes/${n.nodeId}`;
      if (n.unit.kind === "UNIT_PROFILE") {
        const p = this.repo.getUnitProfile(n.unit.source.versionId);
        if (
          p.status === "DRAFT" ||
          p.unitProfileFamilyId !== n.unit.source.familyId ||
          this.repo.unitProfileHash(p.unitProfileVersionId) !==
            n.unit.source.contentHash ||
          canonical(p.identity) !== canonical(n.unit.identity) ||
          canonical(profileSymbol(p)) !== canonical(n.unit.defaultSymbol)
        )
          throw Error(
            "ORBAT profile snapshot differs from its exact published source",
          );
        out.push(pin(`${path}/profile`, "PROFILE", n.unit.source));
        if (n.unit.defaultSymbol) {
          this.verifySymbolPin(n.unit.defaultSymbol);
          out.push(
            pin(`${path}/default-symbol`, "SYMBOL", n.unit.defaultSymbol),
          );
        }
      } else if (n.unit.symbol) {
        this.verifySnapshot(n.unit.symbol);
        if (n.unit.symbol.source)
          out.push(pin(`${path}/symbol`, "SYMBOL", n.unit.symbol.source));
      }
      if (n.symbolOverride) {
        this.verifySnapshot(n.symbolOverride);
        if (n.symbolOverride.source)
          out.push(pin(`${path}/override`, "SYMBOL", n.symbolOverride.source));
      }
    }
    return out.sort((a, b) => a.source_path.localeCompare(b.source_path));
  }
  save(
    kind: SymbolLibraryKind,
    input: SymbolLibraryVersion,
    expected: number | null,
  ) {
    const v = (
        kind === "SYMBOL" ? savedSymbolVersionSchema : savedOrbatVersionSchema
      ).parse(input),
      p = tables[kind];
    this.db.transaction(() => {
      const exists = this.db
          .prepare(`SELECT id FROM ${p}_versions WHERE id=?`)
          .get(v.versionId),
        old = exists ? this.get(kind, v.versionId) : null;
      if (v.status === "RETIRED") throw Error("Use append-only retirement");
      if (old) {
        if (old.status !== "DRAFT")
          throw Error("Published library versions are immutable");
        if (
          expected !== old.contentVersion ||
          v.contentVersion !== old.contentVersion + 1
        )
          throw Error("Library Draft changed; reload before saving");
        for (const key of [
          "familyId",
          "createdAt",
          "parentVersionId",
          "duplicatedFrom",
          "exchangeOrigin",
        ] as const)
          if (canonical(old[key]) !== canonical(v[key]))
            throw Error("Library identity and ancestry are immutable");
      } else if (
        expected !== null ||
        v.contentVersion !== 1 ||
        v.status !== "DRAFT"
      )
        throw Error("Create a new Draft first");
      const duplicateSource = v.duplicatedFrom
        ? this.get(kind, v.duplicatedFrom.versionId)
        : null;
      const predecessor = v.parentVersionId
        ? this.get(kind, v.parentVersionId)
        : duplicateSource;
      if (
        v.parentVersionId &&
        (!predecessor ||
          predecessor.familyId !== v.familyId ||
          predecessor.status === "DRAFT")
      )
        throw Error("Invalid library predecessor");
      if (
        v.duplicatedFrom &&
        (!duplicateSource ||
          duplicateSource.familyId !== v.duplicatedFrom.familyId ||
          duplicateSource.familyId === v.familyId ||
          this.hash(kind, duplicateSource.versionId) !==
            v.duplicatedFrom.contentHash)
      )
        throw Error("Invalid library duplication origin");
      if (kind === "SYMBOL")
        this.verifyDefinitionOrigin((v as SavedSymbolVersion).definition);
      this.verifyExchangeOrigin(kind, v);
      if (!old) {
        if (
          predecessor &&
          canonical(v.exchangeOrigin) !== canonical(predecessor.exchangeOrigin)
        )
          throw Error("Exchange origin must follow library ancestry");
        if (!predecessor && v.exchangeOrigin) {
          const initial = this.originReceipt(
            v.exchangeOrigin.importId,
          ).targets.find(
            (t) => t.kind === kind && t.value.versionId === v.versionId,
          );
          if (!initial || canonical(initial.value) !== canonical(v))
            throw Error("New imported Draft must match its retained receipt");
        }
      }
      const pins =
        kind === "ORBAT" ? this.orbatPins(v as SavedOrbatVersion) : [];
      const prior = old ?? predecessor;
      const oldPins =
        kind === "ORBAT" && prior
          ? this.orbatPins(prior as SavedOrbatVersion)
          : [];
      for (const r of pins) {
        const status = r.profile_version_id
          ? this.repo.getUnitProfile(r.profile_version_id).status
          : this.getSymbol(r.symbol_version_id!).status;
        if (
          status === "RETIRED" &&
          !oldPins.some(
            (x) =>
              x.content_hash === r.content_hash &&
              x.profile_version_id === r.profile_version_id &&
              x.symbol_version_id === r.symbol_version_id,
          )
        )
          throw Error("New selection must not reference a retired version");
      }
      if (!old) {
        this.db
          .prepare(`INSERT OR IGNORE INTO ${p}_families VALUES(?,?)`)
          .run(v.familyId, v.createdAt);
        this.db
          .prepare(`INSERT INTO ${p}_versions VALUES(?,?,?,?,?,?)`)
          .run(
            v.versionId,
            v.familyId,
            v.contentVersion,
            v.status,
            JSON.stringify(v),
            hashBytes(canonical(v)),
          );
      }
      if (kind === "ORBAT") {
        this.db
          .prepare(
            "DELETE FROM saved_orbat_reference_pins WHERE owner_version_id=?",
          )
          .run(v.versionId);
        const insert = this.db.prepare(
          "INSERT INTO saved_orbat_reference_pins VALUES(?,?,?,?,?,?,?)",
        );
        for (const r of pins)
          insert.run(
            v.versionId,
            r.source_path,
            r.profile_family_id,
            r.profile_version_id,
            r.symbol_family_id,
            r.symbol_version_id,
            r.content_hash,
          );
      }
      if (old)
        this.db
          .prepare(
            `UPDATE ${p}_versions SET content_version=?,status=?,document=?,content_hash=? WHERE id=?`,
          )
          .run(
            v.contentVersion,
            v.status,
            JSON.stringify(v),
            hashBytes(canonical(v)),
            v.versionId,
          );
    })();
  }
  retire(kind: SymbolLibraryKind, id: string, at: string) {
    if (this.get(kind, id).status !== "PUBLISHED")
      throw Error("Only a published version may retire");
    this.db
      .prepare(`INSERT INTO ${tables[kind]}_retirements VALUES(?,?)`)
      .run(id, at);
  }
  deleteDraft(kind: SymbolLibraryKind, id: string) {
    const p = tables[kind];
    this.db.transaction(() => {
      if (this.get(kind, id).status !== "DRAFT")
        throw Error("Only unused Drafts may be deleted");
      if (
        this.db
          .prepare(
            `SELECT id FROM ${p}_versions WHERE json_extract(document,'$.parentVersionId')=? OR json_extract(document,'$.duplicatedFrom.versionId')=?`,
          )
          .get(id, id)
      )
        throw Error("Draft has derivation references");
      if (kind === "ORBAT")
        this.db
          .prepare(
            "DELETE FROM saved_orbat_reference_pins WHERE owner_version_id=?",
          )
          .run(id);
      this.db.prepare(`DELETE FROM ${p}_versions WHERE id=?`).run(id);
    })();
  }
  browse(kind: SymbolLibraryKind, q: LibraryQuery) {
    const p = tables[kind],
      from = `FROM ${p}_versions v LEFT JOIN ${p}_retirements r ON r.version_id=v.id`,
      where =
        " WHERE (json_extract(v.document,'$.name') LIKE ? OR json_extract(v.document,'$.tags') LIKE ?) AND (?='' OR CASE WHEN r.version_id IS NULL THEN v.status ELSE 'RETIRED' END=?)";
    const args = [`%${q.search}%`, `%${q.search}%`, q.status, q.status];
    const total = (
      this.db.prepare(`SELECT count(*) n ${from}${where}`).get(...args) as {
        n: number;
      }
    ).n;
    const items = this.db
      .prepare(
        `SELECT v.id versionId,v.family_id familyId,v.content_version contentVersion,json_extract(v.document,'$.name') name,json_extract(v.document,'$.versionLabel') versionLabel,json_extract(v.document,'$.updatedAt') updatedAt,CASE WHEN r.version_id IS NULL THEN v.status ELSE 'RETIRED' END status ${from}${where} ORDER BY updatedAt DESC,v.id LIMIT ? OFFSET ?`,
      )
      .all(...args, q.limit, q.offset) as SymbolLibrarySummary[];
    return { items, total };
  }
  writeProfilePin(v: UnitProfile) {
    this.db
      .prepare("DELETE FROM unit_profile_symbol_pins WHERE owner_version_id=?")
      .run(v.unitProfileVersionId);
    const p = profileSymbol(v);
    if (p) {
      this.verifySymbolPin(p);
      this.db
        .prepare("INSERT INTO unit_profile_symbol_pins VALUES(?,?,?,?,?)")
        .run(
          v.unitProfileVersionId,
          p.familyId,
          p.versionId,
          p.contentHash,
          p.definitionHash,
        );
    }
  }
  verifyProfilePin(v: UnitProfile) {
    const p = profileSymbol(v);
    if (p) this.verifySymbolPin(p);
    const actual =
      this.db
        .prepare(
          "SELECT symbol_family_id,symbol_version_id,content_hash,definition_hash FROM unit_profile_symbol_pins WHERE owner_version_id=?",
        )
        .get(v.unitProfileVersionId) ?? null;
    const expected = p
      ? {
          symbol_family_id: p.familyId,
          symbol_version_id: p.versionId,
          content_hash: p.contentHash,
          definition_hash: p.definitionHash,
        }
      : null;
    if (canonical(actual) !== canonical(expected))
      throw Error("Unit Profile symbol pin index mismatch");
  }
  verifyOperation(op: Operation) {
    for (const u of op.units) {
      if (u.symbol) {
        this.verifySnapshot(u.symbol.base);
        if (u.symbol.override) this.verifySnapshot(u.symbol.override);
      }
      if (u.sourceOrbat) {
        const v = this.checkRef(
          "ORBAT",
          u.sourceOrbat.source,
        ) as SavedOrbatVersion;
        const n = v.nodes.find((n) => n.nodeId === u.sourceOrbat!.nodeId);
        if (!n) throw Error("Missing ORBAT provenance node");
        const original =
          n.unit.kind === "UNIT_PROFILE"
            ? n.unit.defaultSymbol
              ? {
                  definition: n.unit.defaultSymbol.definition,
                  source: {
                    familyId: n.unit.defaultSymbol.familyId,
                    versionId: n.unit.defaultSymbol.versionId,
                    contentHash: n.unit.defaultSymbol.contentHash,
                  },
                }
              : null
            : n.unit.symbol;
        if (original && canonical(u.symbol?.base) !== canonical(original))
          throw Error(
            "Imported inherited symbol differs from the ORBAT source",
          );
      } else if (u.sourceUnitProfile) {
        const p = profileSymbol(
          this.repo.getUnitProfile(
            u.sourceUnitProfile.sourceUnitProfileVersionId,
          ),
        );
        if (
          p &&
          canonical(u.symbol?.base) !==
            canonical({
              definition: p.definition,
              source: {
                familyId: p.familyId,
                versionId: p.versionId,
                contentHash: p.contentHash,
              },
            })
        )
          throw Error(
            "Inherited operation symbol differs from its profile source",
          );
      }
    }
  }
  private operationPins(op: Operation) {
    const pins: {
      unit_id: string;
      source_path: string;
      profile_family_id: string | null;
      profile_version_id: string | null;
      symbol_family_id: string | null;
      symbol_version_id: string | null;
      orbat_family_id: string | null;
      orbat_version_id: string | null;
      content_hash: string;
    }[] = [];
    for (const u of op.units) {
      const add = (
        path: string,
        kind: "SYMBOL" | "ORBAT",
        r: ExactLibraryRef,
      ) =>
        pins.push({
          unit_id: u.id,
          source_path: path,
          profile_family_id: null,
          profile_version_id: null,
          symbol_family_id: kind === "SYMBOL" ? r.familyId : null,
          symbol_version_id: kind === "SYMBOL" ? r.versionId : null,
          orbat_family_id: kind === "ORBAT" ? r.familyId : null,
          orbat_version_id: kind === "ORBAT" ? r.versionId : null,
          content_hash: r.contentHash,
        });
      if (u.sourceOrbat) add("orbat", "ORBAT", u.sourceOrbat.source);
      if (u.symbol?.base.source)
        add("symbol/base", "SYMBOL", u.symbol.base.source);
      if (u.symbol?.override?.source)
        add("symbol/override", "SYMBOL", u.symbol.override.source);
    }
    return pins.sort((a, b) =>
      `${a.unit_id}/${a.source_path}`.localeCompare(
        `${b.unit_id}/${b.source_path}`,
      ),
    );
  }
  indexOperation(op: Operation) {
    const stmt = this.db.prepare(
      "INSERT INTO operation_symbology_source_pins VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const p of this.operationPins(op))
      stmt.run(
        op.id,
        op.revision,
        p.unit_id,
        p.source_path,
        p.profile_family_id,
        p.profile_version_id,
        p.symbol_family_id,
        p.symbol_version_id,
        p.orbat_family_id,
        p.orbat_version_id,
        p.content_hash,
      );
  }
  getImport(op: string, id: string): OrbatImportReceipt | null {
    const row = this.db
      .prepare(
        "SELECT * FROM operation_orbat_imports WHERE operation_id=? AND import_id=?",
      )
      .get(op, id) as
      | {
          document: string;
          content_hash: string;
          revision: number;
          orbat_family_id: string;
          orbat_version_id: string;
        }
      | undefined;
    if (!row) return null;
    const r = orbatImportReceiptSchema.parse(JSON.parse(row.document));
    if (
      r.operationId !== op ||
      r.importId !== id ||
      r.revision !== row.revision ||
      r.source.familyId !== row.orbat_family_id ||
      r.source.versionId !== row.orbat_version_id ||
      hashBytes(canonical(r)) !== row.content_hash
    )
      throw Error("ORBAT import receipt mismatch");
    return r;
  }
  insertImport(input: OrbatImportReceipt) {
    const r = orbatImportReceiptSchema.parse(input);
    this.checkRef("ORBAT", r.source);
    const op = this.repo.getOperation(r.operationId, r.revision);
    const source = this.getOrbat(r.source.versionId);
    if (
      r.nodeMap.length !== source.nodes.length ||
      r.nodeMap.some(
        (m) =>
          !source.nodes.some((n) => n.nodeId === m.nodeId) ||
          !op.units.some(
            (u) =>
              u.id === m.unitId &&
              u.sourceOrbat?.importId === r.importId &&
              u.sourceOrbat.nodeId === m.nodeId &&
              canonical(u.sourceOrbat.source) === canonical(r.source),
          ),
      )
    )
      throw Error("Import receipt does not match its committed revision");
    this.db
      .prepare("INSERT INTO operation_orbat_imports VALUES(?,?,?,?,?,?,?)")
      .run(
        r.operationId,
        r.importId,
        r.revision,
        r.source.familyId,
        r.source.versionId,
        JSON.stringify(r),
        hashBytes(canonical(r)),
      );
  }
  saveGraphicProfile(input: GraphicExportProfile) {
    const p = graphicExportProfileSchema.parse(input);
    const old = this.db
      .prepare(
        "SELECT document FROM graphic_export_profile_versions WHERE id=? AND version=?",
      )
      .get(p.id, p.version) as { document: string } | undefined;
    if (old) {
      if (canonical(JSON.parse(old.document)) !== canonical(p))
        throw Error("Graphic export profile version is immutable");
      return;
    }
    this.db
      .prepare("INSERT INTO graphic_export_profile_versions VALUES(?,?,?,?)")
      .run(p.id, p.version, JSON.stringify(p), hashBytes(canonical(p)));
  }
  getGraphicProfile(id: string, version: number) {
    const row = this.db
      .prepare(
        "SELECT document,content_hash FROM graphic_export_profile_versions WHERE id=? AND version=?",
      )
      .get(id, version) as
      { document: string; content_hash: string } | undefined;
    if (!row) throw Error("Graphic export profile not found");
    const p = graphicExportProfileSchema.parse(JSON.parse(row.document));
    if (
      p.id !== id ||
      p.version !== version ||
      hashBytes(canonical(p)) !== row.content_hash
    )
      throw Error("Graphic profile identity/hash mismatch");
    return p;
  }
  private verifyGraphic(r: GraphicExportRecord, bytes: Uint8Array) {
    verifyGraphicV2(
      r,
      bytes,
      hashBytes,
      r.source.kind === "OPERATION" && r.schemaVersion === 2
        ? this.repo.getOperation(r.source.operationId, r.source.revision)
        : undefined,
    );
    if (bytes.byteLength !== r.byteLength || hashBytes(bytes) !== r.contentHash)
      throw Error("Graphic output hash/length mismatch");
    if (r.mimeType === "image/svg+xml") {
      assertGeneratedSvg(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } else if (r.mimeType === "image/png") {
      const png = Buffer.from(bytes);
      if (
        png.length < 45 ||
        !png
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        png.readUInt32BE(8) !== 13 ||
        png.toString("ascii", 12, 16) !== "IHDR" ||
        png.readUInt32BE(16) !== r.raster!.width ||
        png.readUInt32BE(20) !== r.raster!.height ||
        !png
          .subarray(-12)
          .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
      )
        throw Error("PNG output dimensions or container mismatch");
    } else if (r.schemaVersion === 3) {
      verifyArchivedGraphic(
        r,
        bytes,
        hashBytes,
        r.source.kind === "OPERATION"
          ? this.repo.getOperation(r.source.operationId, r.source.revision)
          : undefined,
      );
    } else if (r.profile.jsonMode === "NATIVE_EXCHANGE") {
      if (
        r.source.kind === "OPERATION" ||
        r.renderManifests.length ||
        r.layoutVersion !== null
      )
        throw Error("Invalid native exchange artifact composition");
      const envelope = assertNativeExchange(
        parseExchangeJson(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ),
        hashBytes,
      );
      if (
        envelope.root.kind !==
          (r.source.kind === "SAVED_SYMBOL" ? "SYMBOL" : "ORBAT") ||
        canonical(envelope.root.value) !== canonical(r.source.snapshot) ||
        canonical(r.dependencies) !==
          canonical([
            { path: "exchange/envelope", canonicalValue: canonical(envelope) },
          ])
      )
        throw Error("Native exchange artifact source or dependency mismatch");
    } else {
      const request = graphicRenderRequestSchema.parse(
        JSON.parse(
          r.dependencies.find((d) => d.path === "graphic/request")
            ?.canonicalValue ?? "null",
        ),
      );
      const expected = {
        schemaVersion: 1,
        format: "ORDO_GRAPHIC",
        projectionVersion: 5,
        source:
          r.source.kind === "OPERATION"
            ? r.source
            : {
                kind: r.source.kind,
                ref: r.source.ref,
                contentVersion: r.source.contentVersion,
              },
        profile: r.profile,
        renderManifests: r.renderManifests,
        request,
      };
      const actual = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      if (canonical(actual) !== canonical(expected))
        throw Error("Graphic JSON provenance or payload mismatch");
    }
    const p = this.getGraphicProfile(r.profile.id, r.profile.version);
    if (
      canonical(p) !== canonical(r.profile) ||
      hashBytes(canonical(p)) !== r.profileHash
    )
      throw Error("Graphic profile manifest mismatch");
    if (r.source.kind === "OPERATION") {
      const op = this.repo.getOperation(
        r.source.operationId,
        r.source.revision,
      );
      if (hashBytes(canonical(op)) !== r.source.contentHash)
        throw Error("Graphic operation source mismatch");
      const publicationId = r.source.publicationId;
      if (
        publicationId &&
        !this.repo
          .listPublications(op.id)
          .some(
            (p) => p.id === publicationId && p.sourceRevision === op.revision,
          )
      )
        throw Error("Graphic publication source mismatch");
    } else {
      const s = r.source,
        kind = s.kind === "SAVED_SYMBOL" ? "SYMBOL" : "ORBAT";
      this.get(kind, s.ref.versionId);
      if (hashBytes(canonical(s.snapshot)) !== s.ref.contentHash)
        throw Error("Graphic source snapshot hash mismatch");
      if (
        s.snapshot.status !== "DRAFT" &&
        this.hash(kind, s.ref.versionId) !== s.ref.contentHash
      )
        throw Error("Published graphic source mismatch");
    }
  }
  insertGraphic(input: GraphicExportRecord, bytes: Uint8Array) {
    const r = graphicExportRecordSchema.parse(input);
    this.verifyGraphic(r, bytes);
    const s = r.source;
    this.db
      .prepare("INSERT INTO graphic_exports VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        r.id,
        s.kind === "SAVED_SYMBOL" ? s.ref.versionId : null,
        s.kind === "SAVED_ORBAT" ? s.ref.versionId : null,
        s.kind === "OPERATION" ? s.operationId : null,
        s.kind === "OPERATION" ? s.revision : null,
        s.kind === "OPERATION" ? s.publicationId : null,
        r.profile.id,
        r.profile.version,
        JSON.stringify(r),
        Buffer.from(bytes),
        r.contentHash,
      );
  }
  getGraphic(id: string) {
    const row = this.db
      .prepare("SELECT * FROM graphic_exports WHERE id=?")
      .get(id) as
      | {
          document: string;
          bytes: Buffer;
          content_hash: string;
          profile_id: string;
          profile_version: number;
          symbol_version_id: string | null;
          orbat_version_id: string | null;
          operation_id: string | null;
          revision: number | null;
          publication_id: string | null;
        }
      | undefined;
    if (!row) throw Error("Graphic export not found");
    const r = graphicExportRecordSchema.parse(JSON.parse(row.document)),
      s = r.source;
    if (
      r.id !== id ||
      row.content_hash !== r.contentHash ||
      row.profile_id !== r.profile.id ||
      row.profile_version !== r.profile.version ||
      row.symbol_version_id !==
        (s.kind === "SAVED_SYMBOL" ? s.ref.versionId : null) ||
      row.orbat_version_id !==
        (s.kind === "SAVED_ORBAT" ? s.ref.versionId : null) ||
      row.operation_id !== (s.kind === "OPERATION" ? s.operationId : null) ||
      row.revision !== (s.kind === "OPERATION" ? s.revision : null) ||
      row.publication_id !== (s.kind === "OPERATION" ? s.publicationId : null)
    )
      throw Error("Graphic export row binding mismatch");
    this.verifyGraphic(r, row.bytes);
    return { record: r, bytes: row.bytes };
  }
  listGraphics() {
    return this.db
      .prepare(
        "SELECT id,json_extract(document,'$.source.kind') sourceKind,coalesce(json_extract(document,'$.source.snapshot.name'),json_extract(document,'$.profile.name')) name,json_extract(document,'$.profile.format') format,json_extract(document,'$.generatedAt') generatedAt,json_extract(document,'$.byteLength') byteLength,content_hash contentHash,profile_id profileId,profile_version profileVersion FROM graphic_exports ORDER BY json_extract(document,'$.generatedAt') DESC LIMIT 100",
      )
      .all() as GraphicExportSummary[];
  }
  verifyAll() {
    this.receiptCache.clear();
    const normalize = (sql: string) =>
      sql.replace(/\s+/g, " ").trim().replace(/;$/, "");
    const definitions = new Map(
      [
        ...this.migrationSql.matchAll(
          /CREATE TRIGGER\s+"?([a-zA-Z0-9_]+)"?[\s\S]*?END;/g,
        ),
      ].map((m) => [m[1], m[0]]),
    );
    for (const [name, sql] of definitions) {
      const actual = this.db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
        )
        .get(name) as { sql: string } | undefined;
      if (!actual || normalize(actual.sql) !== normalize(sql))
        throw Error("Missing or altered M6 history protection");
    }
    for (const row of this.db
      .prepare("SELECT id FROM library_exchange_imports")
      .all() as { id: string }[])
      this.getExchangeImport(row.id);
    for (const kind of ["SYMBOL", "ORBAT"] as const)
      for (const row of this.db
        .prepare(`SELECT id FROM ${tables[kind]}_versions`)
        .all() as { id: string }[]) {
        const v = this.get(kind, row.id);
        if (kind === "SYMBOL")
          this.verifyDefinitionOrigin((v as SavedSymbolVersion).definition);
        else {
          const pins = this.orbatPins(v as SavedOrbatVersion),
            actual = this.db
              .prepare(
                "SELECT source_path,profile_family_id,profile_version_id,symbol_family_id,symbol_version_id,content_hash FROM saved_orbat_reference_pins WHERE owner_version_id=? ORDER BY source_path",
              )
              .all(v.versionId);
          if (canonical(actual) !== canonical(pins))
            throw Error("ORBAT reference index mismatch");
        }
      }
    for (const r of this.db
      .prepare("SELECT id FROM unit_profile_versions")
      .all() as { id: string }[])
      this.verifyProfilePin(this.repo.getUnitProfile(r.id));
    for (const row of this.db
      .prepare("SELECT snapshot FROM operation_revisions")
      .all() as { snapshot: string }[]) {
      const op = operationSchema.parse(JSON.parse(row.snapshot));
      this.verifyOperation(op);
      const actual = this.db
        .prepare(
          "SELECT unit_id,source_path,profile_family_id,profile_version_id,symbol_family_id,symbol_version_id,orbat_family_id,orbat_version_id,content_hash FROM operation_symbology_source_pins WHERE operation_id=? AND revision=? ORDER BY unit_id,source_path",
        )
        .all(op.id, op.revision);
      if (canonical(actual) !== canonical(this.operationPins(op)))
        throw Error("Operation symbol provenance index mismatch");
    }
    for (const r of this.db
      .prepare("SELECT operation_id,import_id FROM operation_orbat_imports")
      .all() as { operation_id: string; import_id: string }[]) {
      const receipt = this.getImport(r.operation_id, r.import_id)!;
      this.checkRef("ORBAT", receipt.source);
      const source = this.getOrbat(receipt.source.versionId),
        op = this.repo.getOperation(receipt.operationId, receipt.revision);
      if (
        receipt.nodeMap.length !== source.nodes.length ||
        receipt.nodeMap.some(
          (m) =>
            !source.nodes.some((n) => n.nodeId === m.nodeId) ||
            !op.units.some(
              (u) =>
                u.id === m.unitId &&
                u.sourceOrbat?.importId === receipt.importId &&
                u.sourceOrbat.nodeId === m.nodeId &&
                canonical(u.sourceOrbat.source) === canonical(receipt.source),
            ),
        )
      )
        throw Error("Import receipt unit map mismatch");
    }
    for (const r of this.db
      .prepare("SELECT id,version FROM graphic_export_profile_versions")
      .all() as { id: string; version: number }[])
      this.getGraphicProfile(r.id, r.version);
    for (const r of this.db.prepare("SELECT id FROM graphic_exports").all() as {
      id: string;
    }[])
      this.getGraphic(r.id);
  }
}
