import { z } from "zod";

const id = z.string().uuid();
const key = z.string().min(1).max(160);
export const planningEntityKinds = [
  "unit",
  "task",
  "objective",
  "phase",
  "event",
] as const;
export const narrativeTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("paragraph"), paragraphId: key }).strict(),
  z
    .object({
      kind: z.literal("base-field"),
      fieldId: id,
      entryId: id.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("attachment-text"),
      attachmentId: id,
      sectionId: id.optional(),
      fieldId: id.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("module-text"), moduleId: id }).strict(),
]);
export const planningTargetSchema = z.union([
  z
    .object({
      kind: z.literal("entity"),
      entityKind: z.enum(planningEntityKinds),
      entityId: id,
    })
    .strict(),
  narrativeTargetSchema,
]);
export type PlanningTarget = z.infer<typeof planningTargetSchema>;
export const operationSearchTargetSchema = z.union([
  z
    .object({
      kind: z.literal("whiteboard"),
      boardId: id,
      itemId: id.optional(),
    })
    .strict(),
  planningTargetSchema,
  z.object({ kind: z.literal("operation") }).strict(),
  z.object({ kind: z.literal("signal") }).strict(),
  z.object({ kind: z.literal("net"), entityId: id }).strict(),
  z.object({ kind: z.literal("pace"), entityId: id }).strict(),
  z
    .object({
      kind: z.literal("product"),
      attachmentId: id,
      itemId: id.optional(),
      columnId: id.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("module"),
      moduleId: id,
      itemId: id.optional(),
      fieldId: id.optional(),
    })
    .strict(),
  z.object({ kind: z.literal("card"), cardId: id }).strict(),
  z
    .object({ kind: z.literal("briefing"), deckId: id, slideId: id.optional() })
    .strict(),
]);
export type OperationSearchTarget = z.infer<typeof operationSearchTargetSchema>;
export const searchTargetSchema = z.discriminatedUnion("area", [
  z
    .object({
      area: z.literal("operation"),
      operationId: id,
      target: operationSearchTargetSchema,
      field: key.optional(),
    })
    .strict(),
  z
    .object({
      area: z.literal("catalog"),
      catalogId: id,
      catalogKind: z.enum(["ORGANIZATION", "DOCTRINE", "SYMBOL", "ORBAT"]),
      field: key.optional(),
      nodeId: id.optional(),
      orbatId: id.optional(),
      sectionId: id.optional(),
      positionId: id.optional(),
    })
    .strict(),
  z.object({ area: z.literal("file"), assetId: id }).strict(),
]);
export type SearchTarget = z.infer<typeof searchTargetSchema>;
/** Canonical selector key. No display text, array position or DOM identity participates. */
export function targetKey(
  target: SearchTarget | OperationSearchTarget,
): string {
  const sort = (value: unknown): unknown =>
    value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sort(v)]),
        )
      : value;
  return JSON.stringify(sort(target));
}
export function cardSource(target: SearchTarget): PlanningTarget | null {
  if (target.area !== "operation") return null;
  const parsed = planningTargetSchema.safeParse(target.target);
  return parsed.success ? parsed.data : null;
}
