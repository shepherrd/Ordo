import type Database from "better-sqlite3";
import type { SearchRepository } from "../application/search-service";
import {
  assetSearchDocuments,
  catalogSearchDocuments,
  operationSearchDocuments,
} from "../domain/search-documents";
import {
  normalizeSearch,
  searchTerms,
  searchExcerpt,
  type SearchDocument,
  type SearchRequest,
  type SearchResolve,
} from "../domain/search";
import { targetKey } from "../domain/planning-target";
import type { Operation, ResolvedConfig } from "../domain/model";
import type { CatalogItem } from "../domain/catalog";
import type { ManagedAsset } from "../domain/modules";
import type { SearchUsageRequest } from "../domain/search";
import { planningReferences, referenceMatches } from "../domain/planning-usage";

const format = 5;
export const searchDerivedTables = [
  "search_owners",
  "search_documents",
  "search_fts",
  "search_fts_data",
  "search_fts_idx",
  "search_fts_docsize",
  "search_fts_config",
];
const sources = `SELECT 'operation:'||id owner,CAST(revision AS TEXT) token FROM operations
 UNION ALL SELECT 'catalog:'||c.id,
   c.edit_token || CASE WHEN c.kind='ORGANIZATION'
     AND json_extract(c.document,'$.content.orbatWorkspace.orbatId') IS NOT NULL
     THEN ':' || coalesce(o.edit_token,'missing') ELSE '' END
   FROM catalog_items c LEFT JOIN catalog_items o
     ON c.kind='ORGANIZATION' AND o.kind='ORBAT'
     AND o.id=json_extract(c.document,'$.content.orbatWorkspace.orbatId')
 UNION ALL SELECT 'file:'||id,json_extract(document,'$.sha256') FROM managed_assets`;
