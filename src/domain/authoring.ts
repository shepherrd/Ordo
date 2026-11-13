import {
  metadata,
  type Attachment,
  type Operation,
  type ResolvedConfig,
  type Finding,
} from "./model";
import {
  type Applicability,
  type DoctrineNode,
  type FactReference,
  type ProductContent,
  resolveEditor,
} from "./doctrine";
import type { RichNode } from "./modules";

export const catalogNodes = (config: ResolvedConfig) =>
  config.doctrine.catalog?.nodes ?? [];
export const productFor = (op: Operation, node: DoctrineNode) =>
  op.attachments.find((a) => a.doctrineNodeId === node.id);
export function productCode(
  node: DoctrineNode,
  config: ResolvedConfig,
): string {
  const parent = catalogNodes(config).find(
    (p) => p.stableKey === node.parentStableKey,
  );
  return parent ? `${productCode(parent, config)}.${node.code}` : node.code;
}
export function inheritedOwner(
  node: DoctrineNode,
  config: ResolvedConfig,
): string | null {
  if (node.ownerBehavior === "EXPLICIT")
    return node.responsibleStaff[0] ?? null;
  const parent = catalogNodes(config).find(
    (n) => n.stableKey === node.parentStableKey,
  );
  return parent ? inheritedOwner(parent, config) : null;
}
export function productOwner(
  op: Operation,
  node: DoctrineNode,
  config: ResolvedConfig,
): string | null {
  const assigned = productFor(op, node)?.metadata.ownerId;
  if (assigned) return assigned;
  if (node.ownerBehavior === "INHERIT_PARENT") {
    const parent = catalogNodes(config).find(
      (n) => n.stableKey === node.parentStableKey,
    );
    return parent ? productOwner(op, parent, config) : null;
  }
  return inheritedOwner(node, config);
}
export function instantiateProduct(
  op: Operation,
  config: ResolvedConfig,
  nodeId: string,
  id: () => string,
): Attachment {
  const node = catalogNodes(config).find((n) => n.id === nodeId);
  if (!node) throw Error("Unknown doctrine product");
  if (node.status === "SPARE")
    throw Error(
      "A spare requires an explicit organization doctrine override before authoring",
    );
  const existing = productFor(op, node);
  if (existing) return existing;
  const parent = catalogNodes(config).find(
    (n) => n.stableKey === node.parentStableKey,
  );
  const parentId = parent
    ? instantiateProduct(op, config, parent.id, id).id
    : op.orderId;
  const attachment: Attachment = {
    id: id(),
    name: node.canonicalTitle,
    metadata: metadata(config.doctrine.editingStatus),
    kind: node.nodeType.toLowerCase() as Attachment["kind"],
    parentId,
    code: node.code,
    catalogId: node.nodeType === "ANNEX" ? node.id : null,
    doctrineNodeId: node.id,
    applicability: "UNDECIDED",
    narrative: "",
    phaseIds: [],
    unitIds: [],
    required: false,
  };
  op.attachments.push(attachment);
  return attachment;
}
export function setApplicability(
  op: Operation,
  config: ResolvedConfig,
  nodeId: string,
  value: Applicability,
  id: () => string,
): void {
  // Validate before mutating the aggregate so a rejected action leaves the draft intact.
  const draft = structuredClone(op);
  instantiateProduct(draft, config, nodeId, id).applicability = value;
  const errors = authoringFindings(draft, config).filter(
    (f) => f.severity === "error",
  );
  if (errors.length) throw Error(errors[0].message);
  op.attachments = draft.attachments;
}
export function emptyContent(
  node: DoctrineNode,
  id: () => string,
): ProductContent {
  switch (resolveEditor(node.editorHint).capability) {
    case "MATRIX":
      return {
        kind: "matrix",
        references: [],
        columns: [
          { id: id(), title: "Item" },
          { id: id(), title: "Notes" },
        ],
        rows: [],
      };
    case "CHECKLIST":
      return { kind: "checklist", references: [], items: [] };
    case "REPORT_CATALOG":
      return { kind: "reports", references: [], reports: [] };
    case "DISTRIBUTION_LIST":
      return { kind: "distribution", references: [], recipients: [] };
    case "FIVE_PARAGRAPH_ATTACHMENT":
      return {
        kind: "narrative",
        references: [],
        sections: [
          "Situation",
          "Mission",
          "Execution",
          "Sustainment",
          "Command and Signal",
        ].map((title) => ({ id: id(), title, text: "" })),
      };
    case "NARRATIVE_DOCUMENT":
      return {
        kind: "narrative",
        references: [],
        sections: [{ id: id(), title: "Narrative", text: "" }],
      };
    default:
      return { kind: "generic", references: [], fields: [] };
  }
}
export function factTargets(
  op: Operation,
  kind: FactReference["kind"],
): { id: string; name: string }[] {
  return {
    unit: op.units,
    task: op.tasks,
    objective: op.objectives,
    phase: op.phases,
    event: op.events,
    signal: [{ id: op.signal.id, name: "Authoritative Signal workspace" }],
    net: op.signal.nets,
    pace: op.signal.pacePlans,
  }[kind];
}
export function factValue(op: Operation, ref: FactReference): unknown {
  const entity = factTargets(op, ref.kind).find((t) => t.id === ref.id);
  if (!entity) throw Error(`Missing authoritative ${ref.kind} reference`);
  const unitName = (id: string | null) =>
    op.units.find((u) => u.id === id)?.name ?? "Unassigned";
  if (ref.kind === "task") {
    const task = op.tasks.find((t) => t.id === ref.id)!;
    return {
      task: task.name,
      purpose: task.purpose,
      unit: unitName(task.unitId),
      phase: op.phases.find((p) => p.id === task.phaseId)?.name ?? "",
      objective:
        op.objectives.find((o) => o.id === task.objectiveId)?.name ?? "",
    };
  }
  if (ref.kind === "event") {
    const resolve = (
      id: string,
      visited = new Set<string>(),
    ): string | null => {
      if (visited.has(id)) return null;
      visited.add(id);
      const e = op.events.find((t) => t.id === id);
      if (!e) return null;
      if (e.at) return e.at;
      const base = e.relativeToEventId
        ? resolve(e.relativeToEventId, visited)
        : null;
      return base
        ? new Date(Date.parse(base) + e.offsetMinutes * 60000).toISOString()
        : null;
    };
    const event = op.events.find((e) => e.id === ref.id)!;
    return {
      event: event.name,
      time: resolve(event.id),
      relativeTo:
        op.events.find((e) => e.id === event.relativeToEventId)?.name ?? "",
      offsetMinutes: event.offsetMinutes,
    };
  }
  if (ref.kind === "signal")
    return {
      ...op.signal,
      nets: op.signal.nets.map((n) => ({
        ...n,
        participants: n.participantUnitIds.map(unitName),
      })),
      pacePlans: op.signal.pacePlans.map((p) => ({
        ...p,
        units: p.unitIds.map(unitName),
      })),
    };
  if (ref.kind === "net") {
    const n = op.signal.nets.find((n) => n.id === ref.id)!;
    return { ...n, participants: n.participantUnitIds.map(unitName) };
  }
  if (ref.kind === "pace") {
    const p = op.signal.pacePlans.find((p) => p.id === ref.id)!;
    return { ...p, units: p.unitIds.map(unitName) };
  }
  return entity;
}
export function factDescription(op: Operation, ref: FactReference): string {
  if (ref.kind === "signal")
    return [
      op.signal.concept,
      op.signal.architecture,
      op.signal.spectrumNotes,
      op.signal.maintenanceNotes,
      ...op.signal.nets.map((n) =>
        factDescription(op, { kind: "net", id: n.id }),
      ),
      ...op.signal.pacePlans.map((p) =>
        factDescription(op, { kind: "pace", id: p.id }),
      ),
    ]
      .filter(Boolean)
      .join("\n");
  const value = factValue(op, ref) as Record<string, unknown>;
  return Object.entries(value)
    .filter(
      ([k, v]) =>
        ![
          "id",
          "metadata",
          "parentUnitId",
          "participantUnitIds",
          "unitIds",
          "phaseIds",
        ].includes(k) &&
        v !== "" &&
        v !== null &&
        typeof v !== "object",
    )
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}
export function substantiveContent(
  op: Operation,
  a: Pick<Attachment, "id" | "narrative" | "content"> | undefined,
  node?: DoctrineNode,
): boolean {
  if (!a) return false;
  const rich = (n: RichNode): boolean =>
    n.type === "image" || !!n.text?.trim() || !!n.content?.some(rich);
  if (
    op.modules?.instances.some((m) => {
      if (m.productInstanceId !== a.id || m.layoutState !== "ACTIVE")
        return false;
      const c = m.content;
      switch (c.type) {
        case "PLANNING_CARDS":
          return c.placements.some((p) =>
            op.planningCards?.definitions.some((card) => card.id === p.cardId),
          );
        case "PLAIN_TEXT":
          return !!c.text.trim();
        case "RICH_TEXT":
          return rich(c.document);
        case "KEY_VALUE":
          return Object.values(c.values).some(
            (v) =>
              v !== null && v !== "" && (!Array.isArray(v) || v.length > 0),
          );
        case "TABLE":
        case "MATRIX":
          return c.rows.some((r) =>
            Object.values(r.cells).some((v) => v !== null && v !== ""),
          );
        case "CHECKLIST":
          return c.items.some((i) => !!i.text.trim());
        case "TIMELINE":
          return c.items.length > 0;
        case "CHART":
          return c.source.mode === "TABLE" || c.source.points.length > 0;
        case "IMAGE":
          return !!c.image;
        case "IMAGE_GALLERY":
          return c.images.length > 0;
        case "FILE_ATTACHMENT":
          return !!c.assetId;
        case "CANONICAL_REFERENCES":
          return c.references.length > 0;
        case "TASK_ORGANIZATION":
          return op.units.some((u) => u.inTaskOrganization);
        case "SIGNAL_NET_MATRIX":
          return op.signal.nets.length > 0;
        case "PACE":
          return op.signal.pacePlans.length > 0;
        case "REPORT_CATALOG":
          return c.data.kind === "reports" && c.data.reports.length > 0;
        case "DISTRIBUTION_LIST":
          return c.data.kind === "distribution" && c.data.recipients.length > 0;
        default:
          return false;
      }
    })
  )
    return true;
  if (node?.editorHint === "TASK_ORGANIZATION_TREE")
    return op.units.some((u) => u.inTaskOrganization);
  if (node?.editorHint === "SIGNAL_WORKSPACE")
    return !!(
      op.signal.concept.trim() ||
      op.signal.nets.length ||
      op.signal.pacePlans.length
    );
  if (a.narrative.trim()) return true;
  const c = a.content;
  if (!c) return false;
  if (c.references.length) return true;
  switch (c.kind) {
    case "matrix":
      return c.rows.some((r) => Object.values(r.cells).some((v) => v.trim()));
    case "checklist":
      return c.items.some((i) => i.text.trim());
    case "reports":
      return c.reports.length > 0;
    case "distribution":
      return c.recipients.length > 0;
    case "narrative":
      return c.sections.some((s) => s.text.trim());
    case "generic":
      return c.fields.some((f) => f.value.trim());
  }
}
export function packageIncluded(op: Operation, a: Attachment): boolean {
  const seen = new Set<string>();
  let current: Attachment | undefined = a;
  while (current) {
    if (seen.has(current.id) || current.applicability !== "INCLUDED")
      return false;
    seen.add(current.id);
    if (current.parentId === op.orderId) return true;
    current = op.attachments.find((p) => p.id === current!.parentId);
  }
  return false;
}
export type PackageFilter =
  | "All"
  | "Included"
  | "Omitted"
  | "Undecided"
  | "Spare"
  | "Has Issues"
  | "By Owner";
