import type { SymbolGeometry } from "../../application/symbology-ports";
import {
  assertTree,
  assertLayout,
  orbatLayoutSchema,
  type OrbatLayout,
} from "../../domain/orbat";
import type {
  LayoutNode,
  OrbatLayoutResult,
} from "../../application/render-contracts";
export type {
  LayoutNode,
  PositionedNode,
  OrbatLayoutResult,
} from "../../application/render-contracts";
type Work = LayoutNode & {
  depth: number;
  level: number;
  sublevels: number;
  children: Work[];
  display: Work[];
  heads: Work[];
  x: number;
  y: number;
  placed: boolean;
  side: "LEFT" | "RIGHT";
  synthetic: "GROUP" | "FOLD" | null;
  route: "HORIZONTAL" | "VERTICAL" | "HQ" | "ROOT";
  renderParent: Work | null;
};
const rounded = (n: number) => Math.round(n * 10000) / 10000;
const box = (n: Work) => {
  const g = n.side === "LEFT" ? (n.leftGeometry ?? n.geometry) : n.geometry;
  return {
    left: n.x - g.octagon.x,
    right: n.x - g.octagon.x + g.size.width,
    top: n.y - g.octagon.y,
    bottom: n.y - g.octagon.y + g.size.height,
  };
};
const syntheticGeometry: SymbolGeometry = {
  size: { width: 7.5, height: 0 },
  anchor: { x: 0, y: 0 },
  octagon: { x: 7.5, y: 0 },
};
const foldGeometry: SymbolGeometry = {
  size: { width: 44, height: 34 },
  anchor: { x: 22, y: 17 },
  octagon: { x: 22, y: 17 },
};
/** Presentation only. No source mutation, renderer invocation, random IDs or viewport state. */
export function layoutOrbatV1(
  input: readonly LayoutNode[],
  settings: OrbatLayout,
  measuredFold: SymbolGeometry = foldGeometry,
): OrbatLayoutResult {
  const layout = orbatLayoutSchema.parse(settings);
  assertTree(
    input.map((n) => ({ id: n.id, parentId: n.parentId })),
    null,
    false,
  );
  assertLayout(layout, new Set(input.map((n) => n.id)));
  for (const g of [
    measuredFold,
    ...input.flatMap((n) => [n.geometry, n.leftGeometry]),
  ].filter(Boolean) as SymbolGeometry[])
    if (
      [
        g.size.width,
        g.size.height,
        g.octagon.x,
        g.octagon.y,
        g.anchor.x,
        g.anchor.y,
      ].some((x) => !Number.isFinite(x)) ||
      g.size.width < 0 ||
      g.size.height < 0
    )
      throw Error("Invalid measured symbol geometry");
  const hints = new Map(layout.hints.map((h) => [h.nodeId, h])),
    order = new Map(layout.siblingOrder.map((id, i) => [id, i]));
  const nodes = new Map<string, Work>(
    input.map((n) => [
      n.id,
      {
        ...n,
        geometry: structuredClone(n.geometry),
        depth: 0,
        level: 0,
        sublevels: 0,
        children: [],
        display: [],
        heads: [],
        x: 0,
        y: 0,
        placed: false,
        side: "RIGHT",
        synthetic: null,
        route: "ROOT",
        renderParent: null,
      },
    ]),
  );
  for (const n of nodes.values())
    if (n.parentId) nodes.get(n.parentId)!.children.push(n);
  const stableOrder = (a: Work, b: Work) =>
    (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  const roots = [...nodes.values()]
      .filter((n) => n.parentId === null)
      .sort(stableOrder),
    all: Work[] = [];
  let slotWidth = 50,
    rowHeight = 50;
  const visit = (n: Work, depth: number) => {
    n.depth = n.level = depth;
    n.hq = hints.get(n.id)?.hqStaff ?? n.hq;
    n.children.sort(stableOrder);
    const g = n.geometry;
    slotWidth = Math.max(
      slotWidth,
      g.size.width + (depth ? 15 * depth : 0) - g.octagon.x + 10,
    );
    if (depth) rowHeight = Math.max(rowHeight, g.size.height);
    all.push(n);
    if (hints.get(n.id)?.folded && n.children.length) {
      const child: Work = {
        ...n,
        id: `fold-${n.id}`,
        parentId: n.id,
        geometry: structuredClone(measuredFold),
        leftGeometry: undefined,
        depth: depth + 1,
        level: depth + 1,
        hq: false,
        planned: false,
        children: [],
        display: [],
        heads: [],
        synthetic: "FOLD",
        placed: false,
        renderParent: n,
      };
      n.children = [child];
    }
    for (const c of n.children) visit(c, depth + 1);
    n.sublevels = n.children.reduce((m, c) => Math.max(m, c.sublevels + 1), 0);
  };
  roots.forEach((r) => visit(r, 0));
  slotWidth = Math.max(80, slotWidth);
  rowHeight -= 5;
  const group = (n: Work) => {
    let ordinary = n.children.filter((c) => !c.hq);
    if (layout.mode === "SMART" && ordinary.length > (n.level === 0 ? 5 : 3)) {
      const branch = (c: Work) =>
        !!hints.get(c.id)?.folded ||
        c.children.length >
          (c.level < layout.commandLevels &&
          c.sublevels <= 1 &&
          layout.commandLevels >= 2
            ? layout.commandLevels
            : 0);
      const branches = ordinary.filter(branch),
        leaves = ordinary.filter((c) => !branch(c));
      let batch: Work[] = [],
        weight = 0,
        index = 0;
      const flush = () => {
        if (!batch.length) return;
        const g: Work = {
          ...n,
          id: `group-${n.id}-${index++}`,
          parentId: n.id,
          geometry: syntheticGeometry,
          leftGeometry: undefined,
          children: batch,
          display: batch,
          heads: [],
          level: 1,
          sublevels: 1,
          hq: false,
          planned: false,
          synthetic: "GROUP",
          placed: false,
          renderParent: n,
        };
        branches.push(g);
        all.push(g);
        batch = [];
        weight = 0;
      };
      for (const c of leaves) {
        c.level++;
        batch.push(c);
        weight += c.children.length + 1;
        if (weight >= 6) flush();
      }
      flush();
      ordinary = branches;
    }
    n.display = ordinary;
    n.children.forEach(group);
  };
  roots.forEach(group);
  const place = (
    n: Work,
    x: number,
    y: number,
    route: Work["route"],
    parent: Work | null,
  ) => {
    n.x = x;
    n.y = y;
    n.route = route;
    n.renderParent = parent;
    n.placed = true;
  };
  const headquarters = (n: Work) => {
    const heads = n.children.filter((c) => c.hq);
    n.heads = heads;
    let offset =
        (heads.length ? 0.8 : 0.2) * rowHeight + (n.level === 0 ? 10 : 0),
      step = 0,
      maxWidth = 0;
    heads.forEach((h, i) => {
      offset += step;
      h.side = i % 2 ? "LEFT" : "RIGHT";
      step = i % 2 ? step + rowHeight : 0;
      const x = n.x + (i % 2 ? -50 : 50);
      place(h, x, n.y + offset, "HQ", n);
      maxWidth = Math.max(maxWidth, x + (i % 2 ? -slotWidth : slotWidth));
    });
    return { y: n.y + offset, maxWidth };
  };
  const vertical = (
    n: Work,
    state = { maxWidth: n.x + slotWidth, y: n.y },
  ): { maxWidth: number; y: number } => {
    state.y = n.y - (n.synthetic === "GROUP" ? rowHeight : 0);
    const children =
      layout.mode === "SMART"
        ? [
            ...n.children.filter((c) => c.hq),
            ...n.children.filter((c) => !c.hq),
          ]
        : n.children;
    n.display = children;
    for (const child of children) {
      state.y += rowHeight;
      place(
        child,
        n.x + 15 + (n.synthetic === "GROUP" ? 22.5 : 0),
        state.y,
        "VERTICAL",
        n,
      );
      vertical(child, state);
    }
    return state;
  };
  const horizontal = (n: Work, startY: number): number => {
    let cursor = n.x,
      maxWidth = 0;
    const y = startY + 1.3 * rowHeight;
    n.display.forEach((c, i) => {
      cursor = Math.max(cursor, n.x + i * slotWidth);
      place(c, cursor, y, "HORIZONTAL", n);
      let width: number;
      if (c.level < layout.commandLevels && c.synthetic !== "GROUP") {
        const h = headquarters(c);
        width = Math.max(h.maxWidth, horizontal(c, h.y)) || cursor + slotWidth;
      } else width = vertical(c).maxWidth;
      cursor = width;
      maxWidth = Math.max(maxWidth, width);
    });
    if (n.display.length) {
      n.x = (n.display[0].x + n.display.at(-1)!.x) / 2;
      headquarters(n);
    }
    return maxWidth;
  };
  let forestOffset = 0;
  for (const root of roots) {
    const before = all.filter((n) => n.placed);
    place(root, forestOffset, 50, "ROOT", null);
    horizontal(root, headquarters(root).y);
    const tree = all.filter((n) => n.placed && !before.includes(n));
    forestOffset =
      Math.max(forestOffset, ...tree.map((n) => box(n).right)) + slotWidth;
  }
  for (const n of all) {
    const offset = hints.get(n.id)?.offset;
    if (n.placed && offset) {
      n.x += offset.x;
      n.y += offset.y;
    }
  }
  const positioned = all.filter((n) => n.placed),
    connectors: OrbatLayoutResult["connectors"] = [];
  for (const n of positioned) {
    const parent = n.renderParent;
    if (!parent) continue;
    const b = box(n),
      p = box(parent);
    let points: number[][];
    if (n.route === "HQ")
      points = [
        [parent.x, p.bottom - 3],
        [parent.x, n.y],
        [parent.x < n.x ? b.left + 3 : b.right - 3, n.y],
      ];
    else if (n.route === "VERTICAL")
      points = [
        [p.left + 7.5, parent.y],
        [p.left + 7.5, n.y],
        [b.left + 3, n.y],
      ];
    else {
      const mid = n.y - 0.75 * rowHeight;
      points = [
        [parent.x, p.bottom - 0.5],
        [parent.x, mid],
        [n.x, mid],
        [n.x, b.top + 0.5],
      ];
    }
    connectors.push({
      from: parent.id,
      to: n.id,
      path: points
        .map(
          ([x, y], i) =>
            `${i ? "L" : "M"}${Number(x.toFixed(1))},${Number(y.toFixed(1))}`,
        )
        .join(" "),
      dashed: n.planned,
    });
  }
  const boxes = positioned.map(box),
    minX = Math.min(0, ...boxes.map((b) => b.left)) - 50,
    minY = Math.min(0, ...boxes.map((b) => b.top)),
    maxX = Math.max(80, ...boxes.map((b) => b.right)),
    maxY = Math.max(50, ...boxes.map((b) => b.bottom)) + rowHeight;
  return {
    algorithm: settings.algorithm,
    nodes: positioned.map((n) => ({
      id: n.id,
      x: rounded(n.x),
      y: rounded(n.y),
      box: box(n),
      labelSide: n.side,
      synthetic: n.synthetic,
    })),
    connectors,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    slot: { width: slotWidth, height: rowHeight },
  };
}