export class SearchStore implements SearchRepository {
  private cursor = "";
  private rebuilding = true;
  indexError?: string;
  constructor(
    private db: Database.Database,
    private operation: (id: string) => Operation,
    private config: (op: Operation) => ResolvedConfig,
    private cardOrigins: (op: Operation) => Record<string, string> = () => ({}),
  ) {
    db.prepare(
      "DELETE FROM search_owners WHERE owner NOT IN (SELECT owner FROM (" +
        sources +
        "))",
    ).run();
  }
  replace(owner: string, token: string, entries: SearchDocument[]) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM search_owners WHERE owner=?").run(owner);
      this.db
        .prepare("INSERT INTO search_owners VALUES(?,?,?,?)")
        .run(owner, token, format, entries.length);
      const insert = this.db.prepare(
        "INSERT INTO search_documents VALUES(?,?,?,?,?,?,?,?,?)",
      );
      for (const d of entries)
        insert.run(
          d.id,
          owner,
          d.operationId,
          d.type,
          d.title,
          normalizeSearch(d.title),
          normalizeSearch(d.code),
          normalizeSearch(d.text),
          JSON.stringify(d),
        );
    })();
  }
  indexOperation(op: Operation) {
    this.replace(
      "operation:" + op.id,
      String(op.revision),
      operationSearchDocuments(op, this.config(op)),
    );
  }
  indexCatalog(item: CatalogItem, token: string) {
    this.indexCatalogOwner(item, token);
    // Catalog saves and their dependent search entries share the caller's transaction.
    if (item.kind === "ORBAT") {
      const organizations = this.db
        .prepare(
          "SELECT document,edit_token FROM catalog_items WHERE kind='ORGANIZATION' AND json_extract(document,'$.content.orbatWorkspace.orbatId')=?",
        )
        .all(item.id) as { document: string; edit_token: string }[];
      for (const organization of organizations)
        this.indexCatalogOwner(
          JSON.parse(organization.document),
          organization.edit_token,
        );
    }
  }
  private indexCatalogOwner(item: CatalogItem, token: string) {
    const orbatId =
      item.kind === "ORGANIZATION"
        ? item.content.orbatWorkspace?.orbatId
        : null;
    const row = orbatId
      ? (this.db
          .prepare(
            "SELECT document,edit_token FROM catalog_items WHERE id=? AND kind='ORBAT'",
          )
          .get(orbatId) as { document: string; edit_token: string } | undefined)
      : undefined;
    const orbat: CatalogItem | undefined = row && JSON.parse(row.document);
    const sourceToken = orbatId
      ? token + ":" + (row?.edit_token ?? "missing")
      : token;
    this.replace(
      "catalog:" + item.id,
      sourceToken,
      catalogSearchDocuments(
        item,
        sourceToken,
        orbat?.kind === "ORBAT"
          ? { id: orbat.id, nodes: orbat.content.nodes }
          : null,
      ),
    );
  }
  indexAsset(asset: ManagedAsset) {
    this.replace(
      "file:" + asset.assetId,
      asset.sha256,
      assetSearchDocuments(asset),
    );
  }
  usage(request: SearchUsageRequest) {
    const rows = this.db
      .prepare("SELECT id FROM operations ORDER BY id")
      .all() as { id: string }[];
    const references = rows
      .filter((r) => !request.excludedOwners.includes("operation:" + r.id))
      .flatMap((r) => {
        const op = this.operation(r.id);
        return planningReferences(
          op,
          this.config(op),
          this.cardOrigins(op),
        ).filter((ref) => referenceMatches(ref.to, request.target));
      });
    return {
      references: references.slice(request.offset, request.offset + 50),
      more: references.length > request.offset + 50,
    };
  }
  /** At most 16 owners per turn. Source writes update atomically even while this runs. */
  rebuildBatch(limit = 16): boolean {
    if (!this.rebuilding) return true;
    const rows = this.db
      .prepare(
        `SELECT s.owner,s.token,o.source_token,o.format,o.entry_count,(SELECT count(*) FROM search_documents d WHERE d.owner=s.owner) actual FROM (${sources}) s LEFT JOIN search_owners o ON o.owner=s.owner WHERE s.owner>? ORDER BY s.owner LIMIT ?`,
      )
      .all(this.cursor, limit) as {
      owner: string;
      token: string;
      source_token: string;
      format: number;
      entry_count: number;
      actual: number;
    }[];
    for (const r of rows) {
      if (
        r.token !== r.source_token ||
        r.format !== format ||
        r.entry_count !== r.actual
      ) {
        const id = r.owner.slice(r.owner.indexOf(":") + 1);
        if (r.owner.startsWith("operation:"))
          this.indexOperation(this.operation(id));
        else if (r.owner.startsWith("catalog:")) {
          const row = this.db
            .prepare("SELECT document,edit_token FROM catalog_items WHERE id=?")
            .get(id) as { document: string; edit_token: string };
          this.indexCatalogOwner(JSON.parse(row.document), row.edit_token);
        } else {
          const row = this.db
            .prepare("SELECT document FROM managed_assets WHERE id=?")
            .get(id) as { document: string };
          this.indexAsset(JSON.parse(row.document));
        }
      }
      this.cursor = r.owner;
    }
    this.rebuilding = rows.length === limit;
    return !this.rebuilding;
  }
  query(r: SearchRequest) {
    const terms = searchTerms(r.query);
    if (!terms.length)
      return {
        hits: [],
        more: false,
        complete: !this.rebuilding,
        indexError: this.indexError,
      };
    // Older indexes are rebuilt in batches; do not return deferred pages in the meantime.
    const where = ["search_fts MATCH ?", "d.type != 'briefing'"],
      args: (string | number)[] = [
        terms.map((t) => '"' + t + '"*').join(" AND "),
      ];
    if (r.operationId) {
      where.push("d.operation_id=?");
      args.push(r.operationId);
    }
    if (r.type) {
      where.push("d.type=?");
      args.push(r.type);
    }
    if (r.phaseId) {
      where.push(
        "EXISTS (SELECT 1 FROM json_each(d.document,'$.phaseIds') WHERE value=?)",
      );
      args.push(r.phaseId);
    }
    if (r.staffId) {
      where.push(
        "EXISTS (SELECT 1 FROM json_each(d.document,'$.staffIds') WHERE value=?)",
      );
      args.push(r.staffId);
    }
    if (r.excludedOwners.length) {
      where.push(
        "d.owner NOT IN (" + r.excludedOwners.map(() => "?").join(",") + ")",
      );
      args.push(...r.excludedOwners);
    }
    const titleMatch = terms
      .map(() => "instr(' '||d.norm_title||' '||d.norm_code,?)>0")
      .join(" AND ");
    const score = `CASE WHEN d.norm_title=? OR d.norm_code=? THEN 0 WHEN ${titleMatch} THEN 1 ELSE 2 END`;
    const normalized = normalizeSearch(r.query);
    const rows = this.db
      .prepare(
        `SELECT d.document,${score} score FROM search_fts JOIN search_documents d ON d.rowid=search_fts.rowid WHERE ${where.join(" AND ")} ORDER BY score,length(d.title),d.id LIMIT ? OFFSET ?`,
      )
      .all(
        normalized,
        normalized,
        ...terms.map((t) => " " + t),
        ...args,
        r.limit + 1,
        r.offset,
      ) as { document: string; score: number }[];
    return {
      hits: rows.slice(0, r.limit).map((row) => {
        const d: SearchDocument = JSON.parse(row.document);
        return {
          ...d,
          score: row.score,
          excerpt: searchExcerpt(d.text, r.query),
          state: "Saved" as const,
        };
      }),
      more: rows.length > r.limit,
      complete: !this.rebuilding,
      indexError: this.indexError,
    };
  }
  resolve(r: SearchResolve): SearchDocument | null {
    const t = r.target;
    if (t.area === "operation" && t.target.kind === "briefing") return null;
    const owner =
      t.area === "operation"
        ? "operation:" + t.operationId
        : t.area === "catalog"
          ? "catalog:" + t.catalogId
          : "file:" + t.assetId;
    const row = this.db
      .prepare("SELECT document FROM search_documents WHERE id=?")
      .get(owner + ":" + targetKey(t)) as { document: string } | undefined;
    return row ? (JSON.parse(row.document) as SearchDocument) : null;
  }
}