export function packageRows(
  op: Operation,
  config: ResolvedConfig,
  findings: Finding[] = [],
  filter: PackageFilter = "All",
  owner = "",
) {
  return catalogNodes(config)
    .map((node) => {
      const attachment = productFor(op, node),
        applicability = attachment?.applicability ?? "UNDECIDED";
      return {
        node,
        attachment,
        applicability,
        ownerId: productOwner(op, node, config),
        statusId: attachment?.metadata.statusId ?? "not-started",
        findings: findings.filter(
          (f) =>
            f.entityId === node.id ||
            f.entityId === attachment?.id ||
            !!op.modules?.instances.some(
              (m) =>
                m.productInstanceId === attachment?.id &&
                m.moduleInstanceId === f.entityId,
            ),
        ),
        hasContent: substantiveContent(op, attachment, node),
        inPreview: !!attachment && packageIncluded(op, attachment),
      };
    })
    .filter(
      (r) =>
        filter === "All" ||
        (filter === "Spare" && r.node.status === "SPARE") ||
        (filter === "Has Issues" && r.findings.length) ||
        (filter === "By Owner" && r.ownerId === owner) ||
        (filter === "Included" &&
          r.node.status !== "SPARE" &&
          r.applicability === "INCLUDED") ||
        (filter === "Omitted" &&
          r.node.status !== "SPARE" &&
          r.applicability === "OMITTED") ||
        (filter === "Undecided" &&
          r.node.status !== "SPARE" &&
          r.applicability === "UNDECIDED"),
    );
}
export function authoringFindings(
  op: Operation,
  config: ResolvedConfig,
): Finding[] {
  if (!config.doctrine.catalog) return [];
  const nodes = catalogNodes(config),
    findings: Finding[] = [];
  const report = (
    entityId: string,
    message: string,
    severity: Finding["severity"] = "error",
    field = "applicability",
  ) =>
    findings.push({
      ruleId: "doctrine-authoring",
      severity,
      category: "doctrine",
      entityId,
      field,
      message,
      revision: op.revision,
    });
  if (op.schemaVersion !== 2)
    report(op.id, "This doctrine requires the structured operation schema");
  for (const node of nodes)
    if (resolveEditor(node.editorHint).fallback)
      report(
        node.id,
        `Editor “${node.editorHint}” is unavailable. The generic structured editor will preserve authored content.`,
        "warning",
        "editorHint",
      );
  const seen = new Set<string>();
  for (const a of op.attachments) {
    const node = nodes.find((n) => n.id === a.doctrineNodeId);
    if (!node) {
      report(
        a.id,
        "An authored doctrine product must reference a node in the pinned catalog",
      );
      continue;
    }
    if (seen.has(node.id))
      report(a.id, "A doctrine node may be instantiated only once");
    seen.add(node.id);
    if (node.status === "SPARE")
      report(
        a.id,
        "A spare cannot be repurposed without an organization doctrine override",
      );
    if (!a.applicability)
      report(a.id, "An authored product requires operation applicability");
    if (
      a.name !== node.canonicalTitle ||
      a.code !== node.code ||
      a.kind.toUpperCase() !== node.nodeType ||
      a.catalogId !== (node.nodeType === "ANNEX" ? node.id : null)
    )
      report(
        a.id,
        "Doctrine identity, title, code and format are read-only; use an organization profile override",
      );
    const parent = op.attachments.find((p) => p.id === a.parentId);
    const parentNode = nodes.find((n) => n.stableKey === node.parentStableKey);
    if (
      parentNode
        ? parent?.doctrineNodeId !== parentNode.id
        : a.parentId !== op.orderId
    )
      report(
        a.id,
        "Product parent does not match the pinned doctrine hierarchy",
      );
    if (a.applicability === "INCLUDED") {
      let p = parent;
      const visited = new Set<string>();
      while (p && !visited.has(p.id)) {
        visited.add(p.id);
        if (p.applicability === "OMITTED") {
          report(
            a.id,
            "An included child cannot have an omitted parent. Reset or omit the child first.",
          );
          break;
        }
        p = op.attachments.find((t) => t.id === p!.parentId);
      }
      if (!packageIncluded(op, a))
        report(
          a.id,
          "Include every ancestor to make this product part of the package preview.",
          "warning",
        );
      if (!substantiveContent(op, a, node))
        report(
          a.id,
          "Included product has no substantive content yet.",
          "warning",
          "content",
        );
    }
    if (a.applicability !== "OMITTED")
      for (const other of nodes.filter(
        (n) =>
          n.alternativeToStableKey === node.stableKey ||
          node.alternativeToStableKey === n.stableKey,
      )) {
        const alternate = productFor(op, other);
        if (alternate && alternate.applicability !== "OMITTED")
          report(
            a.id,
            "Canonical and sample alternatives with the same code cannot both be active. Omit one alternative before authoring or including the other.",
          );
      }
    const c = a.content;
    const refs = [...(c?.references ?? [])];
    const allowed = resolveEditor(node.editorHint).capability;
    const expected =
      allowed === "MATRIX"
        ? "matrix"
        : allowed === "CHECKLIST"
          ? "checklist"
          : allowed === "REPORT_CATALOG"
            ? "reports"
            : allowed === "DISTRIBUTION_LIST"
              ? "distribution"
              : ["FIVE_PARAGRAPH_ATTACHMENT", "NARRATIVE_DOCUMENT"].includes(
                    allowed,
                  )
                ? "narrative"
                : "generic";
    if (
      c &&
      (["TASK_ORGANIZATION_TREE", "SIGNAL_WORKSPACE"].includes(allowed) ||
        c.kind !== expected)
    )
      report(
        a.id,
        "Product content must match its capability; canonical unit and Signal facts cannot be copied into attachment content",
        "error",
        "content",
      );
    const localIds: string[] = [];
    if (c?.kind === "matrix") {
      localIds.push(...c.columns.map((x) => x.id), ...c.rows.map((x) => x.id));
      if (
        c.rows.some((r) =>
          Object.keys(r.cells).some(
            (key) => !c.columns.some((col) => col.id === key),
          ),
        )
      )
        report(
          a.id,
          "Matrix cell references an unknown column",
          "error",
          "content",
        );
    }
    if (c?.kind === "checklist") localIds.push(...c.items.map((x) => x.id));
    if (c?.kind === "generic") localIds.push(...c.fields.map((x) => x.id));
    if (c?.kind === "narrative") localIds.push(...c.sections.map((x) => x.id));
    if (c?.kind === "reports") {
      localIds.push(...c.reports.map((x) => x.id));
      for (const r of c.reports) {
        if (r.recipientUnitId)
          refs.push({ kind: "unit", id: r.recipientUnitId });
        if (r.eventId) refs.push({ kind: "event", id: r.eventId });
      }
    }
    if (c?.kind === "distribution") {
      localIds.push(...c.recipients.map((x) => x.id));
      for (const r of c.recipients)
        if (r.unitId) refs.push({ kind: "unit", id: r.unitId });
    }
    if (new Set(localIds).size !== localIds.length)
      report(a.id, "Duplicate content identity", "error", "content");
    for (const ref of refs)
      if (!factTargets(op, ref.kind).some((e) => e.id === ref.id))
        report(
          a.id,
          `Missing authoritative ${ref.kind} reference`,
          "error",
          "references",
        );
  }
  const fields = op.authoring?.fields ?? [];
  if (new Set(fields.map((f) => f.fieldId)).size !== fields.length)
    report(op.orderId, "Duplicate structured base field");
  for (const field of fields) {
    const definition = config.doctrine.catalog.baseFields.find(
      (f) => f.id === field.fieldId,
    );
    if (!definition) {
      report(op.orderId, "Unknown structured base field");
      continue;
    }
    if (definition.contentKind !== "structured-fields" && field.entries?.length)
      report(
        op.orderId,
        "Structured entries are only valid on a structured-fields definition",
      );
    if (
      [
        "group",
        "canonical-tasks",
        "task-collection",
        "structured-fields",
      ].includes(definition.contentKind) &&
      field.text.trim()
    )
      report(
        op.orderId,
        "This structured definition does not accept an additional free-form narrative",
      );
    if (
      new Set(field.entries?.map((e) => e.id)).size !==
      (field.entries?.length ?? 0)
    )
      report(op.orderId, "Duplicate structured field entry identity");
    for (const ref of [
      ...field.references,
      ...(field.entries ?? []).flatMap((e) => e.references),
    ])
      if (
        !definition.bindings.includes(ref.kind) ||
        !factTargets(op, ref.kind).some((e) => e.id === ref.id)
      )
        report(
          op.orderId,
          `Invalid ${ref.kind} reference in ${definition.title}`,
          "error",
          "references",
        );
  }
  return findings;
}
