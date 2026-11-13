import { z } from "zod";
import { planningTargetSchema } from "./planning-target";
const id = z.string().uuid();
export const planningCardFields = [
  "name",
  "purpose",
  "description",
  "unit",
  "objective",
  "phase",
  "time",
  "finish",
  "duration",
  "sequence",
  "parent",
  "staff",
  "status",
  "text",
  "shortDesignation",
  "abbreviation",
  "unitType",
  "echelon",
  "service",
  "component",
  "callsign",
  "headquarters",
  "notes",
] as const;
export const copiedCardFieldSchema = z
  .object({
    key: z.enum(planningCardFields),
    label: z.string().max(160),
    value: z.string().max(40000),
  })
  .strict();
export const cardOriginSchema = z
  .object({
    target: planningTargetSchema,
    operationId: id.optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("saved"),
          revision: z.number().int().positive(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("working"),
          baseRevision: z.number().int().positive(),
          draftGeneration: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
  })
  .strict();
const base = {
  id,
  title: z.string().trim().min(1).max(160),
  fields: z
    .array(z.enum(planningCardFields))
    .min(1)
    .max(planningCardFields.length),
};
export const planningCardSchema = z.discriminatedUnion("mode", [
  z
    .object({
      ...base,
      mode: z.literal("linked"),
      source: planningTargetSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      mode: z.literal("independent"),
      values: z.array(copiedCardFieldSchema).max(planningCardFields.length),
      scope: z
        .object({
          unitIds: z.array(id).max(10000),
          phaseIds: z.array(id).max(10000),
        })
        .strict(),
      origin: cardOriginSchema,
    })
    .strict(),
]);
export const planningCardsSchema = z
  .object({
    schemaVersion: z.literal(1),
    definitions: z.array(planningCardSchema).max(1000),
  })
  .strict()
  .superRefine((cards, ctx) => {
    if (
      new Set(cards.definitions.map((c) => c.id)).size !==
      cards.definitions.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate planning card IDs" });
    for (const [index, c] of cards.definitions.entries()) {
      if (new Set(c.fields).size !== c.fields.length)
        ctx.addIssue({
          code: "custom",
          path: ["definitions", index, "fields"],
          message: "Duplicate selected card fields",
        });
      if (
        c.mode === "independent" &&
        (c.values.reduce((n, v) => n + v.value.length, 0) > 40000 ||
          new Set(c.values.map((v) => v.key)).size !== c.values.length)
      )
        ctx.addIssue({
          code: "custom",
          path: ["definitions", index],
          message: "Copied card values exceed the text limit or repeat fields",
        });
    }
  });
export const planningCardPlacementSchema = z
  .object({ id, cardId: id, layout: z.enum(["compact", "detailed"]) })
  .strict();
export type PlanningCard = z.infer<typeof planningCardSchema>;
export type CardField = z.infer<typeof copiedCardFieldSchema>;
export type CardOrigin = z.infer<typeof cardOriginSchema>;
export type CardPlacement = z.infer<typeof planningCardPlacementSchema>;
