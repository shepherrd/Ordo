import { z } from "zod";
import { metadata, type Operation, type ResolvedConfig } from "./model";
import { assertOperation } from "./invariants";
import { newEventSchedule } from "./planning-schedule";

export const importKinds = [
  "units",
  "tasks",
  "objectives",
  "phases",
  "events",
] as const;
export type ImportKind = (typeof importKinds)[number];
export const importKindLabels: Record<ImportKind, string> = {
  units: "Units",
  tasks: "Tasks",
  objectives: "Objectives",
  phases: "Phases",
  events: "Timeline events",
};
export const importTableSchema = z
  .object({
    name: z.string().max(160),
    rows: z.array(z.array(z.string().max(40000)).max(64)).max(1001),
    warnings: z.array(z.string().max(400)).max(100),
  })
  .strict();
export const importFileSchema = z
  .object({
    filename: z.string().max(260),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    tables: z.array(importTableSchema).min(1).max(20),
  })
  .strict();
export type ImportFile = z.infer<typeof importFileSchema>;
export type ImportTable = z.infer<typeof importTableSchema>;
export type ImportField = { key: string; label: string; help?: string };
const common: ImportField[] = [
  {
    key: "id",
    label: "Ordo ID",
    help: "Blank creates a record. An existing ID updates that record only.",
  },
  {
    key: "key",
    label: "Row key",
    help: "Optional unique key. Use @key in another row's relationship column.",
  },
  { key: "name", label: "Name" },
  { key: "owner", label: "Responsible staff", help: "Exact staff name or ID." },
];
const relation = (key: string, label: string): ImportField => ({
  key,
  label,
  help: "Exact existing name or ID; @row-key for another row of the same type.",
});
export const importFields: Record<ImportKind, ImportField[]> = {
  units: [
    ...common,
    relation("parentUnitId", "Parent unit"),
    {
      key: "inTaskOrganization",
      label: "Include in task organization",
      help: "true/false, yes/no, or 1/0.",
    },
  ],
  tasks: [
    ...common,
    { key: "purpose", label: "Purpose" },
    relation("unitId", "Assigned unit"),
    relation("objectiveId", "Objective"),
    relation("phaseId", "Phase"),
  ],
  objectives: [...common, { key: "description", label: "Description" }],
  phases: [
    ...common,
    {
      key: "sequence",
      label: "Sequence",
      help: "A whole number, zero or greater.",
    },
  ],
  events: [
    ...common,
    {
      key: "at",
      label: "Start time",
      help: "ISO timestamp with timezone, such as 2026-10-19T14:00:00Z.",
    },
    relation("phaseId", "Phase"),
    relation("unitId", "Assigned unit"),
    { key: "durationMinutes", label: "Duration in minutes" },
    relation("relativeToEventId", "Follow event"),
    { key: "offsetMinutes", label: "Offset in minutes" },
    {
      key: "anchor",
      label: "Follow start or finish",
      help: "start or finish.",
    },
  ],
};
export type ImportMapping = Record<string, number>;
export type ImportChange = { field: string; before: string; after: string };
export type ImportRowPreview = {
  row: number;
  name: string;
  action: "create" | "update" | "unchanged" | "skip" | "error";
  changes: ImportChange[];
  errors: string[];
};
export type TableImportPreview = {
  rows: ImportRowPreview[];
  errors: string[];
  operation: Operation | null;
  created: number;
  updated: number;
};

