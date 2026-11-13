import type { Operation, ResolvedConfig } from "./model";
import type { OperationOrganizationBinding } from "./unit-profiles";
import { assertOperation } from "./invariants";

export interface OrganizationUpdateStatus {
  state: "updated" | "conflict" | "deferred";
  organizationId: string;
  name: string;
  messages: string[];
}
export class OrganizationUpdateConflict extends Error {}

/** Update headquarters staff without replacing the operation's task organization. */
export function adoptOrganizationStaff(
  source: Operation,
  binding: OperationOrganizationBinding,
  config: ResolvedConfig,
): Operation {
  const op = structuredClone(source);
  for (const assignment of op.staffPositionOverrides ?? []) {
    const position = binding.staff.positions.find(
      (p) => p.positionId === assignment.positionId,
    );
    if (!position) {
      const previous =
        source.operationOrganizationBinding?.staff.positions.find(
          (p) => p.positionId === assignment.positionId,
        );
      throw new OrganizationUpdateConflict(
        `Position “${previous?.title ?? "Assigned position"}” was removed from the organization but is still assigned to an order product. Change that assignment before updating.`,
      );
    }
    assignment.unitProfileVersionId = binding.unitProfileVersionId;
    assignment.sectionId = position.sectionId;
    assignment.functionalRole = position.functionalRole;
  }
  op.operationOrganizationBinding = structuredClone(binding);
  for (const product of op.planningProgress?.products ?? [])
    if (product.readyAt) {
      product.readyAt = null;
      product.reopenedReason = "Linked information changed";
    }
  return assertOperation(op, config);
}
