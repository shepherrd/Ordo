import { z } from "zod";
import { savedSymbolPinSchema } from "./symbology";
const id = z.string().uuid();
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const frame = {
  id,
  x: z.number().finite().min(0).max(3200),
  y: z.number().finite().min(0).max(2400),
  width: z.number().finite().min(60).max(3200),
  height: z.number().finite().min(40).max(2400),
  locked: z.boolean(),
};
const writing = {
  text: z.string().max(6000),
  fill: color,
  ink: color,
  fontSize: z.number().int().min(12).max(48),
};
export const whiteboardItemSchema = z.discriminatedUnion("kind", [
  z.object({ ...frame, ...writing, kind: z.literal("note") }).strict(),
  z.object({ ...frame, ...writing, kind: z.literal("text") }).strict(),
  z
    .object({
      ...frame,
      ...writing,
      kind: z.literal("shape"),
      shape: z.enum(["rectangle", "ellipse", "diamond"]),
    })
    .strict(),
  z
    .object({
      ...frame,
      kind: z.literal("symbol"),
      label: z.string().max(160),
      pin: savedSymbolPinSchema,
    })
    .strict(),
  z
    .object({
      ...frame,
      kind: z.literal("graphic"),
      label: z.string().max(160),
      exportId: id,
    })
    .strict(),
  z.object({ ...frame, kind: z.literal("card"), cardId: id }).strict(),
]);
export const whiteboardConnectorSchema = z
  .object({
    id,
    fromId: id,
    toId: id,
    label: z.string().max(160),
    color,
    style: z.enum(["solid", "dashed"]),
    arrow: z.enum(["none", "end", "both"]),
  })
  .strict();
export const whiteboardSchema = z
  .object({
    id,
    name: z.string().trim().min(1).max(160),
    width: z.number().int().min(640).max(3200),
    height: z.number().int().min(360).max(2400),
    background: color,
    items: z.array(whiteboardItemSchema).max(300),
    connectors: z.array(whiteboardConnectorSchema).max(600),
  })
  .strict()
  .superRefine((b, ctx) => {
    const ids = new Set(b.items.map((i) => i.id));
    if (
      ids.size !== b.items.length ||
      new Set(b.connectors.map((c) => c.id)).size !== b.connectors.length ||
      b.connectors.some((c) => ids.has(c.id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Whiteboard items and connectors require unique IDs",
      });
    for (const i of b.items)
      if (i.x + i.width > b.width || i.y + i.height > b.height)
        ctx.addIssue({
          code: "custom",
          message: "Whiteboard items must fit inside the canvas",
        });
    for (const c of b.connectors)
      if (c.fromId === c.toId || !ids.has(c.fromId) || !ids.has(c.toId))
        ctx.addIssue({
          code: "custom",
          message: "Connectors require two different items on this board",
        });
  });
export const whiteboardsSchema = z
  .object({
    schemaVersion: z.literal(1),
    boards: z.array(whiteboardSchema).max(12),
  })
  .strict()
  .refine(
    (v) => new Set(v.boards.map((b) => b.id)).size === v.boards.length,
    "Duplicate whiteboard IDs",
  );
export type Whiteboard = z.infer<typeof whiteboardSchema>;
export type WhiteboardItem = z.infer<typeof whiteboardItemSchema>;
export type WhiteboardConnector = z.infer<typeof whiteboardConnectorSchema>;
export function newWhiteboard(id: string): Whiteboard {
  return {
    id,
    name: "New whiteboard",
    width: 1600,
    height: 900,
    background: "#ffffff",
    items: [],
    connectors: [],
  };
}
export function removeBoardItems(board: Whiteboard, ids: readonly string[]) {
  const removed = new Set(ids);
  board.items = board.items.filter((i) => !removed.has(i.id));
  board.connectors = board.connectors.filter(
    (c) => !removed.has(c.fromId) && !removed.has(c.toId),
  );
}
/** Copy layout identities without duplicating the operational facts represented by cards. */
export function duplicateWhiteboard(
  board: Whiteboard,
  uid: () => string,
): Whiteboard {
  const copy = structuredClone(board),
    ids = new Map(copy.items.map((i) => [i.id, uid()]));
  copy.id = uid();
  copy.name = (copy.name + " copy").slice(0, 160);
  copy.items.forEach((i) => (i.id = ids.get(i.id)!));
  copy.connectors.forEach((c) => {
    c.id = uid();
    c.fromId = ids.get(c.fromId)!;
    c.toId = ids.get(c.toId)!;
  });
  return copy;
}
export function fitBoardItem(board: Whiteboard, item: WhiteboardItem) {
  item.width = Math.max(60, Math.min(board.width, item.width));
  item.height = Math.max(40, Math.min(board.height, item.height));
  item.x = Math.max(0, Math.min(board.width - item.width, item.x));
  item.y = Math.max(0, Math.min(board.height - item.height, item.y));
}
