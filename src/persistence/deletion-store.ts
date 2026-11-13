import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { canonical } from "../export/projection";
import { searchDerivedTables } from "./search-store";
import type {
  DeletionPreview,
  DeletionRepository,
  DeletionTarget,
} from "../application/deletion-service";

type Value = string | number | null | Buffer;
type Row = Record<string, Value>;
type Selected = { table: string; keys: Value[]; hash: string };
type Column = { name: string; pk: number };
const q = (name: string) => `"${name.replaceAll('"', '""')}"`;
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const token = (table: string, keys: Value[]) =>
  `${table}:${JSON.stringify(keys)}`;

// The permit exists only on this connection and only around one synchronous
// transaction. It cannot be created by writing a table or preserved in a backup.
export class DeletionGate {
  private allowed = new Set<string>();
  constructor(db: Database.Database) {
    db.function("ordo_permanent_delete_allowed", (table, keys) =>
      this.allowed.has(`${String(table)}:${String(keys)}`) ? 1 : 0,
    );
  }
  run<T>(rows: Selected[], work: () => T): T {
    if (this.allowed.size)
      throw Error("Permanent deletion is already in progress");
    this.allowed = new Set(rows.map((r) => token(r.table, r.keys)));
    try {
      return work();
    } finally {
      this.allowed.clear();
    }
  }
}

const labels: Record<string, string> = {
  operations: "Operation",
  operation_revisions: "Saved revisions",
  publications: "Published orders",
  revision_approvals: "Approvals",
  change_reviews: "Change reviews",
  exports: "Retained HTML exports",
  document_exports: "Retained PDFs",
  briefing_exports: "Retained briefing PDFs",
  office_exports: "Retained Office exports",
  whiteboard_snapshots: "Whiteboard snapshots",
  alternative_plans: "Alternative plan origins",
  whiteboard_snapshot_assets: "Snapshot image origins",
  graphic_exports: "Retained graphic exports",
  managed_assets: "Managed files",
  working_drafts: "Recovery copies",
  export_profile_versions: "Export profile versions",
  saved_symbol_versions: "Symbol versions",
  saved_orbat_versions: "ORBAT versions",
  unit_profile_versions: "Organization profile versions",
  doctrine_versions: "Doctrine versions",
  graphic_export_profile_versions: "Graphic profile versions",
};
const sources = {
  operation: "operations",
  symbol: "saved_symbol_versions",
  orbat: "saved_orbat_versions",
  "unit-profile": "unit_profile_versions",
  doctrine: "doctrine_versions",
  "export-profile": "export_profile_versions",
  asset: "managed_assets",
} as const;

export class DeletionStore implements DeletionRepository {
  constructor(
    private db: Database.Database,
    private gate: DeletionGate,
    private verify: () => void,
  ) {}
  prepareDeletion(target: DeletionTarget) {
    return this.plan(target).preview;
  }

