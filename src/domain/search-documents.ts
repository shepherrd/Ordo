import type { Operation, ResolvedConfig } from "./model";
import type { CatalogItem } from "./catalog";
import type {
  ManagedAsset,
  ModuleContent,
  RichNode,
  FieldValue,
} from "./modules";
import type { ProductContent } from "./doctrine";
import type { SearchDocument, SearchType } from "./search";
import {
  targetKey,
  type SearchTarget,
  type OperationSearchTarget,
} from "./planning-target";
import { narrativePlainText } from "./narrative";
import type { UnitIdentity, StaffPosition } from "./unit-profiles";
import { organizationUnits } from "./organization-orbat";
import type { OrbatNode } from "./orbat";

export function richSearchText(n: RichNode): string {
  return n.type === "text"
    ? (n.text ?? "")
    : (n.content ?? [])
        .map(richSearchText)
        .join(n.type === "paragraph" || n.type === "heading" ? "" : "\n");
}
export function fieldSearchText(v: FieldValue): string {
  if (v === null) return "";
  if (typeof v === "string") return narrativePlainText(v);
  if (Array.isArray(v)) return v.join(" ");
  return typeof v === "object" ? richSearchText(v) : String(v);
}
type Add = (
  target: SearchTarget,
  type: SearchType,
  title: string,
  text: string,
  code?: string,
  phases?: string[],
  staff?: string[],
) => void;
function collector(
  owner: string,
  ownerName: string,
  operationId: string | null,
  sourceToken: string,
) {
  const docs: SearchDocument[] = [];
  const add: Add = (
    target,
    type,
    title,
    text,
    code = "",
    phaseIds = [],
    staffIds = [],
  ) => {
    docs.push({
      id: owner + ":" + targetKey(target),
      owner,
      ownerName,
      operationId,
      sourceToken,
      target,
      type,
      title,
      code,
      text: narrativePlainText(text),
      phaseIds,
      staffIds,
    });
  };
  return { docs, add };
}
const identityFields: (keyof UnitIdentity)[] = [
  "fullDesignation",
  "shortDesignation",
  "abbreviation",
  "unitType",
  "echelon",
  "service",
  "component",
  "callsign",
  "headquarters",
  "description",
  "notes",
];

