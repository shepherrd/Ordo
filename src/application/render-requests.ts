import { z } from "zod";
import { diagramRequestSchema } from "./orbat-projection";
import { militarySymbolDefinitionSchema } from "../domain/symbology";
export const symbolRenderRequestSchema = z
  .object({
    definition: militarySymbolDefinitionSchema,
    size: z.number().finite().min(1).max(1000),
    context: z.enum(["SYMBOL", "ORBAT_NODE", "FOLDED_GROUP"]),
    labelSide: z.enum(["RIGHT", "LEFT"]),
  })
  .strict()
  .refine(
    (r) => r.size >= (r.context === "FOLDED_GROUP" ? 20 / 3 : 10),
    "Symbol size is below the context limit",
  );
export const graphicRenderRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("SYMBOL"), input: symbolRenderRequestSchema })
    .strict(),
  z.object({ kind: z.literal("ORBAT"), input: diagramRequestSchema }).strict(),
]);
