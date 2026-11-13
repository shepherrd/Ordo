import { z } from "zod";
import type { AppState } from "./service";
import type { ManagedAsset } from "../domain/modules";
export const fileCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("asset-import"),
      owner: z.discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("unit-profile"), id: z.string().uuid() })
          .strict(),
        z
          .object({ kind: z.literal("operation"), id: z.string().uuid() })
          .strict(),
        z
          .object({ kind: z.literal("doctrine"), id: z.string().uuid() })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({ type: z.literal("asset-preview"), assetId: z.string().uuid() })
    .strict(),
  z
    .object({ type: z.literal("asset-save"), assetId: z.string().uuid() })
    .strict(),
  z
    .object({ type: z.literal("doctrine-export"), id: z.string().uuid() })
    .strict(),
  z.object({ type: z.literal("doctrine-import") }).strict(),
]);
export type FileCommand = z.infer<typeof fileCommandSchema>;
export interface FileResult {
  asset?: ManagedAsset;
  data?: string;
  state?: AppState;
  path?: string;
  doctrineId?: string;
}