/** Explicit allowlist only: no encoded narratives, serialized records, hashes or binary contents. */
export function operationSearchDocuments(
  op: Operation,
  config: ResolvedConfig,
): SearchDocument[] {
  const { docs, add } = collector(
    "operation:" + op.id,
    op.name,
    op.id,
    String(op.revision),
  );
  for (const board of op.whiteboards?.boards ?? []) {
    add(
      {
        area: "operation",
        operationId: op.id,
        target: { kind: "whiteboard", boardId: board.id },
      },
      "whiteboard",
      board.name,
      board.connectors.map((c) => c.label).join("\n"),
    );
    for (const item of board.items) {
      const text =
        "text" in item
          ? item.text
          : "label" in item
            ? item.label
            : (op.planningCards?.definitions.find((c) => c.id === item.cardId)
                ?.title ?? "Planning card");
      add(
        {
          area: "operation",
          operationId: op.id,
          target: { kind: "whiteboard", boardId: board.id, itemId: item.id },
        },
        "whiteboard",
        board.name + " — " + (text.slice(0, 100) || item.kind),
        text,
      );
    }
  }
  for (const card of op.planningCards?.definitions ?? [])
    add(
      {
        area: "operation",
        operationId: op.id,
        target: { kind: "card", cardId: card.id },
      },
      "card",
      card.title,
      card.mode === "independent"
        ? card.values.map((v) => v.label + ": " + v.value).join("\n")
        : card.title,
    );
  const put = (
    target: OperationSearchTarget,
    type: SearchType,
    name: string,
    value: string,
    field?: string,
    code?: string,
    phases?: string[],
    staff?: string[],
  ) =>
    add(
      {
        area: "operation",
        operationId: op.id,
        target,
        ...(field ? { field } : {}),
      },
      type,
      name,
      value,
      code,
      phases,
      staff,
    );
  put(
    { kind: "operation" },
    "operation",
    op.name,
    op.name + " " + op.orderNumber,
    "name",
    op.orderNumber,
  );
  const groups = {
    unit: op.units,
    task: op.tasks,
    objective: op.objectives,
    phase: op.phases,
    event: op.events,
  };
  for (const kind of ["unit", "task", "objective", "phase", "event"] as const)
    for (const e of groups[kind]) {
      const target = {
        kind: "entity" as const,
        entityKind: kind,
        entityId: e.id,
      };
      const phases =
        "phaseId" in e && e.phaseId
          ? [e.phaseId]
          : kind === "phase"
            ? [e.id]
            : [];
      const staff = e.metadata.ownerId ? [e.metadata.ownerId] : [];
      put(target, kind, e.name, e.name, "name", "", phases, staff);
      if ("purpose" in e && e.purpose)
        put(
          target,
          kind,
          e.name + " — Purpose",
          e.purpose,
          "purpose",
          "",
          phases,
          staff,
        );
      if ("description" in e && e.description)
        put(
          target,
          kind,
          e.name + " — Description",
          e.description,
          "description",
          "",
          phases,
          staff,
        );
      if ("profileIdentity" in e && e.profileIdentity)
        for (const f of identityFields.filter((f) => f !== "fullDesignation")) {
          const value = e.profileIdentity[f as keyof typeof e.profileIdentity];
          if (value)
            put(target, kind, e.name + " — " + f, value, f, "", phases, staff);
        }
    }
  for (const section of op.sections) {
    const title =
      config.doctrine.paragraphs.find((p) => p.id === section.id)?.title ??
      section.id;
    put(
      { kind: "paragraph", paragraphId: section.id },
      "narrative",
      title,
      section.summary,
      "summary",
    );
  }
  for (const f of op.authoring?.fields ?? []) {
    const title =
      config.doctrine.catalog?.baseFields.find((d) => d.id === f.fieldId)
        ?.title ?? "Base order field";
    put(
      { kind: "base-field", fieldId: f.fieldId },
      "narrative",
      title,
      f.text,
      "text",
    );
    for (const entry of f.entries ?? [])
      put(
        { kind: "base-field", fieldId: f.fieldId, entryId: entry.id },
        "narrative",
        title + " — " + entry.label,
        entry.value,
        "value",
      );
  }
  for (const f of [
    "concept",
    "architecture",
    "spectrumNotes",
    "maintenanceNotes",
  ] as const)
    put({ kind: "signal" }, "signal", "Signal — " + f, op.signal[f], f);
  for (const n of op.signal.nets)
    for (const f of [
      "name",
      "purpose",
      "system",
      "channel",
      "callsign",
    ] as const)
      put(
        { kind: "net", entityId: n.id },
        "net",
        f === "name" ? n.name : n.name + " — " + f,
        n[f],
        f,
        f === "name" ? n.callsign : "",
        n.phaseIds,
        n.metadata.ownerId ? [n.metadata.ownerId] : [],
      );
  for (const p of op.signal.pacePlans)
    for (const f of [
      "name",
      "primary",
      "alternate",
      "contingency",
      "emergency",
      "lostCommunications",
    ] as const)
      put(
        { kind: "pace", entityId: p.id },
        "pace",
        f === "name" ? p.name : p.name + " — " + f,
        p[f],
        f,
        "",
        p.phaseIds,
        p.metadata.ownerId ? [p.metadata.ownerId] : [],
      );
  const content = (
    c: ProductContent,
    title: string,
    target: (itemId?: string, columnId?: string) => OperationSearchTarget,
    narrative: (id: string, generic?: boolean) => OperationSearchTarget,
    phases: string[],
    staff: string[],
  ) => {
    const row = (
      id: string,
      name: string,
      value: string,
      field: string,
      columnId?: string,
    ) =>
      put(
        target(id, columnId),
        "product",
        title + " — " + name,
        value,
        field,
        "",
        phases,
        staff,
      );
    if (c.kind === "narrative")
      for (const s of c.sections)
        put(
          narrative(s.id),
          "narrative",
          title + " — " + s.title,
          s.text,
          "text",
          "",
          phases,
          staff,
        );
    if (c.kind === "generic")
      for (const f of c.fields)
        put(
          narrative(f.id, true),
          "narrative",
          title + " — " + f.label,
          f.value,
          "value",
          "",
          phases,
          staff,
        );
    if (c.kind === "matrix")
      for (const r of c.rows)
        for (const col of c.columns)
          row(r.id, col.title, r.cells[col.id] ?? "", "cells", col.id);
    if (c.kind === "checklist")
      for (const i of c.items) row(i.id, "Checklist item", i.text, "text");
    if (c.kind === "reports")
      for (const r of c.reports)
        for (const f of ["name", "format", "submission"] as const)
          row(r.id, r.name, r[f], f);
    if (c.kind === "distribution")
      for (const r of c.recipients)
        for (const f of [
          "recipient",
          "dutyPosition",
          "location",
          "distributionPurpose",
          "copyNumber",
          "method",
        ] as const)
          row(r.id, r.recipient, r[f], f);
  };
  for (const a of op.attachments) {
    const staff = a.metadata.ownerId ? [a.metadata.ownerId] : [];
    put(
      { kind: "product", attachmentId: a.id },
      "product",
      a.name,
      a.name,
      "name",
      a.code,
      a.phaseIds,
      staff,
    );
    put(
      { kind: "attachment-text", attachmentId: a.id },
      "narrative",
      a.name + " — Narrative",
      a.narrative,
      "narrative",
      "",
      a.phaseIds,
      staff,
    );
    if (a.content)
      content(
        a.content,
        a.name,
        (itemId, columnId) => ({
          kind: "product",
          attachmentId: a.id,
          ...(itemId ? { itemId } : {}),
          ...(columnId ? { columnId } : {}),
        }),
        (id, generic) => ({
          kind: "attachment-text",
          attachmentId: a.id,
          ...(generic ? { fieldId: id } : { sectionId: id }),
        }),
        a.phaseIds,
        staff,
      );
  }
  for (const m of op.modules?.instances ?? []) {
    if (m.layoutState !== "ACTIVE") continue;
    const d =
      m.localDefinition ??
      config.doctrine.modules?.layouts
        .flatMap((l) => l.definitions)
        .find((d) => d.moduleDefinitionId === m.moduleDefinitionId);
    const a = op.attachments.find((a) => a.id === m.productInstanceId),
      phases = a?.phaseIds ?? [],
      staff = a?.metadata.ownerId ? [a.metadata.ownerId] : [];
    const title = d?.title ?? m.content.type.replaceAll("_", " ");
    const c: ModuleContent = m.content;
    const target = (
      itemId?: string,
      fieldId?: string,
    ): OperationSearchTarget => ({
      kind: "module",
      moduleId: m.moduleInstanceId,
      ...(itemId ? { itemId } : {}),
      ...(fieldId ? { fieldId } : {}),
    });
    const row = (
      name: string,
      value: string,
      field: string,
      itemId?: string,
      fieldId?: string,
    ) =>
      put(
        target(itemId, fieldId),
        "module",
        title + " — " + name,
        value,
        field,
        "",
        phases,
        staff,
      );
    put(
      target(),
      "module",
      title,
      d?.description ?? "",
      "title",
      "",
      phases,
      staff,
    );
    if (c.type === "PLAIN_TEXT" || c.type === "RICH_TEXT")
      put(
        { kind: "module-text", moduleId: m.moduleInstanceId },
        "narrative",
        title,
        c.type === "PLAIN_TEXT" ? c.text : richSearchText(c.document),
        c.type === "PLAIN_TEXT" ? "text" : "document",
        "",
        phases,
        staff,
      );
    const configuration = m.configurationOverride ?? d?.configuration;
    if (c.type === "KEY_VALUE")
      for (const f of configuration?.fields ?? [])
        if (!f.type.endsWith("_REFERENCE"))
          row(
            f.label,
            fieldSearchText(c.values[f.id] ?? null),
            "value",
            undefined,
            f.id,
          );
    if (c.type === "TABLE" || c.type === "MATRIX")
      for (const r of c.rows)
        for (const f of configuration?.columns ?? [])
          if (!f.type.endsWith("_REFERENCE"))
            row(
              f.label,
              fieldSearchText(r.cells[f.id] ?? null),
              "cells",
              r.id,
              f.id,
            );
    if (c.type === "CHECKLIST")
      for (const i of c.items) {
        row("Checklist item", i.text, "text", i.id);
        row("Notes", i.notes, "notes", i.id);
      }
    if (c.type === "TIMELINE")
      for (const i of c.items) {
        row(i.title, i.title, "title", i.id);
        row(i.title, i.description, "description", i.id);
      }
    if (c.type === "CHART" && c.source.mode === "DIRECT")
      for (const p of c.source.points) row(p.label, p.label, "label", p.id);
    if (c.type === "IMAGE" || c.type === "IMAGE_GALLERY")
      for (const i of c.type === "IMAGE"
        ? c.image
          ? [c.image]
          : []
        : c.images)
        for (const f of ["title", "caption", "alt"] as const)
          row(i.title || "Image", i[f], f, i.id);
    if (c.type === "FILE_ATTACHMENT") {
      row("File", c.displayName, "displayName");
      row("Description", c.description, "description");
    }
    if (c.type === "REPORT_CATALOG" || c.type === "DISTRIBUTION_LIST")
      content(c.data, title, target, (id) => target(id), phases, staff);
  }
  return docs;
}