export function suggestImportMapping(
  kind: ImportKind,
  headers: string[],
): ImportMapping {
  const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const result: ImportMapping = {};
  for (const f of importFields[kind]) {
    const index = headers.findIndex((h) =>
      [f.key, f.label].some((v) => normal(v) === normal(h)),
    );
    if (index >= 0) result[f.key] = index;
  }
  return result;
}
export function previewTableImport(
  operation: Operation,
  config: ResolvedConfig,
  input: {
    kind: ImportKind;
    table: ImportTable;
    mapping: ImportMapping;
    filename: string;
    sha256: string;
    skipRows: number[];
    clearBlankCells: boolean;
  },
  newId: (row: number) => string,
): TableImportPreview {
  const { kind, table, mapping } = input;
  importTableSchema.parse(table);
  const next = structuredClone(operation),
    rows: ImportRowPreview[] = [],
    errors: string[] = [];
  const allowed = importFields[kind];
  const columns = Object.values(mapping);
  if (mapping.name == null)
    errors.push("Map the Name column before previewing.");
  if (
    Object.keys(mapping).some((k) => !allowed.some((f) => f.key === k)) ||
    columns.some((c) => !Number.isInteger(c) || c < 0 || c > 63)
  )
    errors.push("The column mapping is invalid.");
  if (new Set(columns).size !== columns.length)
    errors.push("Map each source column only once.");
  const cell = (r: string[], key: string) =>
    mapping[key] == null ? undefined : (r[mapping[key]] ?? "").trim();
  const existing = operation[kind],
    keys = new Map<string, string>(),
    targetIds = new Map<number, string>(),
    seenIds = new Set<string>();
  for (let i = 1; i < table.rows.length; i++) {
    const r = table.rows[i],
      row = i + 1;
    if (input.skipRows.includes(row) || r.every((v) => !v.trim())) continue;
    const id = cell(r, "id"),
      key = cell(r, "key"),
      target = id || newId(row);
    targetIds.set(row, target);
    if (seenIds.has(target)) errors.push(`Row ${row}: duplicate Ordo ID.`);
    seenIds.add(target);
    if (key) {
      if (keys.has(key)) errors.push(`Row ${row}: duplicate row key ${key}.`);
      keys.set(key, target);
    }
  }
  if (errors.length)
    return { rows, errors, operation: null, created: 0, updated: 0 };
  for (let i = 1; i < table.rows.length; i++) {
    const r = table.rows[i],
      row = i + 1,
      name = cell(r, "name") ?? "";
    const preview: ImportRowPreview = {
      row,
      name,
      action: "skip",
      changes: [],
      errors: [],
    };
    rows.push(preview);
    if (input.skipRows.includes(row) || r.every((v) => !v.trim())) continue;
    const id = cell(r, "id"),
      old = id ? existing.find((e) => e.id === id) : undefined;
    if (id && !old) {
      preview.action = "error";
      preview.errors.push(
        "Ordo ID does not match an existing record of this type. Clear it to create a new record.",
      );
      continue;
    }
    const base = {
      id: targetIds.get(row)!,
      name,
      metadata: metadata(config.doctrine.editingStatus),
    };
    const defaults =
      kind === "units"
        ? { ...base, parentUnitId: null, inTaskOrganization: true }
        : kind === "tasks"
          ? {
              ...base,
              purpose: "",
              unitId: null,
              objectiveId: null,
              phaseId: null,
            }
          : kind === "objectives"
            ? { ...base, description: "" }
            : kind === "phases"
              ? { ...base, sequence: operation.phases.length + i - 1 }
              : {
                  ...base,
                  at: null,
                  relativeToEventId: null,
                  offsetMinutes: 0,
                  phaseId: null,
                };
    const entity = structuredClone(old ?? defaults) as Record<
      string,
      unknown
    > & {
      id: string;
      name: string;
      metadata: Operation["units"][number]["metadata"];
    };
    const assign = (key: string, value: unknown, label: string) => {
      const before = entity[key] ?? "";
      if (JSON.stringify(before) === JSON.stringify(value ?? "")) return;
      entity[key] = value;
      preview.changes.push({
        field: label,
        before: String(before),
        after: String(value ?? ""),
      });
    };
    const ref = (
      value: string,
      list: { id: string; name: string }[],
      sameKind: boolean,
    ) => {
      if (!value) return null;
      if (value.startsWith("@") && sameKind) {
        const found = keys.get(value.slice(1));
        if (found) return found;
        throw Error(`Unknown row key ${value}.`);
      }
      const byId = list.find((e) => e.id === value);
      if (byId) return byId.id;
      const found = list.filter((e) => e.name === value);
      if (found.length === 1) return found[0].id;
      throw Error(
        found.length
          ? `More than one record is named ${value}; use its Ordo ID.`
          : `Unknown reference ${value}.`,
      );
    };
    const number = (value: string, min: number, max: number) => {
      if (!/^-?\d+$/.test(value)) throw Error("Use a whole number.");
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < min || n > max)
        throw Error(`Use a whole number from ${min} to ${max}.`);
      return n;
    };
    for (const field of allowed) {
      if (["id", "key"].includes(field.key)) continue;
      const value = cell(r, field.key);
      if (
        value === undefined ||
        (old && value === "" && !input.clearBlankCells)
      )
        continue;
      try {
        if (field.key === "owner") {
          const owner = ref(value, config.doctrine.staff, false),
            before = entity.metadata.ownerId;
          if (owner !== before) {
            entity.metadata.ownerId = owner;
            preview.changes.push({
              field: field.label,
              before: before ?? "",
              after: owner ?? "",
            });
          }
        } else if (field.key === "inTaskOrganization") {
          if (!value && !old) continue;
          if (!/^(true|false|yes|no|1|0)$/i.test(value))
            throw Error("Use true/false, yes/no, or 1/0.");
          assign(field.key, /^(true|yes|1)$/i.test(value), field.label);
        } else if (field.key === "sequence" || field.key === "offsetMinutes")
          assign(
            field.key,
            number(
              value || "0",
              field.key === "sequence" ? 0 : -5256000,
              5256000,
            ),
            field.label,
          );
        else if (field.key === "at") {
          if (
            value &&
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
              value,
            )
          )
            throw Error("Include an explicit timezone in the timestamp.");
          if (
            value &&
            !z.iso.datetime({ offset: true }).safeParse(value).success
          )
            throw Error("Invalid calendar date or time.");
          assign(
            field.key,
            value ? new Date(value).toISOString() : null,
            field.label,
          );
        } else if (
          kind === "events" &&
          ["durationMinutes", "unitId", "anchor"].includes(field.key)
        ) {
          const schedule = structuredClone(
            (entity.schedule as Operation["events"][number]["schedule"]) ??
              newEventSchedule(),
          );
          const key =
              field.key === "anchor"
                ? "relativeAnchor"
                : (field.key as "durationMinutes" | "unitId"),
            before = schedule[key];
          if (
            key === "relativeAnchor" &&
            value &&
            !/^(start|finish)$/i.test(value)
          )
            throw Error("Use start or finish.");
          const v =
            key === "durationMinutes"
              ? number(value || "0", 0, 525600)
              : key === "unitId"
                ? ref(value, operation.units, false)
                : value.toLowerCase() === "finish"
                  ? "END"
                  : "START";
          Object.assign(schedule, { [key]: v });
          entity.schedule = schedule;
          if (v !== before)
            preview.changes.push({
              field: field.label,
              before: String(before ?? ""),
              after: String(v ?? ""),
            });
        } else if (field.key.endsWith("Id")) {
          const target =
            field.key === "parentUnitId" || field.key === "unitId"
              ? operation.units
              : field.key === "objectiveId"
                ? operation.objectives
                : field.key === "phaseId"
                  ? operation.phases
                  : operation.events;
          assign(
            field.key,
            ref(
              value,
              target,
              (kind === "units" && field.key === "parentUnitId") ||
                (kind === "events" && field.key === "relativeToEventId"),
            ),
            field.label,
          );
        } else assign(field.key, value, field.label);
      } catch (e) {
        preview.errors.push(
          `${field.label}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (!entity.name.trim()) preview.errors.push("Name is required.");
    if (preview.errors.length) {
      preview.action = "error";
      continue;
    }
    preview.action = old
      ? preview.changes.length
        ? "update"
        : "unchanged"
      : "create";
    if (preview.action === "unchanged") continue;
    entity.metadata.source = {
      type: "import",
      note: `${input.filename} · ${table.name} · row ${row}\nSHA-256 ${input.sha256}`,
    };
    const list = next[kind] as unknown as (typeof entity)[];
    const at = list.findIndex((e) => e.id === entity.id);
    if (at < 0) list.push(entity);
    else list[at] = entity;
  }
  if (!rows.some((r) => r.action === "error"))
    try {
      assertOperation(next, config);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  const created = rows.filter((r) => r.action === "create").length,
    updated = rows.filter((r) => r.action === "update").length;
  return {
    rows,
    errors,
    operation:
      errors.length || rows.some((r) => r.action === "error") ? null : next,
    created,
    updated,
  };
}
