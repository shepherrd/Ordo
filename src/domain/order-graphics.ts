import { archivedId } from "./archived-format";
import { z } from "zod";
import { diagramRequestSchema } from "./diagram";
import { renderManifestSchema, symbolDigest, symbolId } from "./symbology";

/** Optional operation presentation state. Absence retains the historical table. */
export const taskOrganizationPresentationSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["TABLE", "DIAGRAM", "BOTH"]),
    ancestorPolicy: z.enum(["BOUNDARY", "INCLUDE_CONTEXT"]),
    foldPolicy: z.enum(["AS_SHOWN", "EXPANDED"]),
    symbolSize: z.number().min(10).max(500),
  })
  .strict();
export type TaskOrganizationPresentation = z.infer<
  typeof taskOrganizationPresentationSchema
>;
export const orderGraphicRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    blockId: symbolId,
    productId: symbolId,
    kind: z.literal("TASK_ORGANIZATION"),
    input: diagramRequestSchema,
  })
  .strict();
export type OrderGraphicRequest = z.infer<typeof orderGraphicRequestSchema>;
export const retainedOrderGraphicSchema = z
  .object({
    schemaVersion: z.literal(1),
    request: orderGraphicRequestSchema,
    inputHash: symbolDigest,
    svg: z.string().max(16 * 1024 * 1024),
    svgHash: symbolDigest,
    layoutVersion: z.union([z.literal("ordo-layout-v1"), archivedId("layout")]),
    renderManifests: z.array(renderManifestSchema).max(4000),
    diagnostics: z.array(z.string().max(2000)).max(2000),
  })
  .strict();
export type RetainedOrderGraphic = z.infer<typeof retainedOrderGraphicSchema>;
