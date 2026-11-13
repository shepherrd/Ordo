import { archivedId, isArchivedId } from "./archived-format";
import { z } from "zod";
import {
  symbolId as id,
  symbolDigest as digest,
  symbolLabel as label,
  libraryVersionFields,
  validLibraryLifecycle,
  exactLibraryRefSchema,
  savedSymbolPinSchema,
  symbolSnapshotSchema,
} from "./symbology";
import { unitIdentitySchema } from "./unit-profiles";
export const m6Limits = {
  nodes: 2000,
  depth: 64,
  jsonBytes: 10 * 1024 * 1024,
  svgBytes: 16 * 1024 * 1024,
  rasterPixels: 32 * 1024 * 1024,
  rasterSide: 16384,
} as const;
const point = z
  .object({
    x: z.number().min(-100000).max(100000),
    y: z.number().min(-100000).max(100000),
  })
  .strict();
export const orbatLayoutSchema = z
  .object({
    schemaVersion: z.literal(1),
    layoutId: id,
    algorithm: z.union([z.literal("ordo-layout-v1"), archivedId("layout")]),
    mode: z.enum(["SMART", "SIMPLE"]),
    commandLevels: z.number().int().min(1).max(64),
    labelProfile: z.union([z.literal("ordo-labels-v1"), archivedId("labels")]),
    hints: z
      .array(
        z
          .object({
            nodeId: id,
            folded: z.boolean(),
            hqStaff: z.boolean(),
            offset: point.nullable(),
          })
          .strict(),
      )
      .max(m6Limits.nodes),
    siblingOrder: z.array(id).max(m6Limits.nodes),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.hints.map((n) => n.nodeId)).size !== v.hints.length ||
      new Set(v.siblingOrder).size !== v.siblingOrder.length
    )
      c.addIssue({ code: "custom", message: "Duplicate layout identity" });
  });
export type OrbatLayout = z.infer<typeof orbatLayoutSchema>;
export const orbatNodeSchema = z
  .object({
    nodeId: id,
    parentNodeId: id.nullable(),
    unit: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("UNIT_PROFILE"),
          source: exactLibraryRefSchema,
          identity: unitIdentitySchema,
          defaultSymbol: savedSymbolPinSchema.nullable(),
          sourceRelationshipPath: z.array(id).max(100),
        })
        .strict(),
      z
        .object({
          kind: z.literal("INLINE_UNIT"),
          identity: unitIdentitySchema,
          symbol: symbolSnapshotSchema.nullable(),
        })
        .strict(),
    ]),
    nameOverride: label.nullable(),
    annotation: z.string().max(500),
    symbolOverride: symbolSnapshotSchema.nullable(),
  })
  .strict();
export type OrbatNode = z.infer<typeof orbatNodeSchema>;
export function assertTree(
  nodes: { id: string; parentId: string | null }[],
  rootId: string | null,
  requireOneRoot = true,
) {
  if (nodes.length > m6Limits.nodes) throw Error("ORBAT exceeds 2,000 nodes");
  const map = new Map(nodes.map((n) => [n.id, n]));
  if (map.size !== nodes.length) throw Error("Duplicate ORBAT node identity");
  const roots = nodes.filter((n) => n.parentId === null);
  if (requireOneRoot && (roots.length !== 1 || roots[0]?.id !== rootId))
    throw Error("ORBAT requires exactly one declared root");
  for (const n of nodes) {
    const path = new Set<string>();
    let current: typeof n | undefined = n;
    while (current) {
      if (path.has(current.id)) throw Error("ORBAT hierarchy cycle");
      path.add(current.id);
      if (path.size > m6Limits.depth) throw Error("ORBAT exceeds depth 64");
      if (current.parentId === null) break;
      current = map.get(current.parentId);
      if (!current) throw Error("ORBAT parent is missing");
    }
  }
}
export function assertLayout(layout: OrbatLayout, ids: Set<string>) {
  for (const key of [
    ...layout.hints.map((n) => n.nodeId),
    ...layout.siblingOrder,
  ])
    if (!ids.has(key)) throw Error("Layout references an absent node");
}
export const savedOrbatVersionSchema = z
  .object({
    ...libraryVersionFields,
    rootNodeId: id,
    nodes: z.array(orbatNodeSchema).min(1).max(m6Limits.nodes),
    layout: orbatLayoutSchema,
  })
  .strict()
  .superRefine((v, c) => {
    if (!validLibraryLifecycle(v))
      c.addIssue({
        code: "custom",
        message: "Invalid library lifecycle dates",
      });
    try {
      assertTree(
        v.nodes.map((n) => ({ id: n.nodeId, parentId: n.parentNodeId })),
        v.rootNodeId,
      );
      assertLayout(v.layout, new Set(v.nodes.map((n) => n.nodeId)));
    } catch (e) {
      c.addIssue({ code: "custom", message: (e as Error).message });
    }
  });
export type SavedOrbatVersion = z.infer<typeof savedOrbatVersionSchema>;
export const operationOrbatSourceSchema = z
  .object({
    source: exactLibraryRefSchema,
    nodeId: id,
    importId: id,
    importerVersion: z.literal("orbat-import-v1"),
  })
  .strict();
export const orbatImportReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id,
    importId: id,
    requestHash: digest,
    source: exactLibraryRefSchema,
    revision: z.number().int().positive(),
    at: z.string().datetime(),
    nodeMap: z
      .array(z.object({ nodeId: id, unitId: id }).strict())
      .min(1)
      .max(m6Limits.nodes),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.nodeMap.map((n) => n.nodeId)).size === v.nodeMap.length &&
      new Set(v.nodeMap.map((n) => n.unitId)).size === v.nodeMap.length,
    "Duplicate import map identity",
  );
export type OrbatImportReceipt = z.infer<typeof orbatImportReceiptSchema>;
export function newOrbatLayout(uid: () => string): OrbatLayout {
  return {
    schemaVersion: 1,
    layoutId: uid(),
    algorithm: "ordo-layout-v1",
    mode: "SMART",
    commandLevels: 2,
    labelProfile: "ordo-labels-v1",
    hints: [],
    siblingOrder: [],
  };
}

// Older operations without a saved layout used a deterministic default. For a
// historical projection, recover only its verified identifiers from the record.
export function recordedLayoutDefaults<
  T extends { id: string; orbatLayout?: OrbatLayout },
>(op: T, algorithm: unknown, labels: unknown): T {
  if (
    op.orbatLayout ||
    typeof algorithm !== "string" ||
    typeof labels !== "string" ||
    !isArchivedId("layout", algorithm) ||
    !isArchivedId("labels", labels)
  )
    return op;
  return {
    ...op,
    orbatLayout: {
      ...newOrbatLayout(() => op.id),
      algorithm,
      labelProfile: labels,
    },
  };
}
