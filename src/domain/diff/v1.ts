import type { Operation, ResolvedConfig, Attachment } from "../model";
import type { ModuleInstance, RichNode } from "../modules";
import { moduleConfiguration, moduleDefinition } from "../module-authoring";
import { productOwner, productCode } from "../authoring";
import {
  canonicalValue,
  equalValue,
  semanticValue,
  fingerprintId,
  changeSchema,
  type ChangeRecord,
  type Hash,
  type ResolvedEndpoint,
} from "./model";
import { movedIds } from "./sequence";
import { richDiff } from "./rich";

type Context = Pick<
  ChangeRecord,
  | "category"
  | "entityType"
  | "entityId"
  | "productId"
  | "moduleInstanceId"
  | "moduleDefinitionId"
  | "location"
> & { label: string };
const names: Record<string, string> = {
  name: "Name",
  orderNumber: "Order number",
  summary: "Narrative",
  text: "Text",
  purpose: "Purpose",
  description: "Description",
  at: "Time",
  relativeToEventId: "Reference event",
  offsetMinutes: "Relative offset (minutes)",
  phaseId: "Phase",
  unitId: "Assigned unit",
  objectiveId: "Objective",
  parentUnitId: "Parent unit",
  inTaskOrganization: "Task organization membership",
  participantUnitIds: "Participants",
  phaseIds: "Phase applicability",
  unitIds: "Unit applicability",
  system: "System",
  channel: "Channel / frequency",
  callsign: "Call sign",
  primary: "Primary",
  alternate: "Alternate",
  contingency: "Contingency",
  emergency: "Emergency",
  lostCommunications: "Lost communications",
  applicability: "Applicability",
  ownerId: "Responsible Staff",
  title: "Title",
  label: "Label",
  checked: "Status",
  notes: "Notes",
  assetId: "Managed asset",
  images: "Gallery",
  caption: "Caption",
  alt: "Alt text",
  width: "Image size",
  alignment: "Alignment",
  moduleInstanceId: "Source table",
  categoryColumnId: "Category / X column",
  valueColumnIds: "Value columns",
  chartType: "Chart type",
  referenceEventId: "Reference event",
  mode: "Source mode",
  eventId: "Event",
  recipientUnitId: "Recipient unit",
  layoutState: "Module visibility",
  configurationOverride: "Operational configuration override",
  defaultVisible: "Default visibility",
  required: "Required",
  guidance: "Guidance",
  type: "Type",
  format: "Format",
  submission: "Submission",
  value: "Value",
  defaultValue: "Default value",
  statusId: "Workflow status",
};
export const humanField = (key: string) =>
  names[key] ??
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
function labelMap(op: Operation, config: ResolvedConfig) {
  const map = new Map<string, string>([
    [op.id, op.name],
    [op.orderId, "Base order"],
  ]);
  for (const list of [
    op.units,
    op.tasks,
    op.objectives,
    op.phases,
    op.events,
    op.attachments,
    op.signal.nets,
    op.signal.pacePlans,
    config.doctrine.staff,
  ])
    for (const x of list) map.set(x.id, x.name);
  for (const n of config.doctrine.catalog?.nodes ?? [])
    map.set(n.id, `${productCode(n, config)} ${n.canonicalTitle}`);
  for (const f of config.doctrine.catalog?.baseFields ?? [])
    map.set(f.id, f.title);
  for (const asset of [
    ...(op.modules?.assets ?? []),
    ...(config.doctrine.modules?.assets ?? []),
  ])
    map.set(
      asset.assetId,
      `${asset.originalFilename} · SHA-256 ${asset.sha256}`,
    );
  for (const m of op.modules?.instances ?? []) {
    const def = moduleDefinition(m, config);
    map.set(m.moduleInstanceId, def?.title ?? "Module");
    for (const f of [
      ...(moduleConfiguration(m, config).fields ?? []),
      ...(moduleConfiguration(m, config).columns ?? []),
    ]) {
      map.set(f.id, f.label);
      for (const o of f.options) map.set(o.id, o.label);
    }
  }
  return map;
}
function display(v: unknown, labels: Map<string, string>): string {
  if (v === null || v === undefined) return "Not set";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return (labels.get(v) ?? v) || "(empty)";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v))
    return v.length ? v.map((x) => display(x, labels)).join("; ") : "None";
  const o = v as Record<string, unknown>;
  if (
    o.type === "doc" ||
    o.type === "paragraph" ||
    o.type === "heading" ||
    o.type === "listItem"
  )
    return ((o.content as unknown[] | undefined) ?? [])
      .map((x) => display(x, labels))
      .join(" ");
  if (o.type === "text") return String(o.text ?? "");
  if (o.type === "image")
    return `Image: ${display((o.attrs as Record<string, unknown>)?.assetId, labels)}`;
  return Object.entries(o)
    .filter(
      ([k]) =>
        !["id", "createdAt", "updatedAt", "storageReference"].includes(k),
    )
    .map(
      ([k, val]) =>
        `${labels.get(k) ?? humanField(k)}: ${display(val, labels)}`,
    )
    .join("\n");
}
const idFor = (v: any): string | null =>
  v && typeof v === "object"
    ? v.kind && v.id
      ? `${v.kind}:${v.id}`
      : (v.id ?? v.fieldId ?? null)
    : null;
