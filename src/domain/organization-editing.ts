import { assertTree, type OrbatLayout } from "./orbat";

export type OrganizationNode = { id: string; parentId: string | null };
export type TreeDrop = "CHILD" | "BEFORE" | "AFTER";

export function subtreeIds(nodes: OrganizationNode[], id: string): Set<string> {
  if (!nodes.some((n) => n.id === id)) throw Error("Unit not found");
  const children = new Map<string, string[]>();
  for (const n of nodes)
    if (n.parentId) {
      const list = children.get(n.parentId) ?? [];
      list.push(n.id);
      children.set(n.parentId, list);
    }
  const result = new Set<string>(),
    pending = [id];
  while (pending.length) {
    const next = pending.pop()!;
    if (result.has(next)) throw Error("Hierarchy cycle");
    result.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return result;
}

/** One explicit structural move, with independent sibling presentation order. */
export function planTreeDrop(
  nodes: OrganizationNode[],
  layout: OrbatLayout,
  id: string,
  targetId: string,
  position: TreeDrop,
  rootId?: string,
) {
  const target = nodes.find((n) => n.id === targetId);
  if (!target) throw Error("Destination unit not found");
  if (rootId === id) throw Error("The declared root cannot be moved");
  if (subtreeIds(nodes, id).has(targetId))
    throw Error("A unit cannot move into itself or its descendants");
  const parentId = position === "CHILD" ? targetId : target.parentId;
  assertTree(
    nodes.map((n) => (n.id === id ? { ...n, parentId } : n)),
    rootId ?? null,
    !!rootId,
  );
  const rank = new Map(layout.siblingOrder.map((key, i) => [key, i]));
  const index = new Map(nodes.map((n, i) => [n.id, i + nodes.length]));
  const ordered = [...nodes]
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? index.get(a.id)!) -
        (rank.get(b.id) ?? index.get(b.id)!),
    )
    .map((n) => n.id)
    .filter((key) => key !== id);
  if (position === "CHILD") ordered.push(id);
  else
    ordered.splice(
      ordered.indexOf(targetId) + (position === "AFTER" ? 1 : 0),
      0,
      id,
    );
  return { parentId, layout: { ...layout, siblingOrder: ordered } };
}

export function reorderSibling(
  nodes: OrganizationNode[],
  layout: OrbatLayout,
  id: string,
  direction: -1 | 1,
): OrbatLayout {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw Error("Unit not found");
  const rank = new Map(layout.siblingOrder.map((key, i) => [key, i]));
  const index = new Map(nodes.map((n, i) => [n.id, i + nodes.length]));
  const siblings = nodes
    .filter((n) => n.parentId === node.parentId)
    .sort(
      (a, b) =>
        (rank.get(a.id) ?? index.get(a.id)!) -
        (rank.get(b.id) ?? index.get(b.id)!),
    );
  const target = siblings[siblings.findIndex((n) => n.id === id) + direction];
  return target
    ? planTreeDrop(
        nodes,
        layout,
        id,
        target.id,
        direction < 0 ? "BEFORE" : "AFTER",
      ).layout
    : layout;
}
