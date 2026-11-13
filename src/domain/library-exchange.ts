import { archivedId } from "./archived-format";
import { z } from "zod";
import {
  exactLibraryRefSchema,
  savedSymbolVersionSchema,
  symbolDigest,
  symbolId,
} from "./symbology";
import { savedOrbatVersionSchema, m6Limits } from "./orbat";
import { unitProfileSchema } from "./unit-profiles";
export const exchangeRootSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("SYMBOL"), value: savedSymbolVersionSchema })
    .strict(),
  z
    .object({ kind: z.literal("ORBAT"), value: savedOrbatVersionSchema })
    .strict(),
]);
export const exchangeDependencySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("SYMBOL"),
      ref: exactLibraryRefSchema,
      document: savedSymbolVersionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("PROFILE"),
      ref: exactLibraryRefSchema,
      document: unitProfileSchema,
    })
    .strict(),
]);
export const nativeExchangeSchema = z
  .object({
    format: z.literal("ORDO_LIBRARY_EXCHANGE"),
    schemaVersion: z.literal(1),
    dependencyScope: z.literal("COMPOSITION_PINS_AND_SYMBOL_ORIGINS"),
    root: exchangeRootSchema,
    rootHash: symbolDigest,
    dependencies: z.array(exchangeDependencySchema).max(10000),
    contentHash: symbolDigest,
  })
  .strict();
export type NativeExchange = z.infer<typeof nativeExchangeSchema>;
export type ExchangeDependency = z.infer<typeof exchangeDependencySchema>;
export type ExchangeRoot = z.infer<typeof exchangeRootSchema>;
export const conversionFieldSchema = z
  .object({
    path: z.string().max(4000),
    action: z.enum([
      "COPIED",
      "DEFAULTED",
      "REMAPPED",
      "REUSED",
      "DETACHED",
      "OMITTED",
      "UNSUPPORTED",
      "INVALID",
      "CONFLICT",
      "MISSING",
      "INFO",
    ]),
    source: z.string().max(2000),
    target: z.string().max(2000),
    detail: z.string().max(2000),
  })
  .strict();
export type ConversionField = z.infer<typeof conversionFieldSchema>;
export const exchangeMappingSchema = z
  .object({
    kind: z.enum(["FAMILY", "VERSION", "NODE", "LAYOUT", "DEFINITION"]),
    source: z.string().max(4000),
    target: symbolId,
  })
  .strict();
export type ExchangeMapping = z.infer<typeof exchangeMappingSchema>;
export const exchangeImportReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: symbolId,
    at: z.string().datetime(),
    actor: z.string().min(1).max(160),
    importer: z.union([z.literal("ordo-exchange-v1"), archivedId("importer")]),
    policy: z.enum(["REUSE_EXACT", "DETACHED_COPIES"]),
    sourceName: z.string().min(1).max(240),
    sourceText: z.string().max(m6Limits.jsonBytes),
    sourceHash: symbolDigest,
    mappings: z.array(exchangeMappingSchema).max(12000),
    fields: z.array(conversionFieldSchema).max(100000),
    targets: z.array(exchangeRootSchema).min(1).max(m6Limits.nodes),
  })
  .strict();
export type ExchangeImportReceipt = z.infer<typeof exchangeImportReceiptSchema>;