const asSet = new Set(["participantUnitIds", "phaseIds", "unitIds"]);
export function diffV1(
  source: ResolvedEndpoint,
  target: ResolvedEndpoint,
  hash: Hash,
): ChangeRecord[] {
  if (
    source.operation.id !== target.operation.id ||
    source.endpoint.revisionNumber > target.endpoint.revisionNumber
  )
    throw Error("Invalid comparison endpoints");
  const a = source.operation,
    b = target.operation,
    ac = source.config,
    bc = target.config;
  const oldLabels = labelMap(a, ac),
    newLabels = labelMap(b, bc),
    changes: ChangeRecord[] = [];
  const ctx = (
    category: Context["category"],
    entityType: string,
    entityId: string,
    label: string,
    page: Context["location"]["page"],
    productId: string | null = null,
  ): Context => ({
    category,
    entityType,
    entityId,
    label,
    productId,
    moduleInstanceId: null,
    moduleDefinitionId: null,
    location: { page, id: entityId, moduleInstanceId: null },
  });
  function emit(
    c: Context,
    path: string,
    before: unknown,
    after: unknown,
    summary: string,
    type: ChangeRecord["changeType"] = "MODIFIED",
    detail: ChangeRecord["detailKind"] = "value",
  ) {
    if (equalValue(before, after)) return;
    const semanticFingerprint = hash(
      canonicalValue({
        engine: "diff-engine-v1",
        entityType: c.entityType,
        entityId: c.entityId,
        module: c.moduleInstanceId,
        field: path,
        type,
        before,
        after,
      }),
    );
    changes.push(
      changeSchema.parse({
        changeId: fingerprintId(semanticFingerprint),
        semanticFingerprint,
        changeType: type,
        category: c.category,
        operationId: a.id,
        entityType: c.entityType,
        entityId: c.entityId,
        productId: c.productId,
        moduleInstanceId: c.moduleInstanceId,
        moduleDefinitionId: c.moduleDefinitionId,
        fieldPath: path,
        humanSummary: `${c.label}: ${summary}`,
        beforeValue: semanticValue(before),
        afterValue: semanticValue(after),
        beforeDisplay: display(before, oldLabels),
        afterDisplay: display(after, newLabels),
        sourceLabel: oldLabels.get(c.entityId) ?? c.label,
        targetLabel: newLabels.get(c.entityId) ?? c.label,
        directProductReferences: c.productId ? [c.productId] : [],
        canonicalEntityReferences: [
          "unit",
          "task",
          "objective",
          "phase",
          "event",
          "net",
          "pace",
          "signal",
        ].includes(c.entityType)
          ? [`${c.entityType}:${c.entityId}`]
          : [],
        location: c.location,
        detailKind: detail,
      }),
    );
  }
  function walk(
    c: Context,
    before: any,
    after: any,
    path: string,
    field = path.split("/").at(-1)!,
  ) {
    if (equalValue(before, after)) return;
    if (before?.type === "doc" && after?.type === "doc") {
      for (const d of richDiff(before as RichNode, after as RichNode, hash))
        emit(
          c,
          `${path}/blocks/${d.key}`,
          d.before,
          d.after,
          d.summary,
          d.kind,
          "rich",
        );
      return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      if (asSet.has(field)) {
        emit(
          c,
          path,
          [...before].sort(),
          [...after].sort(),
          `${humanField(field)} changed`,
          "RELINKED",
          "reference",
        );
        return;
      }
      if ([...before, ...after].every((v) => !!idFor(v))) {
        collection(c, before, after, path);
        return;
      }
      if (
        field === "references" &&
        [...before, ...after].every(
          (v) => typeof v === "object" && v.kind && v.id,
        )
      ) {
        collection(c, before, after, path);
        return;
      }
    }
    if (
      before &&
      after &&
      !Array.isArray(before) &&
      !Array.isArray(after) &&
      typeof before === "object" &&
      typeof after === "object"
    ) {
      for (const key of [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ].sort()) {
        if (
          [
            "id",
            "createdAt",
            "updatedAt",
            "storageReference",
            "sequence",
            "position",
            "fieldId",
            "moduleInstanceId",
            "operationId",
            "moduleDefinitionId",
            "stableKey",
          ].includes(key) &&
          field !== "source"
        )
          continue;
        walk(c, before[key], after[key], `${path}/${key}`, key);
      }
      return;
    }
    const asset = field === "assetId",
      reference = /Id(s)?$/.test(field),
      text = typeof before === "string" || typeof after === "string";
    const label =
      newLabels.get(field) ?? oldLabels.get(field) ?? humanField(field);
    emit(
      asset ? { ...c, category: "ASSET" } : c,
      path,
      before,
      after,
      `${label} ${before == null ? "populated" : after == null ? "cleared" : "changed"}`,
      reference ? "RELINKED" : "MODIFIED",
      asset
        ? "asset"
        : reference
          ? "reference"
          : path.includes("/cells/")
            ? "cell"
            : text
              ? "text"
              : "value",
    );
  }
  function collection(
    c: Context,
    before: any[],
    after: any[],
    path: string,
    itemContext?: (v: any) => Context,
    ordered = true,
  ) {
    const old = new Map(before.map((v) => [idFor(v)!, v])),
      next = new Map(after.map((v) => [idFor(v)!, v]));
    for (const id of [...new Set([...old.keys(), ...next.keys()])].sort()) {
      const x = old.get(id),
        y = next.get(id),
        cc = itemContext
          ? itemContext(y ?? x)
          : {
              ...c,
              label: `${c.label} · ${(y ?? x).label ?? (y ?? x).title ?? (y ?? x).name ?? (path.endsWith("/rows") ? `Row ${(y ? after : before).findIndex((v) => idFor(v) === id) + 1} · ${Object.values((y ?? x).cells ?? {}).find((v) => typeof v === "string" && v) ?? id.slice(0, 8)}` : `${humanField(path.split("/").at(-1)!)} ${id.slice(0, 8)}`)}`,
            };
      if (!x || !y)
        emit(
          cc,
          `${path}/${id}`,
          x,
          y,
          `${humanField(path.split("/").at(-1)!)} ${y ? "added" : "removed"}`,
          y ? "ADDED" : "REMOVED",
        );
      else walk(cc, x, y, `${path}/${id}`);
    }
    if (ordered)
      for (const id of movedIds([...old.keys()], [...next.keys()])) {
        const cc = itemContext ? itemContext(next.get(id)) : c;
        emit(
          cc,
          `${path}/${id}/order`,
          before.findIndex((x) => idFor(x) === id) + 1,
          after.findIndex((x) => idFor(x) === id) + 1,
          `${newLabels.get(id) ?? humanField(path.split("/").at(-1)!)} moved`,
          "MOVED",
          "sequence",
        );
      }
  }
  const opContext = ctx(
    "OPERATION_METADATA",
    "operation",
    a.id,
    "Operation",
    "overview",
  );
  for (const key of ["name", "orderNumber", "demo"] as const)
    walk(opContext, a[key], b[key], `operation/${key}`);
  for (const key of ["doctrineRef", "organizationRef", "echelonRef"] as const)
    emit(
      opContext,
      `configuration/${key}`,
      a[key],
      b[key],
      `${humanField(key)} changed`,
      "CONFIGURATION_CHANGED",
    );
  const oldMeta = structuredClone(a.metadata),
    newMeta = structuredClone(b.metadata);
  if (
    oldMeta.statusId === ac.doctrine.publicationRequiredStatus &&
    newMeta.statusId === bc.doctrine.editingStatus
  )
    newMeta.statusId = oldMeta.statusId;
  walk(opContext, oldMeta, newMeta, "operation/metadata");
  const base = ctx(
    "BASE_ORDER",
    "base",
    a.orderId,
    "Base order",
    "base",
    a.orderId,
  );
  collection(
    base,
    a.sections,
    b.sections,
    "base/sections",
    (v) => ({
      ...base,
      label: ac.doctrine.paragraphs.find((p) => p.id === v.id)?.title ?? v.id,
    }),
    false,
  );
  collection(
    base,
    a.authoring?.fields ?? [],
    b.authoring?.fields ?? [],
    "base/fields",
    (v) => ({
      ...base,
      label:
        newLabels.get(v.fieldId) ?? oldLabels.get(v.fieldId) ?? "Base field",
    }),
    false,
  );
  for (const [key, category, entity, page] of [
    ["units", "TASK_ORGANIZATION", "unit", "units"],
    ["tasks", "TASK", "task", "tasks"],
    ["objectives", "OBJECTIVE", "objective", "tasks"],
    ["phases", "PHASE", "phase", "phases"],
    ["events", "EVENT", "event", "events"],
  ] as const) {
    const x =
      key === "phases"
        ? [...a.phases].sort((p, q) => p.sequence - q.sequence)
        : a[key];
    const y =
      key === "phases"
        ? [...b.phases].sort((p, q) => p.sequence - q.sequence)
        : b[key];
    collection(
      ctx(category, entity, a.id, key, page),
      x,
      y,
      key,
      (v) => ctx(category, entity, v.id, v.name, page),
      key === "phases",
    );
  }
  const sig = ctx("SIGNAL", "signal", a.signal.id, "Signal", "signal");
  for (const key of [
    "concept",
    "architecture",
    "spectrumNotes",
    "maintenanceNotes",
  ] as const)
    walk(sig, a.signal[key], b.signal[key], `signal/${key}`);
  for (const [key, entity] of [
    ["nets", "net"],
    ["pacePlans", "pace"],
  ] as const)
    collection(sig, a.signal[key], b.signal[key], `signal/${key}`, (v) =>
      ctx("SIGNAL", entity, v.id, v.name, "signal"),
    );
  const attachmentIds = [
    ...new Set([...a.attachments, ...b.attachments].map((x) => x.id)),
  ].sort();
  for (const id of attachmentIds) {
    const x = a.attachments.find((v) => v.id === id),
      y = b.attachments.find((v) => v.id === id),
      p = (y ?? x)!;
    const product = ctx(
      "OTHER",
      "product",
      id,
      `${p.code} ${p.name}`,
      p.doctrineNodeId ? "doctrine" : "attachment",
      id,
    );
    product.location.id = p.doctrineNodeId ?? id;
    if (!p.doctrineNodeId && (!x || !y)) {
      emit(
        product,
        `products/${id}`,
        x,
        y,
        `Product ${y ? "added" : "removed"}`,
        y ? "ADDED" : "REMOVED",
      );
      continue;
    }
    const oldState = x?.applicability ?? "UNDECIDED",
      newState = y?.applicability ?? "UNDECIDED";
    emit(
      { ...product, category: "PRODUCT_APPLICABILITY" },
      `products/${id}/applicability`,
      oldState,
      newState,
      "Applicability changed",
    );
    const ownership = (
      p: Attachment | undefined,
      op: Operation,
      config: ResolvedConfig,
    ) => {
      const node = config.doctrine.catalog?.nodes.find(
        (n) =>
          n.id ===
          (p?.doctrineNodeId ?? x?.doctrineNodeId ?? y?.doctrineNodeId),
      );
      return p?.metadata.ownerId
        ? `Operational override: ${config.doctrine.staff.find((s) => s.id === p.metadata.ownerId)?.name ?? p.metadata.ownerId}`
        : node
          ? `Doctrine / inherited: ${config.doctrine.staff.find((s) => s.id === productOwner(op, node, config))?.name ?? "Unassigned"}`
          : "Doctrine default";
    };
    if ((x?.metadata.ownerId ?? null) !== (y?.metadata.ownerId ?? null))
      emit(
        { ...product, category: "RESPONSIBLE_STAFF" },
        `products/${id}/ownerId`,
        x?.metadata.ownerId ?? null,
        y?.metadata.ownerId ?? null,
        `${ownership(x, a, ac)} → ${ownership(y, b, bc)}`,
        "RELINKED",
        "reference",
      );
    for (const key of [
      "narrative",
      "name",
      "code",
      "parentId",
      "phaseIds",
      "unitIds",
      "required",
    ] as const)
      walk(
        product,
        x?.[key] ?? (key === "narrative" ? "" : p[key]),
        y?.[key] ?? (key === "narrative" ? "" : p[key]),
        `products/${id}/${key}`,
      );
    walk(
      { ...product, category: "MODULE_CONTENT" },
      x?.content ?? null,
      y?.content ?? null,
      `products/${id}/content`,
    );
    if (x && y) {
      const { ownerId: xo, ...xm } = x.metadata,
        { ownerId: yo, ...ym } = y.metadata;
      walk(product, xm, ym, `products/${id}/metadata`);
    }
  }
  const oldModules = a.modules?.instances ?? [],
    newModules = b.modules?.instances ?? [];
  const moduleCtx = (m: ModuleInstance, config: ResolvedConfig): Context => {
    const p =
      b.attachments.find((x) => x.id === m.productInstanceId) ??
      a.attachments.find((x) => x.id === m.productInstanceId);
    return {
      ...ctx(
        "MODULE_CONTENT",
        "module",
        m.moduleInstanceId,
        moduleDefinition(m, config)?.title ?? "Module",
        p?.doctrineNodeId ? "doctrine" : p ? "attachment" : "base",
        m.productInstanceId,
      ),
      moduleInstanceId: m.moduleInstanceId,
      moduleDefinitionId: m.moduleDefinitionId,
      location: {
        page: p?.doctrineNodeId ? "doctrine" : p ? "attachment" : "base",
        id: p?.doctrineNodeId ?? p?.id ?? null,
        moduleInstanceId: m.moduleInstanceId,
      },
    };
  };
  for (const id of [
    ...new Set([...oldModules, ...newModules].map((m) => m.moduleInstanceId)),
  ].sort()) {
    const x = oldModules.find((m) => m.moduleInstanceId === id),
      y = newModules.find((m) => m.moduleInstanceId === id),
      m = (y ?? x)!,
      c = moduleCtx(m, y ? bc : ac);
    const xActive = x?.layoutState === "ACTIVE",
      yActive = y?.layoutState === "ACTIVE";
    if (xActive !== yActive || !x || !y)
      emit(
        { ...c, category: "MODULE_LAYOUT" },
        `modules/${id}/presence`,
        xActive ? "Active" : x ? "Removed by operation override" : null,
        yActive ? "Active" : y ? "Removed by operation override" : null,
        yActive ? (x ? "Module restored" : "Module added") : "Module removed",
        yActive ? "ADDED" : "REMOVED",
      );
    if (x && y) {
      const xc = moduleConfiguration(x, ac),
        yc = moduleConfiguration(y, bc);
      walk(
        { ...c, category: "MODULE_LAYOUT" },
        xc,
        yc,
        `modules/${id}/configuration`,
      );
      if (!!x.configurationOverride !== !!y.configurationOverride)
        emit(
          { ...c, category: "MODULE_LAYOUT" },
          `modules/${id}/override`,
          !!x.configurationOverride,
          !!y.configurationOverride,
          "Operational configuration override changed",
          "CONFIGURATION_CHANGED",
        );
      if (x.localDefinition && y.localDefinition)
        for (const k of [
          "title",
          "description",
          "guidance",
          "required",
          "defaultVisible",
        ] as const)
          walk(
            { ...c, category: "MODULE_LAYOUT" },
            x.localDefinition[k],
            y.localDefinition[k],
            `modules/${id}/definition/${k}`,
          );
      walk(c, x.content, y.content, `modules/${id}/content`);
    }
  }
  for (const product of new Set(
    [...oldModules, ...newModules].map((m) => m.productInstanceId),
  )) {
    const order = (xs: ModuleInstance[]) =>
      xs
        .filter(
          (m) => m.productInstanceId === product && m.layoutState === "ACTIVE",
        )
        .sort(
          (x, y) =>
            x.position - y.position ||
            x.moduleInstanceId.localeCompare(y.moduleInstanceId),
        )
        .map((m) => m.moduleInstanceId);
    const x = order(oldModules),
      y = order(newModules);
    for (const id of movedIds(x, y))
      emit(
        {
          ...moduleCtx(
            newModules.find((m) => m.moduleInstanceId === id)!,
            bc,
          ),
          category: "MODULE_LAYOUT",
        },
        `modules/${id}/order`,
        x.indexOf(id) + 1,
        y.indexOf(id) + 1,
        "Module moved",
        "MOVED",
        "sequence",
      );
  }
  return changes.sort(
    (x, y) =>
      x.category.localeCompare(y.category) ||
      x.entityId.localeCompare(y.entityId) ||
      x.fieldPath.localeCompare(y.fieldPath) ||
      x.semanticFingerprint.localeCompare(y.semanticFingerprint),
  );
}