  private plan(target: DeletionTarget) {
    const tableNames = (
      this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .filter((name) => !searchDerivedTables.includes(name));
    const columns = new Map(
      tableNames.map((t) => [
        t,
        this.db.prepare(`PRAGMA table_info(${q(t)})`).all() as Column[],
      ]),
    );
    const pk = (table: string) =>
      columns
        .get(table)!
        .filter((c) => c.pk)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
    const keys = (table: string, row: Row) => pk(table).map((c) => row[c]);
    const selected = new Map<string, Selected>();
    const add = (table: string, row: Row) => {
      const key = keys(table, row);
      if (!key.length) throw Error(`Missing deletion identity for ${table}`);
      const values = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          Buffer.isBuffer(v) ? { bytes: v.byteLength, sha256: digest(v) } : v,
        ]),
      );
      selected.set(token(table, key), {
        table,
        keys: key,
        hash: digest(canonical(values)),
      });
    };
    const take = (table: string, where: string, values: Value[]) => {
      for (const row of this.db
        .prepare(`SELECT * FROM ${q(table)} WHERE ${where}`)
        .iterate(...values) as Iterable<Row>)
        add(table, row);
    };
    const sourceTable = sources[target.kind];
    const source = this.db
      .prepare(
        `SELECT * FROM ${q(sourceTable)} WHERE id=? ORDER BY rowid DESC LIMIT 1`,
      )
      .get(target.id) as Row | undefined;
    if (!source)
      throw Error("This item no longer exists. Refresh its catalog.");
    const document = JSON.parse(String(source.document));
    const name: string =
      document.name ??
      document.identity?.fullDesignation ??
      document.displayName ??
      document.originalFilename ??
      document.originalName ??
      document.fileName ??
      target.kind;
    const version: string | null =
      target.kind === "export-profile"
        ? "all saved versions"
        : (document.versionLabel ?? null);
    const blockers = new Set<string>();
    const targetIds = new Set([target.id]);
    let configuration: { id: string; version: number } | null = null;
    if (target.kind === "doctrine" && document.sourceKind === "BUNDLED")
      blockers.add("Bundled doctrine is part of Ordo and cannot be deleted.");

    if (target.kind === "operation") {
      add(sourceTable, source);
      for (const table of tableNames)
        if (columns.get(table)!.some((c) => c.name === "operation_id"))
          take(table, "operation_id=?", [target.id]);
      take(
        "export_templates",
        "export_id IN (SELECT id FROM exports WHERE operation_id=?)",
        [target.id],
      );
      take(
        "whiteboard_snapshot_assets",
        "snapshot_id IN (SELECT id FROM whiteboard_snapshots WHERE operation_id=?)",
        [target.id],
      );
      for (const table of ["change_review_changes", "change_review_events"])
        take(
          table,
          "review_id IN (SELECT id FROM change_reviews WHERE operation_id=?)",
          [target.id],
        );
      take(
        "working_drafts",
        "json_extract(document,'$.scope')=? OR (kind='operation' AND source_id=?)",
        [target.id, target.id],
      );
    } else if (target.kind === "export-profile") {
      take(sourceTable, "id=?", [target.id]);
      take("working_drafts", "kind='export-profile' AND source_id=?", [
        target.id,
      ]);
    } else {
      add(sourceTable, source);
      if (target.kind === "asset")
        take("whiteboard_snapshot_assets", "asset_id=?", [target.id]);
      const prefix =
        target.kind === "symbol"
          ? "saved_symbol"
          : target.kind === "orbat"
            ? "saved_orbat"
            : target.kind === "unit-profile"
              ? "unit_profile"
              : null;
      if (prefix) {
        take(`${prefix}_retirements`, "version_id=?", [target.id]);
        if (
          !this.db
            .prepare(
              `SELECT 1 FROM ${q(prefix + "_versions")} WHERE family_id=? AND id!=? LIMIT 1`,
            )
            .get(source.family_id, target.id)
        )
          take(`${prefix}_families`, "id=?", [source.family_id]);
      }
      if (target.kind === "orbat")
        take("saved_orbat_reference_pins", "owner_version_id=?", [target.id]);
      if (target.kind === "symbol" || target.kind === "orbat")
        take(
          "graphic_exports",
          `${target.kind === "symbol" ? "symbol" : "orbat"}_version_id=?`,
          [target.id],
        );
      if (target.kind === "unit-profile") {
        take("unit_profile_relationships", "parent_version_id=?", [target.id]);
        take("unit_profile_symbol_pins", "owner_version_id=?", [target.id]);
        take("managed_assets", "unit_profile_version_id=?", [target.id]);
      }
      if (target.kind === "doctrine") {
        configuration = {
          id: String(source.family_id),
          version: Number(source.profile_version),
        };
        take("doctrine_retirements", "version_id=?", [target.id]);
        take("managed_assets", "doctrine_version_id=?", [target.id]);
        take("profile_versions", "id=? AND version=?", [
          configuration.id,
          configuration.version,
        ]);
        take("doctrine_nodes", "profile_id=? AND profile_version=?", [
          configuration.id,
          configuration.version,
        ]);
      }
      take("working_drafts", "kind=? AND source_id=?", [
        target.kind,
        target.id,
      ]);
    }
    for (const row of selected.values())
      if (row.table === "managed_assets" || row.table === "graphic_exports")
        targetIds.add(String(row.keys[0]));

    const rowLabel = (table: string, row: Row) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(String(row.document ?? row.snapshot ?? "{}"));
      } catch {
        /* Foreign-key-only row. */
      }
      const operationId = row.operation_id ?? data.operationId;
      if (operationId) {
        const op = this.db
          .prepare(
            "SELECT json_extract(document,'$.name') name FROM operations WHERE id=?",
          )
          .get(operationId) as { name: string } | undefined;
        if (op) return `Operation “${op.name}” (${operationId})`;
      }
      const title =
        data.name ??
        data.displayName ??
        (data.identity as { fullDesignation?: string } | undefined)
          ?.fullDesignation ??
        data.label;
      return `${labels[table] ?? table.replaceAll("_", " ")}${title ? ` “${String(title)}”` : ""} (${keys(table, row).join(", ")})`;
    };

    // Foreign keys remain enabled. Show their incoming dependencies before any
    // delete, including pins in old revisions and immutable published versions.
    for (const table of tableNames) {
      const fks = this.db
        .prepare(`PRAGMA foreign_key_list(${q(table)})`)
        .all() as {
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
      }[];
      for (const id of new Set(fks.map((f) => f.id))) {
        const relation = fks
            .filter((f) => f.id === id)
            .sort((a, b) => a.seq - b.seq),
          referenced = relation[0].table;
        if (![...selected.values()].some((r) => r.table === referenced))
          continue;
        const rightKeys = pk(referenced);
        const join = relation
          .map((f) => `s.${q(f.from)}=t.${q(f.to)}`)
          .join(" AND ");
        const extra = rightKeys
          .map((c, i) => `t.${q(c)} AS ${q(`__target_${i}`)}`)
          .join(",");
        for (const row of this.db
          .prepare(
            `SELECT s.*,${extra} FROM ${q(table)} s JOIN ${q(referenced)} t ON ${join}`,
          )
          .iterate() as Iterable<Row>) {
          if (
            !selected.has(token(table, keys(table, row))) &&
            selected.has(
              token(
                referenced,
                rightKeys.map((_, i) => row[`__target_${i}`]),
              ),
            )
          )
            blockers.add(rowLabel(table, row));
        }
      }
    }
    // Structured JSON also carries derivation references and independent source
    // pins. Import receipts are self-contained evidence, not live dependencies.
    const refers = (value: unknown): boolean => {
      const pending: unknown[] = [value];
      while (pending.length) {
        const item = pending.pop();
        if (typeof item === "string") {
          if (
            targetIds.has(item) ||
            (item.startsWith("asset:") && targetIds.has(item.slice(6)))
          )
            return true;
        } else if (item && typeof item === "object") {
          const object = item as Record<string, unknown>;
          if (
            configuration &&
            ((object.id === configuration.id &&
              object.version === configuration.version) ||
              (object.doctrineFamilyId === configuration.id &&
                object.doctrineVersion === configuration.version))
          )
            return true;
          // An independent planning card retains source evidence, not a live dependency.
          pending.push(
            ...Object.entries(object)
              .filter(
                ([key]) => !(object.mode === "independent" && key === "origin"),
              )
              .map(([, child]) => child),
          );
        }
      }
      return false;
    };
    for (const table of tableNames) {
      // Alternative origins contain a self-contained baseline, not a live link.
      // Current and historical alternative operations still protect their resources.
      if (
        [
          "preferences",
          "library_exchange_imports",
          "alternative_plans",
        ].includes(table)
      )
        continue;
      const jsonColumns = columns
        .get(table)!
        .filter((c) => ["document", "snapshot"].includes(c.name));
      if (!jsonColumns.length) continue;
      const select = [
        ...new Set([
          ...pk(table),
          ...jsonColumns.map((c) => c.name),
          ...(columns.get(table)!.some((c) => c.name === "operation_id")
            ? ["operation_id"]
            : []),
        ]),
      ];
      for (const row of this.db
        .prepare(`SELECT ${select.map(q).join(",")} FROM ${q(table)}`)
        .iterate() as Iterable<Row>) {
        if (selected.has(token(table, keys(table, row)))) continue;
        for (const column of jsonColumns) {
          const value = JSON.parse(String(row[column.name]));
          const matches =
            refers(value) ||
            (table === "working_drafts" &&
              [value.source, value.value].some(
                (text) => typeof text === "string" && refers(JSON.parse(text)),
              ));
          if (matches) {
            blockers.add(rowLabel(table, row));
            break;
          }
        }
      }
    }
    const rows = [...selected.values()].sort((a, b) =>
      token(a.table, a.keys).localeCompare(token(b.table, b.keys)),
    );
    const allBlockers = [...blockers].sort();
    const counts = Object.entries(labels)
      .map(([table, label]) => ({
        label,
        count: rows.filter((r) => r.table === table).length,
      }))
      .filter((r) => r.count);
    const preview: DeletionPreview = {
      target,
      name,
      version,
      counts,
      fingerprint: digest(canonical({ target, rows, blockers: allBlockers })),
      blockers: allBlockers.slice(0, 30),
      retainedImportReceipt: !!document.exchangeOrigin,
    };
    if (allBlockers.length > 30)
      preview.blockers.push(`${allBlockers.length - 30} additional references`);
    return { preview, rows, pk };
  }

  permanentlyDelete(target: DeletionTarget, expectedFingerprint: string) {
    this.db
      .transaction(() => {
        const { preview, rows, pk } = this.plan(target);
        if (preview.fingerprint !== expectedFingerprint)
          throw Error(
            "This item or its references changed. Review deletion again.",
          );
        if (preview.blockers.length)
          throw Error(
            "This item is still referenced and cannot be permanently deleted.",
          );
        this.db.pragma("defer_foreign_keys = ON");
        this.gate.run(rows, () => {
          for (const row of rows) {
            const where = pk(row.table)
              .map((c) => `${q(c)}=?`)
              .join(" AND ");
            if (
              this.db
                .prepare(`DELETE FROM ${q(row.table)} WHERE ${where}`)
                .run(...row.keys).changes !== 1
            )
              throw Error("Deletion target changed");
          }
          if (target.kind === "operation")
            this.db
              .prepare(
                "UPDATE preferences SET document=json_set(document,'$.lastOpenedOperationId',NULL) WHERE json_extract(document,'$.lastOpenedOperationId')=?",
              )
              .run(target.id);
          if ((this.db.pragma("foreign_key_check") as unknown[]).length)
            throw Error("Deletion would leave a broken reference");
          this.verify();
        });
      })
      .immediate();
  }
}
