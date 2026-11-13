import { reviewImpacts } from "./review-impact";
import { resolveResponsibleStaff } from "../domain/staff-resolution";
import {
  canonicalValue,
  type ResolvedEndpoint,
  type ChangeRecord,
  type Hash,
  type ChangeImpact,
} from "../domain/diff/model";
import type { ExportRecord } from "../domain/model";
import { catalogNodes } from "../domain/authoring";
export function reviewImpactsV2(
  a: ResolvedEndpoint,
  b: ResolvedEndpoint,
  changes: ChangeRecord[],
  exports: ExportRecord[],
  hash: Hash,
): ChangeImpact[] {
  const impacts = reviewImpacts(a, b, changes, exports, hash);
  const products = new Set([
    a.operation.orderId,
    ...a.operation.attachments.map((p) => p.id),
    ...b.operation.attachments.map((p) => p.id),
  ]);
  for (const productId of products) {
    const pa = a.operation.attachments.find((p) => p.id === productId),
      pb = b.operation.attachments.find((p) => p.id === productId);
    const before = resolveResponsibleStaff(
        a.operation,
        a.config,
        pa?.doctrineNodeId ?? null,
      ),
      after = resolveResponsibleStaff(
        b.operation,
        b.config,
        pb?.doctrineNodeId ?? null,
      );
    const value = (r: typeof before) => ({
      positionId: r.position?.positionId ?? null,
      title: r.label,
      sectionId: r.position?.sectionId ?? null,
      role: r.role,
      warning: r.warning,
    });
    if (canonicalValue(value(before)) === canonicalValue(value(after)))
      continue;
    const dependencies = new Set<string>([productId]);
    for (const e of [a, b]) {
      let p = e.operation.attachments.find((p) => p.id === productId);
      let node = catalogNodes(e.config).find((n) => n.id === p?.doctrineNodeId);
      const visited = new Set<string>();
      while (
        node &&
        node.ownerBehavior === "INHERIT_PARENT" &&
        !p?.metadata.ownerId &&
        !e.operation.staffPositionOverrides?.some(
          (o) => o.productId === p?.id,
        ) &&
        !visited.has(node.id)
      ) {
        visited.add(node.id);
        node = catalogNodes(e.config).find(
          (n) => n.stableKey === node!.parentStableKey,
        );
        p = e.operation.attachments.find((p) => p.doctrineNodeId === node?.id);
        if (p) dependencies.add(p.id);
      }
    }
    const relevant = changes.filter(
      (c) =>
        c.fieldPath === "operationOrganizationBinding" ||
        ((c.category === "RESPONSIBLE_STAFF" ||
          c.fieldPath.endsWith("ownerId")) &&
          dependencies.has(c.productId ?? c.entityId)),
    );
    if (!relevant.length) continue;
    impacts.push({
      id: hash(
        `impact-v2:staff:${productId}:${canonicalValue(value(before))}:${canonicalValue(value(after))}`,
      ),
      changeIds: relevant.map((c) => c.changeId),
      kind: "EFFECTIVE_OWNER",
      targetId: productId,
      productId,
      label: `Responsible Staff · ${pb?.name ?? pa?.name ?? "Base order"}`,
      reason:
        "The saved organization binding or operational ownership changes the resolved staff position.",
      chain: ["Saved organization/staff configuration", "Responsible Staff"],
      beforeDisplay:
        before.label + (before.warning ? ` · ${before.warning}` : ""),
      afterDisplay: after.label + (after.warning ? ` · ${after.warning}` : ""),
      dependencyPaths: [
        "operationOrganizationBinding",
        "staffPositionOverrides",
      ],
      baselineOutdated: null,
      targetOutdated: null,
      compatibility: after.warning ? "unresolved" : "supported",
    });
  }
  return impacts;
}
