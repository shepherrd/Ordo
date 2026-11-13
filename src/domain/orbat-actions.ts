import {
  savedOrbatVersionSchema,
  type SavedOrbatVersion,
  type OrbatNode,
  type OrbatLayout,
} from "./orbat";
import {
  planTreeDrop,
  subtreeIds,
  type TreeDrop,
} from "./organization-editing";

export function moveOrbatSubtree(
  value: SavedOrbatVersion,
  id: string,
  target: string,
  position: TreeDrop,
) {
  const move = planTreeDrop(
    value.nodes.map((n) => ({ id: n.nodeId, parentId: n.parentNodeId })),
    value.layout,
    id,
    target,
    position,
    value.rootNodeId,
  );
  return editOrbat(value, (next) => {
    next.nodes.find((n) => n.nodeId === id)!.parentNodeId = move.parentId;
    next.layout = move.layout;
  });
}

export function deleteOrbatSubtree(value: SavedOrbatVersion, id: string) {
  if (id === value.rootNodeId)
    throw Error("Use Reset composition to replace the root");
  const removed = subtreeIds(
    value.nodes.map((n) => ({ id: n.nodeId, parentId: n.parentNodeId })),
    id,
  );
  return editOrbat(value, (next) => {
    next.nodes = next.nodes.filter((n) => !removed.has(n.nodeId));
    next.layout.hints = next.layout.hints.filter((h) => !removed.has(h.nodeId));
    next.layout.siblingOrder = next.layout.siblingOrder.filter(
      (n) => !removed.has(n),
    );
  });
}

/** Reset the working composition explicitly, retaining its root identity and symbol. */
export function resetOrbatComposition(value: SavedOrbatVersion) {
  return editOrbat(value, (next) => {
    next.nodes = next.nodes.filter((n) => n.nodeId === next.rootNodeId);
    next.layout.hints = [];
    next.layout.siblingOrder = [];
  });
}

/** Composition edits preserve node identities and are validated before entering draft history. */
export function editOrbat(
  value: SavedOrbatVersion,
  edit: (draft: SavedOrbatVersion) => void,
): SavedOrbatVersion {
  if (value.status !== "DRAFT")
    throw Error("Published ORBAT versions are immutable");
  const next = structuredClone(value);
  edit(next);
  return savedOrbatVersionSchema.parse(next);
}
export function reparentOrbatNode(
  value: SavedOrbatVersion,
  nodeId: string,
  parentNodeId: string | null,
) {
  return editOrbat(value, (next) => {
    const node = next.nodes.find((n) => n.nodeId === nodeId);
    if (!node) throw Error("ORBAT node not found");
    if (nodeId === next.rootNodeId)
      throw Error("The declared root cannot be reparented");
    node.parentNodeId = parentNodeId;
  });
}
export function addOrbatNode(value: SavedOrbatVersion, node: OrbatNode) {
  return editOrbat(value, (next) => {
    next.nodes.push(structuredClone(node));
  });
}
export function deleteOrbatNode(value: SavedOrbatVersion, nodeId: string) {
  return editOrbat(value, (next) => {
    if (nodeId === next.rootNodeId) throw Error("The root cannot be deleted");
    if (!next.nodes.some((n) => n.nodeId === nodeId))
      throw Error("ORBAT node not found");
    if (next.nodes.some((n) => n.parentNodeId === nodeId))
      throw Error(
        "Reparent or remove the child units before deleting this node",
      );
    next.nodes = next.nodes.filter((n) => n.nodeId !== nodeId);
    next.layout.hints = next.layout.hints.filter((h) => h.nodeId !== nodeId);
    next.layout.siblingOrder = next.layout.siblingOrder.filter(
      (id) => id !== nodeId,
    );
  });
}
export function changeOrbatLayout(
  value: SavedOrbatVersion,
  layout: OrbatLayout,
) {
  return editOrbat(value, (next) => {
    next.layout = structuredClone(layout);
  });
}
