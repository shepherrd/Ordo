import { z } from "zod";
import { comparisonSchema } from "./diff/model";
export const documentComparisonSchema = comparisonSchema.safeExtend({
  whiteboards: z
    .object({
      schemaVersion: z.literal(1),
      changes: z
        .array(
          z
            .object({
              entityId: z.string().uuid(),
              label: z.string().max(1000),
              field: z.string().max(160),
              before: z.string().max(40000),
              after: z.string().max(40000),
            })
            .strict(),
        )
        .max(30000),
    })
    .strict()
    .optional(),
  briefings: z
    .object({
      schemaVersion: z.literal(1),
      changes: z
        .array(
          z
            .object({
              entityId: z.string().uuid(),
              label: z.string().max(1000),
              field: z.string().max(160),
              before: z.string().max(40000),
              after: z.string().max(40000),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict()
    .optional(),
  planningSchedule: z
    .object({
      schemaVersion: z.literal(1),
      changes: z
        .array(
          z
            .object({
              entityId: z.string().uuid(),
              label: z.string().max(1000),
              field: z.string().max(160),
              before: z.string().max(40000),
              after: z.string().max(40000),
            })
            .strict(),
        )
        .max(20000),
    })
    .strict()
    .optional(),
  planningCards: z
    .object({
      schemaVersion: z.literal(1),
      changes: z
        .array(
          z
            .object({
              cardId: z.string().uuid(),
              label: z.string().max(160),
              kind: z.enum([
                "Added",
                "Removed",
                "Made independent",
                "Source changed",
                "Edited",
              ]),
              before: z.string(),
              after: z.string(),
            })
            .strict(),
        )
        .max(2000),
      exports: z
        .array(
          z
            .object({
              exportId: z.string().uuid(),
              label: z.string(),
              baselineChangedPaths: z.array(z.string()),
              targetChangedPaths: z.array(z.string()),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict()
    .optional(),
  documentPresentation: z
    .object({
      schemaVersion: z.literal(1),
      exports: z
        .array(
          z
            .object({
              exportId: z.string().uuid(),
              label: z.string().max(1000),
              baselineChangedPaths: z.array(z.string().max(2000)),
              targetChangedPaths: z.array(z.string().max(2000)),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict()
    .optional(),
});
export type DocumentComparison = z.infer<typeof documentComparisonSchema>;
