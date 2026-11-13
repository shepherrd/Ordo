import {
  assertTree,
  assertLayout,
  newOrbatLayout,
  orbatLayoutSchema,
  type OrbatLayout,
} from "./orbat";
import { assertOperation } from "./invariants";
import type { Operation, ResolvedConfig } from "./model";
import {
  planTreeDrop,
  subtreeIds,
  type TreeDrop,
} from "./organization-editing";

export function moveOperationSubtree(
  op: Operation,
  id: string,
  target: string,
  position: TreeDrop,
): Operation {
  const move = planTreeDrop(
    op.units.map((u) => ({ id: u.id, parentId: u.parentUnitId })),
    operationLayout(op),
    id,
    target,
    position,
  );
  const next = reparentOperationUnit(op, id, move.parentId);
  return changeOperationLayout(next, move.layout);
}

export function deleteOperationSubtree(
  op: Operation,
  id: string,
  config: ResolvedConfig,
): Operation {
  const removed = subtreeIds(
    op.units.map((u) => ({ id: u.id, parentId: u.parentUnitId })),
    id,
  );
  const next = structuredClone(op);
  next.units = next.units.filter((u) => !removed.has(u.id));
  if (next.orbatLayout) {
    next.orbatLayout.hints = next.orbatLayout.hints.filter(
      (h) => !removed.has(h.nodeId),
    );
    next.orbatLayout.siblingOrder = next.orbatLayout.siblingOrder.filter(
      (n) => !removed.has(n),
    );
  }
  try {
    return assertOperation(next, config);
  } catch (e) {
    throw Error(
      "Subtree deletion is blocked by a reference or invalid draft: " +
        (e as Error).message,
    );
  }
}
export function reparentOperationUnit(
  op: Operation,
  id: string,
  parentId: string | null,
): Operation {
  const next = structuredClone(op),
    unit = next.units.find((u) => u.id === id);
  if (!unit) throw Error("Unit not found");
  unit.parentUnitId = parentId;
  assertTree(
    next.units.map((u) => ({ id: u.id, parentId: u.parentUnitId })),
    null,
    false,
  );
  return next;
}
export function changeOperationLayout(
  op: Operation,
  input: OrbatLayout,
): Operation {
  const layout = orbatLayoutSchema.parse(input);
  assertLayout(layout, new Set(op.units.map((u) => u.id)));
  return { ...op, orbatLayout: layout };
}
export function deleteOperationUnit(
  op: Operation,
  id: string,
  config: ResolvedConfig,
): Operation {
  if (op.units.some((u) => u.parentUnitId === id))
    throw Error("Reparent or remove this unit's children before deleting it");
  const next = structuredClone(op);
  next.units = next.units.filter((u) => u.id !== id);
  if (next.orbatLayout) {
    next.orbatLayout.hints = next.orbatLayout.hints.filter(
      (h) => h.nodeId !== id,
    );
    next.orbatLayout.siblingOrder = next.orbatLayout.siblingOrder.filter(
      (n) => n !== id,
    );
  }
  try {
    return assertOperation(next, config);
  } catch (error) {
    throw Error(
      "Unit deletion is blocked by a reference or invalid draft: " +
        (error as Error).message,
    );
  }
}
export const operationLayout = (op: Operation): OrbatLayout =>
  op.orbatLayout ?? newOrbatLayout(() => op.id);