export function catalogSearchDocuments(
  item: CatalogItem,
  token: string,
  assignedOrbat?: { id: string; nodes: OrbatNode[] } | null,
): SearchDocument[] {
  const { docs, add } = collector("catalog:" + item.id, item.name, null, token);
  const base = {
    area: "catalog" as const,
    catalogId: item.id,
    catalogKind: item.kind,
  };
  const type = item.kind.toLowerCase() as SearchType;
  add(base, type, item.name, item.name);
  if (item.kind === "DOCTRINE")
    add(
      { ...base, field: "description" },
      type,
      item.name + " — Description",
      item.content.description,
    );
  if (item.kind === "SYMBOL")
    add(
      { ...base, field: "tags" },
      type,
      item.name + " — Tags",
      item.content.tags.join(" "),
    );
  if (item.kind === "ORBAT")
    for (const n of item.content.nodes)
      add(
        { ...base, nodeId: n.nodeId },
        type,
        n.nameOverride ?? n.unit.identity.fullDesignation,
        n.annotation + " " + n.unit.identity.shortDesignation,
      );
  if (item.kind === "ORGANIZATION") {
    const unit = (
      identity: UnitIdentity,
      staff: {
        sections: { sectionId: string; name: string; description: string }[];
        positions: StaffPosition[];
      },
      nodeId?: string,
      orbatId?: string,
    ) => {
      const root = { ...base, ...(nodeId ? { nodeId, orbatId } : {}) };
      for (const f of identityFields)
        if (identity[f])
          add(
            { ...root, field: f },
            type,
            identity.fullDesignation +
              (f === "fullDesignation" ? "" : " — " + f),
            identity[f],
          );
      for (const s of staff.sections)
        add({ ...root, sectionId: s.sectionId }, type, s.name, s.description);
      for (const p of staff.positions)
        add(
          { ...root, sectionId: p.sectionId, positionId: p.positionId },
          type,
          p.title,
          [
            p.shortTitle,
            p.rankGrade,
            p.functionalRole ?? "",
            p.description,
            p.incumbent?.name ?? "",
          ]
            .map(narrativePlainText)
            .join("\n"),
        );
    };
    unit(item.content.identity, item.content.staff);
    const { active, retained } = organizationUnits(
      item.content.orbatWorkspace,
      assignedOrbat,
    );
    for (const u of [...active, ...retained])
      unit(u.identity, u.staff, u.nodeId, u.orbatId);
  }
  return docs;
}
export function assetSearchDocuments(asset: ManagedAsset): SearchDocument[] {
  const { docs, add } = collector(
    "file:" + asset.assetId,
    asset.originalFilename,
    asset.operationId,
    asset.sha256,
  );
  add(
    { area: "file", assetId: asset.assetId },
    "file",
    asset.originalFilename,
    asset.originalFilename,
  );
  return docs;
}
