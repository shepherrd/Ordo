import { z } from "zod";
import {
  savedOrbatVersionSchema,
  orbatNodeSchema,
  assertLayout,
  type SavedOrbatVersion,
} from "./orbat";
import {
  validLibraryLifecycle,
  symbolSnapshotSchema,
  type SymbolSnapshot,
} from "./symbology";
import { newUnitProfile } from "./unit-profiles";

// Empty editable catalog items reserve a root ID but contain no unit. Historical
// consumption snapshots still require the unchanged, complete single-root tree.
export const emptyCatalogOrbatSchema = z
  .object({
    ...savedOrbatVersionSchema.shape,
    status: z.literal("DRAFT"),
    publishedAt: z.null(),
    retiredAt: z.null(),
    nodes: z.array(orbatNodeSchema).length(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!validLibraryLifecycle(v))
      ctx.addIssue({
        code: "custom",
        message: "Invalid library lifecycle dates",
      });
    try {
      assertLayout(v.layout, new Set());
    } catch (e) {
      ctx.addIssue({ code: "custom", message: (e as Error).message });
    }
  });
export const editableOrbatSchema = z.union([
  savedOrbatVersionSchema,
  emptyCatalogOrbatSchema,
]);

export function addCatalogOrbatRoot(
  value: SavedOrbatVersion,
  snapshot: SymbolSnapshot,
  name: string,
  uid: () => string,
  now: string,
): SavedOrbatVersion {
  emptyCatalogOrbatSchema.parse(value);
  const symbol = symbolSnapshotSchema.parse(snapshot),
    next = structuredClone(value);
  const unitName =
    symbol.definition.amplifiers.uniqueDesignation?.trim() ||
    name.trim() ||
    "Unit";
  next.nodes.push({
    nodeId: next.rootNodeId,
    parentNodeId: null,
    unit: {
      kind: "INLINE_UNIT",
      identity: newUnitProfile(unitName.slice(0, 160), uid, now).identity,
      symbol,
    },
    nameOverride: null,
    annotation: "",
    symbolOverride: null,
  });
  return savedOrbatVersionSchema.parse(next);
}
