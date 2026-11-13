import type { Operation, ResolvedConfig } from "./model";
import { packageIncluded, substantiveContent } from "./authoring";
import { resolveResponsibleStaff } from "./staff-resolution";
import { narrativePlainText } from "./narrative";
import { orderProgress } from "./order-progress";
import { planningReferences } from "./planning-usage";
import { resolvePlanningCard } from "./planning-card-resolution";
import { targetKey, type OperationSearchTarget } from "./planning-target";

export type ProductProgress = {
  id: string;
  name: string;
  nodeId: string | null;
  included: boolean;
  staffId: string | null;
  staff: string;
  warning: string;
  state: "Not started" | "In progress" | "Ready";
  dueAt: string | null;
  readyAt: string | null;
  overdue: boolean;
  reopenedReason?: string;
};

export function planningProducts(
  op: Operation,
  config: ResolvedConfig,
  now = Date.now(),
): ProductProgress[] {
  const records = new Map(
    (op.planningProgress?.products ?? []).map((p) => [p.productId, p]),
  );
  return [null, ...op.attachments].map((a) => {
    const id = a?.id ?? op.orderId,
      node = config.doctrine.catalog?.nodes.find(
        (n) => n.id === a?.doctrineNodeId,
      );
    const responsible =
      !a || node ? resolveResponsibleStaff(op, config, node?.id ?? null) : null;
    const staffId = responsible?.staffId ?? a?.metadata.ownerId ?? null;
    const record = records.get(id);
    const hasContent = a
      ? substantiveContent(
          op,
          { ...a, narrative: narrativePlainText(a.narrative) },
          node,
        )
      : orderProgress(op, config).started > 0 ||
        substantiveContent(op, { id, narrative: "" });
    const state = record?.readyAt
      ? "Ready"
      : hasContent
        ? "In progress"
        : "Not started";
    return {
      id,
      name: a
        ? `${a.kind[0].toUpperCase()}${a.kind.slice(1)} ${a.code} · ${a.name}`
        : "Base order",
      nodeId: a?.doctrineNodeId ?? null,
      included: !a || !a.doctrineNodeId || packageIncluded(op, a),
      staffId,
      staff:
        responsible?.label ??
        config.doctrine.staff.find((s) => s.id === staffId)?.name ??
        "Unassigned",
      warning: responsible?.warning ?? "",
      state,
      dueAt: record?.dueAt ?? null,
      readyAt: record?.readyAt ?? null,
      reopenedReason: record?.reopenedReason,
      overdue:
        state !== "Ready" && !!record?.dueAt && Date.parse(record.dueAt) < now,
    };
  });
}

export function setProductProgress(
  op: Operation,
  productId: string,
  edit: { dueAt?: string | null; readyAt?: string | null },
) {
  if (
    productId !== op.orderId &&
    !op.attachments.some((a) => a.id === productId)
  )
    throw Error("Product is unavailable");
  op.planningProgress ??= { schemaVersion: 1, products: [] };
  let record = op.planningProgress.products.find(
    (p) => p.productId === productId,
  );
  if (!record) {
    record = { productId, dueAt: null, readyAt: null };
    op.planningProgress.products.push(record);
  }
  Object.assign(record, edit);
  if (edit.readyAt !== undefined) delete record.reopenedReason;
  op.planningProgress.products = op.planningProgress.products.filter(
    (p) => p.dueAt || p.readyAt || p.reopenedReason,
  );
}

const contentKey = (op: Operation, productId: string) =>
  JSON.stringify({
    content:
      productId === op.orderId
        ? [op.sections, op.authoring]
        : (() => {
            const a = op.attachments.find((p) => p.id === productId);
            return (
              a && [
                a.name,
                a.code,
                a.narrative,
                a.content,
                a.applicability,
                a.phaseIds,
                a.unitIds,
              ]
            );
          })(),
    modules: op.modules?.instances
      .filter((m) => m.productInstanceId === productId)
      .map((m) => [
        m.moduleInstanceId,
        m.content,
        m.configurationOverride,
        m.layoutState,
        m.position,
      ]),
  });
