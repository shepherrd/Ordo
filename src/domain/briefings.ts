import { z } from "zod";
import { assetSchema } from "./modules";

const id = z.string().uuid();
export const briefingLayouts = ["title", "text", "cards", "graphic"] as const;
export const briefingSlideSchema = z
  .object({
    id,
    title: z.string().max(160),
    layout: z.enum(briefingLayouts),
    body: z.string().max(6000),
    notes: z.string().max(6000),
    cardIds: z.array(id).max(4),
    graphic: z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("export"), exportId: id }).strict(),
        z.object({ kind: z.literal("image"), asset: assetSchema }).strict(),
      ])
      .nullable(),
  })
  .strict()
  .refine(
    (s) => new Set(s.cardIds).size === s.cardIds.length,
    "Duplicate slide cards",
  );
export const briefingSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(160),
    footer: z.string().max(200),
    slides: z.array(briefingSlideSchema).max(40),
  })
  .strict()
  .refine(
    (b) => new Set(b.slides.map((s) => s.id)).size === b.slides.length,
    "Duplicate slide IDs",
  );
export const briefingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    decks: z.array(briefingSchema).max(12),
  })
  .strict()
  .refine(
    (b) => new Set(b.decks.map((d) => d.id)).size === b.decks.length,
    "Duplicate briefing IDs",
  );
export type Briefing = z.infer<typeof briefingSchema>;
export type BriefingSlide = z.infer<typeof briefingSlideSchema>;
export function newBriefingSlide(
  id: string,
  layout: BriefingSlide["layout"],
): BriefingSlide {
  return {
    id,
    title: "",
    layout,
    body: "",
    notes: "",
    cardIds: [],
    graphic: null,
  };
}
