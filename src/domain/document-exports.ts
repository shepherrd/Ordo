import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const paperOptionsSchema = z
  .object({
    paper: z.enum(["Letter", "A4"]),
    orientation: z.enum(["portrait", "landscape"]),
  })
  .strict();
export type PaperOptions = z.infer<typeof paperOptionsSchema>;
const historicalDocumentExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    operationId: z.string().uuid(),
    sourceExportId: z.string().uuid(),
    sourceExportHash: hash,
    sourceHtmlHash: hash,
    printHtmlHash: hash,
    contentHash: hash,
    byteLength: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 * 1024),
    generatedAt: z.string().datetime(),
    actor: z.string().max(160),
    printVersion: z.literal("ordo-print-v1"),
    options: paperOptionsSchema,
    environment: z
      .object({
        appVersion: z.string().max(32),
        electron: z.string().max(32),
        chromium: z.string().max(32),
        fontFingerprint: hash,
      })
      .strict(),
  })
  .strict();
export const documentExportSchema = z.union([
  historicalDocumentExportSchema.extend({
    schemaVersion: z.literal(3),
    printVersion: z.literal("ordo-print-v3"),
  }),
  historicalDocumentExportSchema,
  historicalDocumentExportSchema.extend({
    schemaVersion: z.literal(2),
    printVersion: z.literal("ordo-print-v2"),
  }),
]);
export type DocumentExport = z.infer<typeof documentExportSchema>;