/** Follow explicit references and generated collections; ordinary prose is not a link. */
function factsKey(op: Operation, productId: string, config?: ResolvedConfig) {
  const base = productId === op.orderId;
  const modules =
    op.modules?.instances.filter(
      (m) => m.productInstanceId === productId && m.layoutState === "ACTIVE",
    ) ?? [];
  const moduleIds = new Set(modules.map((m) => m.moduleInstanceId));
  const refs = planningReferences(op, config).filter(
    (r) =>
      r.kind === "Current reference" &&
      r.from.area === "operation" &&
      r.to.area === "operation",
  );
  const queue: OperationSearchTarget[] = [];
  const outgoing = new Map<string, OperationSearchTarget[]>();
  for (const r of refs)
    if (r.from.area === "operation" && r.to.area === "operation") {
      const key = targetKey(r.from.target);
      outgoing.set(key, [...(outgoing.get(key) ?? []), r.to.target]);
    }
  const entities = new Map(
    [
      ...op.units,
      ...op.tasks,
      ...op.objectives,
      ...op.phases,
      ...op.events,
    ].map((e) => [e.id, e]),
  );
  const values: unknown[] = [
    op.name,
    op.orderNumber,
    op.metadata.documentLayout,
  ];
  for (const r of refs) {
    if (r.from.area !== "operation" || r.to.area !== "operation") continue;
    const t = r.from.target;
    if (
      ("attachmentId" in t && t.attachmentId === productId) ||
      ("moduleId" in t && moduleIds.has(t.moduleId)) ||
      (base && ["base-field", "paragraph"].includes(t.kind))
    )
      queue.push(r.to.target);
  }
  const addEntities = (kind: "unit" | "task") =>
    (kind === "unit" ? op.units : op.tasks).forEach((e) =>
      queue.push({ kind: "entity", entityKind: kind, entityId: e.id }),
    );
  // Legacy orders print their shared fact tables; modern orders use explicit fields/blocks.
  if (base && !op.authoring)
    values.push(
      op.units,
      op.tasks,
      op.objectives,
      op.phases,
      op.events,
      op.signal,
    );
  if (
    base &&
    config?.doctrine.catalog?.baseFields.some(
      (f) => f.contentKind === "canonical-tasks",
    )
  )
    addEntities("task");
  const attachment = op.attachments.find((a) => a.id === productId);
  const capability = config?.doctrine.catalog?.nodes.find(
    (n) => n.id === attachment?.doctrineNodeId,
  )?.editorHint;
  if (
    modules.some((m) => m.content.type === "TASK_ORGANIZATION") ||
    capability === "TASK_ORGANIZATION_TREE"
  )
    addEntities("unit");
  if (
    modules.some((m) =>
      ["SIGNAL_NET_MATRIX", "PACE"].includes(m.content.type),
    ) ||
    capability === "SIGNAL_WORKSPACE"
  )
    values.push(
      op.signal,
      op.units.map((u) => [u.id, u.name]),
      op.phases.map((p) => [p.id, p.name]),
    );
  const seen = new Set<string>();
  while (queue.length) {
    const t = queue.pop()!,
      key = targetKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    if (t.kind === "card") {
      const card = op.planningCards?.definitions.find((c) => c.id === t.cardId);
      try {
        const resolved =
          card && config ? resolvePlanningCard(op, config, card) : null;
        values.push([
          key,
          card && resolved
            ? {
                title: card.title,
                fields: card.fields,
                resolved: resolved.values,
                unitIds: resolved.unitIds,
                phaseIds: resolved.phaseIds,
              }
            : card,
        ]);
      } catch {
        values.push([key, "Source unavailable"]);
      }
      continue;
    }
    if (t.kind === "entity") {
      values.push([key, entities.get(t.entityId)]);
    } else if (t.kind === "net")
      values.push([key, op.signal.nets.find((n) => n.id === t.entityId)]);
    else if (t.kind === "pace")
      values.push([key, op.signal.pacePlans.find((n) => n.id === t.entityId)]);
    else if (t.kind === "module")
      values.push([
        key,
        op.modules?.instances.find((m) => m.moduleInstanceId === t.moduleId)
          ?.content,
      ]);
    else if (t.kind === "product")
      values.push([key, op.attachments.find((a) => a.id === t.attachmentId)]);
    else if (t.kind === "operation")
      values.push([key, op.sections, op.authoring]);
    queue.push(...(outgoing.get(key) ?? []));
  }
  return JSON.stringify(values);
}

/** Ready is a writing attestation, never an approval. Preserve explicit re-attestation. */
export function refreshPlanningReadiness(
  before: Operation,
  after: Operation,
  config?: ResolvedConfig,
): Operation {
  if (!after.planningProgress) return after;
  const prior = new Map(
    (before.planningProgress?.products ?? []).map((p) => [p.productId, p]),
  );
  const existing = new Set([
    after.orderId,
    ...after.attachments.map((a) => a.id),
  ]);
  const removed = new Set(
    before.attachments.filter((a) => !existing.has(a.id)).map((a) => a.id),
  );
  const candidates = after.planningProgress.products.filter(
    (p) => p.readyAt && p.readyAt === prior.get(p.productId)?.readyAt,
  );
  const reopen = new Map<
    string,
    "Writing changed" | "Linked information changed"
  >();
  for (const p of candidates) {
    if (contentKey(before, p.productId) !== contentKey(after, p.productId))
      reopen.set(p.productId, "Writing changed");
    else if (
      factsKey(before, p.productId, config) !==
      factsKey(after, p.productId, config)
    )
      reopen.set(p.productId, "Linked information changed");
  }
  if (
    !reopen.size &&
    !after.planningProgress.products.some((p) => removed.has(p.productId))
  )
    return after;
  const next = structuredClone(after);
  next.planningProgress!.products = next.planningProgress!.products.filter(
    (p) => !removed.has(p.productId),
  );
  for (const record of next.planningProgress!.products)
    if (reopen.has(record.productId)) {
      record.readyAt = null;
      record.reopenedReason = reopen.get(record.productId)!;
    }
  return next;
}
