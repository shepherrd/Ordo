import type { Operation, ResolvedConfig } from "./model";
import { assertOperation } from "./invariants";
import {
  ensureModuleLayout,
  moduleDefinition,
  moduleFindings,
} from "./module-authoring";
import { referencedAssets } from "./modules";

export interface DoctrineUpdateStatus {
  state: "updated" | "conflict" | "deferred";
  doctrineId: string;
  name: string;
  messages: string[];
}
export class DoctrineUpdateConflict extends Error {}

/** Rebind a draft without dropping authored values or changing operation-owned definitions. */
export function adoptDoctrine(
  source: Operation,
  before: ResolvedConfig,
  after: ResolvedConfig,
  uid: () => string,
  now: string,
): Operation {
  const op = structuredClone(source);
  function conflict(message: string): never {
    throw new DoctrineUpdateConflict(message);
  }
  if (before.doctrine.schemaVersion !== after.doctrine.schemaVersion)
    conflict("The doctrine's authoring format changed.");
  for (const p of before.doctrine.paragraphs)
    if (!after.doctrine.paragraphs.some((n) => n.id === p.id))
      conflict(
        `Paragraph “${p.title}” was removed. Review its content and links before updating.`,
      );
  for (const f of before.doctrine.catalog?.baseFields ?? []) {
    const next = after.doctrine.catalog?.baseFields.find((n) => n.id === f.id);
    if (!next)
      conflict(
        `Base-order field “${f.title}” was removed. Review its content and links before updating.`,
      );
    if (next.contentKind !== f.contentKind)
      conflict(`Base-order field “${f.title}” changed its content format.`);
  }
  op.doctrineRef = { id: after.doctrine.id, version: after.doctrine.version };
  op.organizationRef = {
    id: after.organization.id,
    version: after.organization.version,
  };
  op.echelonRef = { id: after.echelon.id, version: after.echelon.version };
  op.sections = after.doctrine.paragraphs.map(
    (p) => op.sections.find((s) => s.id === p.id) ?? { id: p.id, summary: "" },
  );
  op.metadata.statusId = after.doctrine.editingStatus;
  for (const attachment of op.attachments) {
    if (!attachment.doctrineNodeId) continue;
    const old = before.doctrine.catalog?.nodes.find(
      (n) => n.id === attachment.doctrineNodeId,
    );
    const next = after.doctrine.catalog?.nodes.find(
      (n) => n.id === attachment.doctrineNodeId,
    );
    if (!next)
      conflict(`Product “${attachment.name}” was removed from the doctrine.`);
    if (
      old?.parentStableKey !== next.parentStableKey ||
      old?.nodeType !== next.nodeType
    )
      conflict(
        `Product “${attachment.name}” moved to a different place in the hierarchy.`,
      );
    attachment.name = next.canonicalTitle;
    attachment.code = next.code;
  }
  const assetIds = new Map(
    (before.doctrine.modules?.assets ?? []).flatMap((old) => {
      const next = after.doctrine.modules?.assets.find(
        (a) => a.sha256 === old.sha256 && a.mimeType === old.mimeType,
      );
      return next ? [[old.assetId, next.assetId] as const] : [];
    }),
  );
  const remapAssets = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "assetId" && typeof child === "string" && assetIds.has(child))
        (value as Record<string, unknown>)[key] = assetIds.get(child);
      else remapAssets(child);
    }
  };
  for (const m of op.modules?.instances ?? []) {
    if (m.origin === "DOCTRINE") {
      const old = moduleDefinition(m, before),
        next = moduleDefinition(m, after);
      if (!next)
        conflict(
          `Module “${old?.title ?? "Untitled"}” was removed from the doctrine.`,
        );
      if (next.moduleType !== old?.moduleType)
        conflict(`Module “${next.title}” changed its content format.`);
    }
    for (const assetId of referencedAssets(m.content))
      if (
        before.doctrine.modules?.assets.some((a) => a.assetId === assetId) &&
        !assetIds.has(assetId)
      )
        conflict(
          "A doctrine image or file used by this operation was removed or replaced.",
        );
    remapAssets(m.content);
  }
  if (op.operationOrganizationBinding)
    for (const mapping of op.operationOrganizationBinding.resolvedRoleMappings)
      if (!after.doctrine.staff.some((s) => s.id === mapping.staffId))
        conflict(
          `Staff role “${before.doctrine.staff.find((s) => s.id === mapping.staffId)?.name ?? mapping.staffId}” is still mapped to an organization position.`,
        );
  // Existing unfinished required fields are allowed. New invalid/removed values need review.
  const key = (f: ReturnType<typeof moduleFindings>[number]) =>
    `${f.entityId}:${f.field}:${f.message}`;
  const oldErrors = new Set(
    moduleFindings(source, before)
      .filter((f) => f.severity === "error")
      .map(key),
  );
  const newError = moduleFindings(op, after).find(
    (f) => f.severity === "error" && !oldErrors.has(key(f)),
  );
  if (newError)
    conflict(`An existing module needs review: ${newError.message}`);
  if (after.doctrine.modules) {
    ensureModuleLayout(op, after, null, uid, now);
    for (const a of [...op.attachments])
      if (a.doctrineNodeId)
        ensureModuleLayout(op, after, a.doctrineNodeId, uid, now);
  }
  // Readiness was assessed against the previous doctrine.
  for (const p of op.planningProgress?.products ?? [])
    if (p.readyAt) {
      p.readyAt = null;
      p.reopenedReason = "Writing changed";
    }
  try {
    return assertOperation(op, after);
  } catch (e) {
    return conflict((e as Error).message);
  }
}
