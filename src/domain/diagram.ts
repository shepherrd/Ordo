import { z } from "zod";
import {
  militarySymbolDefinitionSchema,
  resolveSymbol,
  symbolId,
} from "./symbology";
import {
  orbatLayoutSchema,
  savedOrbatVersionSchema,
  assertTree,
  type OrbatLayout,
  type SavedOrbatVersion,
} from "./orbat";
import type { Operation } from "./model";
import type { GraphicExportProfile } from "./graphic-exports";
export const diagramNodeSchema = z
  .object({
    id: symbolId,
    parentId: symbolId.nullable(),
    name: z.string().max(160),
    annotation: z.string().max(500),
    symbol: militarySymbolDefinitionSchema.nullable(),
    boundary: z.boolean(),
  })
  .strict();
export const diagramRequestSchema = z
  .object({
    nodes: z.array(diagramNodeSchema).max(2000),
    layout: orbatLayoutSchema,
    symbolSize: z.number().min(10).max(500).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    try {
      assertTree(
        v.nodes.map((n) => ({ id: n.id, parentId: n.parentId })),
        null,
        false,
      );
    } catch (e) {
      c.addIssue({ code: "custom", message: (e as Error).message });
    }
  });
export type DiagramRequest = z.infer<typeof diagramRequestSchema>;
export type DiagramNode = z.infer<typeof diagramNodeSchema>;
export function diagramFromSaved(input: SavedOrbatVersion): DiagramRequest {
  const orbat = savedOrbatVersionSchema.parse(input);
  return {
    nodes: orbat.nodes.map((n) => {
      const name =
        n.nameOverride ??
        (n.unit.identity.shortDesignation || n.unit.identity.fullDesignation);
      const symbol = structuredClone(
        n.symbolOverride?.definition ??
          (n.unit.kind === "UNIT_PROFILE"
            ? n.unit.defaultSymbol?.definition
            : n.unit.symbol?.definition) ??
          null,
      );
      if (symbol) {
        symbol.amplifiers.uniqueDesignation = name;
        if (n.annotation)
          symbol.amplifiers.additionalInformation = n.annotation;
      }
      return {
        id: n.nodeId,
        parentId: n.parentNodeId,
        name,
        annotation: n.annotation,
        symbol,
        boundary: false,
      };
    }),
    layout: structuredClone(orbat.layout),
  };
}
export function diagramFromOperation(
  op: Operation,
  fallbackLayout: OrbatLayout,
): DiagramRequest {
  return {
    nodes: op.units.map((u) => ({
      id: u.id,
      parentId: u.parentUnitId,
      name: u.name,
      annotation: "",
      symbol: u.symbol
        ? resolveSymbol(
            u.symbol,
            u.name,
            op.units.find((p) => p.id === u.parentUnitId)?.name ?? null,
          )
        : null,
      boundary: false,
    })),
    layout: structuredClone(op.orbatLayout ?? fallbackLayout),
  };
}
/** Selection precedes rendering. Boundary ancestors carry no excluded names, symbols or annotations. */
export function selectDiagram(
  input: DiagramRequest,
  profile: Pick<
    GraphicExportProfile,
    "selectedUnitIds" | "ancestorPolicy" | "foldPolicy"
  >,
): DiagramRequest {
  const source = diagramRequestSchema.parse(input),
    selected =
      profile.selectedUnitIds === null
        ? new Set(source.nodes.map((n) => n.id))
        : new Set(profile.selectedUnitIds);
  if ([...selected].some((id) => !source.nodes.some((n) => n.id === id)))
    throw Error("Export selection references an absent unit");
  const included = new Set(selected),
    boundary = new Set<string>(),
    byId = new Map(source.nodes.map((n) => [n.id, n]));
  for (const id of selected) {
    let parent = byId.get(id)!.parentId;
    while (parent && !included.has(parent)) {
      included.add(parent);
      if (profile.ancestorPolicy === "BOUNDARY") {
        boundary.add(parent);
        break;
      }
      parent = byId.get(parent)!.parentId;
    }
  }
  const nodes = source.nodes
    .filter((n) => included.has(n.id))
    .map((n) =>
      boundary.has(n.id)
        ? {
            id: n.id,
            parentId: null,
            name: "",
            annotation: "",
            symbol: null,
            boundary: true,
          }
        : {
            ...n,
            parentId: included.has(n.parentId ?? "") ? n.parentId : null,
          },
    );
  const layout = {
    ...source.layout,
    hints: source.layout.hints
      .filter((h) => included.has(h.nodeId) && !boundary.has(h.nodeId))
      .map((h) => ({
        ...h,
        folded: profile.foldPolicy === "EXPANDED" ? false : h.folded,
      })),
    siblingOrder: source.layout.siblingOrder.filter((id) => included.has(id)),
  };
  return diagramRequestSchema.parse({
    nodes,
    layout,
    ...(source.symbolSize ? { symbolSize: source.symbolSize } : {}),
  });
}

/** Resolve operation labels within the selected audience, including boundary privacy. */
export function selectOperationDiagram(
  op: Operation,
  fallbackLayout: OrbatLayout,
  profile: Pick<
    GraphicExportProfile,
    "selectedUnitIds" | "ancestorPolicy" | "foldPolicy"
  >,
): DiagramRequest {
  const result = selectDiagram(
    diagramFromOperation(op, fallbackLayout),
    profile,
  );
  const visible = new Set(
    result.nodes.filter((n) => !n.boundary).map((n) => n.id),
  );
  const units = new Map(op.units.map((u) => [u.id, u]));
  for (const node of result.nodes) {
    const unit = units.get(node.id);
    if (!node.symbol || !unit?.symbol) continue;
    for (const [field, binding] of Object.entries(unit.symbol.labels)) {
      if (
        binding.kind === "PARENT_UNIT_NAME" &&
        !visible.has(unit.parentUnitId ?? "")
      )
        node.symbol.amplifiers[field as keyof typeof unit.symbol.labels] = "";
    }
  }
  return result;
}
