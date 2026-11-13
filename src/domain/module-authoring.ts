import type { Operation, ResolvedConfig, Finding } from "./model";
import { instantiateProduct, factTargets } from "./authoring";
import {
  moduleTypes,
  emptyModuleContent,
  type ModuleInstance,
  type ModuleDefinition,
  type FieldDefinition,
  type FieldValue,
  type ModuleReference,
  referencedAssets,
} from "./modules";

export function moduleDefinition(
  m: ModuleInstance,
  config: ResolvedConfig,
): ModuleDefinition | undefined {
  return m.origin === "OPERATION"
    ? m.localDefinition
    : config.doctrine.modules?.layouts
        .flatMap((l) => l.definitions)
        .find((d) => d.moduleDefinitionId === m.moduleDefinitionId);
}
export const moduleConfiguration = (
  m: ModuleInstance,
  config: ResolvedConfig,
) =>
  m.configurationOverride ?? moduleDefinition(m, config)?.configuration ?? {};
export function ensureModuleLayout(
  op: Operation,
  config: ResolvedConfig,
  nodeId: string | null,
  id: () => string,
  now: string,
): string {
  op.modules ??= { schemaVersion: 1, instances: [], assets: [] };
  const productId = nodeId
    ? instantiateProduct(op, config, nodeId, id).id
    : op.orderId;
  for (const d of config.doctrine.modules?.layouts.find(
    (l) => l.productId === nodeId,
  )?.definitions ?? []) {
    if (
      op.modules.instances.some(
        (m) =>
          m.productInstanceId === productId &&
          m.moduleDefinitionId === d.moduleDefinitionId,
      )
    )
      continue;
    const content = emptyModuleContent(d);
    const assets = d.configuration.defaultAssetIds ?? [];
    const image = (assetId: string) => ({
      id: id(),
      assetId,
      title: "",
      caption: "",
      alt: d.title,
      width: "full" as const,
      alignment: "center" as const,
    });
    if (content.type === "IMAGE" && assets[0]) content.image = image(assets[0]);
    if (content.type === "IMAGE_GALLERY") content.images = assets.map(image);
    if (content.type === "FILE_ATTACHMENT") content.assetId = assets[0] ?? null;
    op.modules.instances.push({
      moduleInstanceId: id(),
      operationId: op.id,
      productInstanceId: productId,
      moduleDefinitionId: d.moduleDefinitionId,
      origin: "DOCTRINE",
      content,
      position: d.position,
      layoutState: d.defaultVisible
        ? "ACTIVE"
        : "REMOVED_BY_OPERATION_OVERRIDE",
      createdAt: now,
      updatedAt: now,
    });
  }
  return productId;
}
export function addOperationModule(
  op: Operation,
  productId: string,
  definition: ModuleDefinition,
  id: () => string,
  now: string,
): ModuleInstance {
  op.modules ??= { schemaVersion: 1, instances: [], assets: [] };
  const m: ModuleInstance = {
    moduleInstanceId: id(),
    operationId: op.id,
    productInstanceId: productId,
    moduleDefinitionId: null,
    localDefinition: definition,
    origin: "OPERATION",
    content: emptyModuleContent(definition),
    position: op.modules.instances.filter(
      (i) => i.productInstanceId === productId,
    ).length,
    layoutState: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  };
  op.modules.instances.push(m);
  return m;
}
export function resetModuleLayout(
  op: Operation,
  config: ResolvedConfig,
  productId: string,
  confirmed: boolean,
  now: string,
): void {
  if (!confirmed)
    throw Error(
      "Confirm reset: operation-added modules will move to recovery; authored content is retained",
    );
  for (const m of op.modules?.instances.filter(
    (i) => i.productInstanceId === productId,
  ) ?? []) {
    const d = moduleDefinition(m, config);
    m.layoutState =
      m.origin === "DOCTRINE" && d?.defaultVisible
        ? "ACTIVE"
        : "REMOVED_BY_OPERATION_OVERRIDE";
    if (m.origin === "DOCTRINE") {
      m.position = d?.position ?? m.position;
      if (m.configurationOverride)
        m.recoveryConfiguration = structuredClone(m.configurationOverride);
      delete m.configurationOverride;
    }
    m.updatedAt = now;
  }
}
export function moduleReferenceExists(
  op: Operation,
  ref: ModuleReference,
): boolean {
  return ref.kind === "product"
    ? ref.id === op.orderId || op.attachments.some((a) => a.id === ref.id)
    : factTargets(op, ref.kind).some((f) => f.id === ref.id);
}
export function fieldValueError(
  f: FieldDefinition,
  value: FieldValue | undefined,
  op?: Operation,
  config?: ResolvedConfig,
): string | null {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    return f.required ? "Required value is missing" : null;
  if (f.type === "RICH_TEXT")
    return typeof value === "object" && !Array.isArray(value)
      ? null
      : "Expected rich text";
  if (["INTEGER", "DECIMAL", "DURATION"].includes(f.type))
    return typeof value === "number" &&
      (f.type === "DECIMAL" || Number.isInteger(value))
      ? null
      : "Expected a valid number";
  if (f.type === "BOOLEAN")
    return typeof value === "boolean" ? null : "Expected a boolean";
  if (f.type === "MULTI_SELECT")
    return Array.isArray(value) &&
      value.every((v) => f.options.some((o) => o.id === v))
      ? null
      : "Unknown selection";
  if (typeof value !== "string")
    return "Expected text or a stable reference ID";
  if (f.type === "SINGLE_SELECT" && !f.options.some((o) => o.id === value))
    return "Unknown selection";
  if (
    (f.type === "DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) ||
    (f.type === "TIME" && !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) ||
    (f.type === "DATETIME" &&
      (!/T/.test(value) || !Number.isFinite(Date.parse(value))))
  )
    return "Invalid date/time";
  if (f.type === "URL" && !/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(value))
    return "Unsupported URL";
  if (op && f.type.endsWith("_REFERENCE")) {
    const kind = f.type.split("_")[0].toLowerCase();
    if (kind === "staff")
      return config?.doctrine.staff.some((s) => s.id === value)
        ? null
        : "Missing staff reference";
    if (
      !moduleReferenceExists(op, {
        kind: kind as ModuleReference["kind"],
        id: value,
      })
    )
      return "Missing canonical reference";
  }
  return null;
}
export function moduleFindings(
  op: Operation,
  config: ResolvedConfig,
): Finding[] {
  const findings: Finding[] = [];
  const add = (
    entityId: string,
    field: string,
    message: string,
    severity: Finding["severity"] = "error",
  ) =>
    findings.push({
      ruleId: "module-integrity",
      severity,
      category: "Module authoring",
      entityId,
      field,
      message,
      revision: op.revision,
    });
  const instances = op.modules?.instances ?? [];
  if (
    new Set(instances.map((m) => m.moduleInstanceId)).size !== instances.length
  )
    add(op.id, "instances", "Duplicate module instance IDs");
  const assets = [
    ...(op.modules?.assets ?? []),
    ...(config.doctrine.modules?.assets ?? []),
  ];
  for (const a of op.modules?.assets ?? [])
    if (a.operationId !== op.id || a.doctrineVersionId)
      add(a.assetId, "owner", "Asset belongs to another operation");
  const ref = (m: ModuleInstance, r: ModuleReference) => {
    if (!moduleReferenceExists(op, r))
      add(
        m.moduleInstanceId,
        "reference",
        `Missing canonical ${r.kind} ${r.id}`,
      );
  };
  for (const m of instances) {
    const d = moduleDefinition(m, config),
      cfg = moduleConfiguration(m, config),
      c = m.content;
    const rows =
      c.type === "TABLE" || c.type === "MATRIX"
        ? c.rows
        : c.type === "CHECKLIST" || c.type === "TIMELINE"
          ? c.items
          : c.type === "IMAGE_GALLERY"
            ? c.images
            : c.type === "CHART" && c.source.mode === "DIRECT"
              ? c.source.points
              : c.type === "REPORT_CATALOG" && c.data.kind === "reports"
                ? c.data.reports
                : c.type === "DISTRIBUTION_LIST" &&
                    c.data.kind === "distribution"
                  ? c.data.recipients
                  : [];
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      add(
        m.moduleInstanceId,
        "instances",
        "Duplicate module content identifiers",
      );
    if (
      m.operationId !== op.id ||
      (m.productInstanceId !== op.orderId &&
        !op.attachments.some((a) => a.id === m.productInstanceId))
    )
      add(
        m.moduleInstanceId,
        "binding",
        "Module belongs to another operation/product",
      );
    if (!d) {
      add(
        m.moduleInstanceId,
        "definition",
        "Missing doctrine module definition",
      );
      continue;
    }
    if (m.origin === "DOCTRINE") {
      const productId =
        m.productInstanceId === op.orderId
          ? null
          : op.attachments.find((a) => a.id === m.productInstanceId)
              ?.doctrineNodeId;
      if (
        !config.doctrine.modules?.layouts
          .find((l) => l.productId === productId)
          ?.definitions.some(
            (def) => def.moduleDefinitionId === m.moduleDefinitionId,
          )
      )
        add(
          m.moduleInstanceId,
          "binding",
          "Module definition belongs to another doctrine product",
        );
      if (
        instances.filter(
          (i) =>
            i.productInstanceId === m.productInstanceId &&
            i.moduleDefinitionId === m.moduleDefinitionId,
        ).length > 1
      )
        add(
          m.moduleInstanceId,
          "binding",
          "Duplicate doctrine module instance",
        );
      if (
        m.configurationOverride?.columns &&
        !d.configuration.allowColumnOverride
      )
        add(
          m.moduleInstanceId,
          "configuration",
          "Doctrine table does not permit column overrides",
        );
    }
    if (!moduleTypes.includes(d.moduleType as (typeof moduleTypes)[number]))
      add(
        m.moduleInstanceId,
        "type",
        `Unsupported module type: ${d.moduleType}`,
        d.required ? "error" : "warning",
      );
    else if (c.type !== d.moduleType)
      add(
        m.moduleInstanceId,
        "content",
        "Module content does not match its definition",
      );
    for (const aid of referencedAssets(c))
      if (!assets.some((a) => a.assetId === aid))
        add(m.moduleInstanceId, "asset", `Missing managed asset ${aid}`);
    const values = (
      fields: FieldDefinition[],
      entries: Record<string, FieldValue>,
    ) => {
      for (const f of fields) {
        const error = fieldValueError(f, entries[f.id], op, config);
        if (error) add(m.moduleInstanceId, f.id, `${f.label}: ${error}`);
      }
      for (const key of Object.keys(entries))
        if (!fields.some((f) => f.id === key))
          add(
            m.moduleInstanceId,
            key,
            "Value references a removed field/column; retained for recovery",
          );
    };
    if (c.type === "KEY_VALUE") values(cfg.fields ?? [], c.values);
    if (c.type === "TABLE" || c.type === "MATRIX")
      for (const row of c.rows) values(cfg.columns ?? [], row.cells);
    if (c.type === "CANONICAL_REFERENCES")
      c.references.forEach((r) => ref(m, r));
    if (c.type === "CHECKLIST")
      for (const i of c.items) {
        if (i.unitId) ref(m, { kind: "unit", id: i.unitId });
        if (i.eventId) ref(m, { kind: "event", id: i.eventId });
        if (i.staffId && !config.doctrine.staff.some((s) => s.id === i.staffId))
          add(m.moduleInstanceId, "staff", "Missing responsible staff");
      }
    if (c.type === "TIMELINE")
      for (const i of c.items) {
        if (i.phaseId) ref(m, { kind: "phase", id: i.phaseId });
        if (i.schedule?.unitId) ref(m, { kind: "unit", id: i.schedule.unitId });
        if (i.staffId && !config.doctrine.staff.some((s) => s.id === i.staffId))
          add(m.moduleInstanceId, "staff", "Missing responsible staff");
        const timing = i.timing;
        if (timing.mode === "RELATIVE") {
          if (!timing.withinModule)
            ref(m, { kind: "event", id: timing.referenceEventId });
          else if (
            !c.items.some((other) => other.id === timing.referenceEventId)
          )
            add(
              m.moduleInstanceId,
              "reference",
              "Missing event in this timeline module",
            );
        }
      }
    if (c.type === "CHART" && c.source.mode === "TABLE") {
      const source = c.source,
        table = instances.find(
          (i) =>
            i.moduleInstanceId === source.moduleInstanceId &&
            i.layoutState === "ACTIVE",
        );
      if (!table || !["TABLE", "MATRIX"].includes(table.content.type))
        add(
          m.moduleInstanceId,
          "source",
          "Chart source table is missing or removed",
        );
      else {
        const columns = moduleConfiguration(table, config).columns ?? [];
        if (
          c.chartType === "SCATTER" &&
          columns.some(
            (col) =>
              col.id === source.categoryColumnId &&
              !["INTEGER", "DECIMAL", "DURATION"].includes(col.type),
          )
        )
          add(
            m.moduleInstanceId,
            "source",
            "Scatter chart X column must be numeric",
          );
        for (const cid of [source.categoryColumnId, ...source.valueColumnIds])
          if (!columns.some((col) => col.id === cid))
            add(
              m.moduleInstanceId,
              "source",
              `Chart source column ${cid} is missing`,
            );
        for (const cid of source.valueColumnIds)
          if (
            columns.some(
              (col) =>
                col.id === cid &&
                !["INTEGER", "DECIMAL", "DURATION"].includes(col.type),
            )
          )
            add(
              m.moduleInstanceId,
              "source",
              "Chart value columns must be numeric",
            );
      }
    }
    if (c.type === "REPORT_CATALOG" || c.type === "DISTRIBUTION_LIST") {
      c.data.references.forEach((r) => ref(m, r));
      if (c.data.kind === "reports")
        for (const r of c.data.reports) {
          if (r.recipientUnitId)
            ref(m, { kind: "unit", id: r.recipientUnitId });
          if (r.eventId) ref(m, { kind: "event", id: r.eventId });
        }
      if (c.data.kind === "distribution")
        for (const r of c.data.recipients)
          if (r.unitId) ref(m, { kind: "unit", id: r.unitId });
    }
  }
  return findings;
}
