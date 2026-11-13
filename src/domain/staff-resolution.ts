import type { Operation, ResolvedConfig } from "./model";
import { productOwner, inheritedOwner, catalogNodes } from "./authoring";
import { functionalRoleSchema, type StaffPosition } from "./unit-profiles";
import type { z } from "zod";
export interface StaffResolution {
  label: string;
  doctrineLabel: string;
  staffId: string | null;
  role: z.infer<typeof functionalRoleSchema> | null;
  position: StaffPosition | null;
  unitProfileVersionId: string | null;
  warning: string;
  inherited: boolean;
  overridden: boolean;
}
export function resolveResponsibleStaff(
  op: Operation,
  config: ResolvedConfig,
  nodeId: string | null,
): StaffResolution {
  const node = catalogNodes(config).find((n) => n.id === nodeId),
    binding = op.operationOrganizationBinding;
  const staffId = node ? productOwner(op, node, config) : op.metadata.ownerId;
  const doctrineStaffId = node ? inheritedOwner(node, config) : staffId;
  const doctrineLabel =
    config.doctrine.staff.find((s) => s.id === doctrineStaffId)?.name ??
    doctrineStaffId ??
    "Unassigned";
  const productId = node
    ? op.attachments.find((a) => a.doctrineNodeId === node.id)?.id
    : op.orderId;
  let override = op.staffPositionOverrides?.find(
      (o) => o.productId === productId,
    ),
    inherited = false;
  if (
    !override &&
    node?.ownerBehavior === "INHERIT_PARENT" &&
    !op.attachments.find((a) => a.id === productId)?.metadata.ownerId
  ) {
    const parent = catalogNodes(config).find(
      (n) => n.stableKey === node.parentStableKey,
    );
    if (parent) {
      const result = resolveResponsibleStaff(op, config, parent.id);
      return { ...result, inherited: true };
    }
  }
  const legacyOverride = node
    ? !!op.attachments.find((a) => a.id === productId)?.metadata.ownerId
    : !!op.metadata.ownerId;
  const role =
    binding?.resolvedRoleMappings.find((r) => r.staffId === staffId)
      ?.functionalRole ?? null;
  const candidates =
    binding?.staff.positions.filter(
      (p) => p.functionalRole === role && role !== null,
    ) ?? [];
  const preferred = candidates.filter((p) => p.defaultForRole);
  const position = override
    ? binding?.staff.positions.find((p) => p.positionId === override.positionId)
    : preferred.length === 1
      ? preferred[0]
      : candidates.length === 1
        ? candidates[0]
        : undefined;
  const warning =
    !binding || (!staffId && !override)
      ? ""
      : !role && !override
        ? "No functional-role mapping configured"
        : !position
          ? candidates.length > 1
            ? "Ambiguous role: designate a default organization position"
            : "No matching organization position configured"
          : "";
  return {
    label:
      position?.title ??
      config.doctrine.staff.find((s) => s.id === staffId)?.name ??
      staffId ??
      "Unassigned",
    doctrineLabel,
    staffId,
    role,
    position: position ?? null,
    unitProfileVersionId: binding?.unitProfileVersionId ?? null,
    warning,
    inherited,
    overridden: !!override || legacyOverride,
  };
}
