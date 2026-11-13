import { createHash } from "node:crypto";
import {
  diagramRequestSchema,
  type DiagramRequest,
} from "../application/orbat-projection";
import type {
  SymbolGeometry,
  SymbolRenderResult,
} from "../application/symbology-ports";
import {
  layoutOrbatV1,
  type LayoutNode,
  type OrbatLayoutResult,
} from "./orbat-layout/v1";
import { renderSymbol } from "./symbol-renderer";
import { foldedGroupDefinitionV1 } from "./folded-group-v1";
import {
  assertGeneratedSvg,
  namespaceSvg,
  numberText as n,
  xmlText,
} from "./svg-safety";
import { textWidth } from "./text-metrics";
import type { RenderManifest } from "../domain/symbology";
import type { DiagramRenderResult } from "../application/render-contracts";
export function renderOrbat(input: DiagramRequest): DiagramRenderResult {
  const request = diagramRequestSchema.parse(input),
    map = new Map(request.nodes.map((n) => [n.id, n]));
  const folded = new Set(
    request.layout.hints.filter((h) => h.folded).map((h) => h.nodeId),
  );
  const hidden = (id: string) => {
    let parent = map.get(id)?.parentId;
    while (parent) {
      if (folded.has(parent)) return true;
      parent = map.get(parent)?.parentId;
    }
    return false;
  };
  const symbols = new Map<
      string,
      { right: SymbolRenderResult; left: SymbolRenderResult }
    >(),
    diagnostics = new Set<string>(),
    manifests: RenderManifest[] = [];
  const nodes: LayoutNode[] = request.nodes.map((node) => {
    if (hidden(node.id))
      return {
        id: node.id,
        parentId: node.parentId,
        geometry: {
          size: { width: 0, height: 0 },
          anchor: { x: 0, y: 0 },
          octagon: { x: 0, y: 0 },
        },
        hq: false,
        planned: false,
      };
    let geometry: SymbolGeometry,
      leftGeometry: SymbolGeometry | undefined,
      hq = false,
      planned = false;
    if (node.symbol) {
      const r = {
          definition: node.symbol,
          size:
            (request.symbolSize ?? 30) * (node.parentId === null ? 4 / 3 : 1),
          context: "ORBAT_NODE" as const,
        },
        right = renderSymbol({ ...r, labelSide: "RIGHT" }),
        left = renderSymbol({ ...r, labelSide: "LEFT" });
      symbols.set(node.id, { right, left });
      geometry = right.geometry;
      leftGeometry = left.geometry;
      for (const d of right.diagnostics) diagnostics.add(d);
      const code = node.symbol.code;
      hq =
        code.dialect === "NUMERIC" &&
        code.sidc.slice(4, 6) === "10" &&
        code.sidc.slice(16, 18) === "98";
      planned =
        code.dialect === "NUMERIC"
          ? code.sidc[6] === "1"
          : code.sidc[3] === "A";
    } else {
      const width = node.boundary
        ? 12
        : Math.max(90, textWidth(node.name, 12, 16, true));
      geometry = {
        size: { width, height: node.boundary ? 12 : 34 },
        octagon: { x: node.boundary ? 6 : 15, y: node.boundary ? 6 : 17 },
        anchor: { x: 15, y: 17 },
      };
      if (!node.boundary)
        diagnostics.add(
          "Units without an assigned symbol are shown as text cards.",
        );
    }
    return {
      id: node.id,
      parentId: node.parentId,
      geometry,
      leftGeometry,
      hq,
      planned,
    };
  });
  const fold = request.layout.hints.some(
    (h) => h.folded && request.nodes.some((n) => n.parentId === h.nodeId),
  )
    ? renderSymbol({
        definition: foldedGroupDefinitionV1(),
        size: ((request.symbolSize ?? 30) * 2) / 3,
        context: "FOLDED_GROUP",
        labelSide: "RIGHT",
      })
    : null;
  const layout = layoutOrbatV1(nodes, request.layout, fold?.geometry),
    parts: string[] = [];
  for (const c of layout.connectors)
    parts.push(
      `<path d="${c.path}" fill="none" stroke="black" stroke-width="1.2"${c.dashed ? ' stroke-dasharray="4"' : ""}/>`,
    );
  for (const node of layout.nodes) {
    if (node.synthetic === "GROUP") continue;
    const source = map.get(node.id),
      pair = symbols.get(node.id),
      symbol = pair?.[node.labelSide === "LEFT" ? "left" : "right"];
    const x = n(node.box.left),
      y = n(node.box.top),
      w = n(node.box.right - node.box.left),
      h = n(node.box.bottom - node.box.top);
    let body: string;
    if (symbol) {
      manifests.push(symbol.manifest);
      body = namespaceSvg(symbol.svg, "node-" + node.id).replace(
        "<svg ",
        `<svg x="${x}" y="${y}" `,
      );
    } else if (node.synthetic === "FOLD" && fold) {
      manifests.push(fold.manifest);
      body = namespaceSvg(fold.svg, "fold-" + node.id).replace(
        "<svg ",
        `<svg x="${x}" y="${y}" `,
      );
    } else if (source?.boundary)
      body = `<circle cx="${n(node.x)}" cy="${n(node.y)}" r="5" fill="none" stroke="#75818c"/>`;
    else
      body = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#f3f5f7" stroke="#75818c"/><text x="${n(node.box.left + 8)}" y="${n(node.y + 4)}" font-family="Arial" font-size="12" font-weight="bold">${xmlText(source?.name ?? "")}</text>`;
    parts.push(
      `<g data-unit-id="${xmlText(node.synthetic === "FOLD" ? node.id.slice(5) : node.id)}">${body}</g>`,
    );
  }
  const b = layout.bounds,
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n(b.width)}" height="${n(b.height)}" viewBox="${n(b.x)} ${n(b.y)} ${n(b.width)} ${n(b.height)}">${parts.join("")}</svg>`;
  assertGeneratedSvg(svg);
  return {
    svg,
    svgHash: createHash("sha256").update(svg).digest("hex"),
    layout,
    renderManifests: manifests,
    diagnostics: [...diagnostics],
  };
}
