import { z } from "zod";
import {
  militarySymbolDefinitionSchema,
  symbolId,
  symbolCodeSchema,
  type MilitarySymbolDefinition,
} from "../domain/symbology";
import type { SymbolDictionaryDataset } from "../domain/symbol-dictionary";
import type { CrosswalkPreview } from "./legacy-crosswalk";
export const symbolCatalogCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("builtin-browse"),
      collection: z.enum(["NUMERIC", "LEGACY", "FM"]),
      group: z.string().max(160),
      search: z.string().max(200),
      offset: z.number().int().min(0).max(100000),
      limit: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({ type: z.literal("legacy-crosswalk"), code: symbolCodeSchema })
    .strict(),
  z.object({ type: z.literal("legacy-sets") }).strict(),
  z
    .object({
      type: z.literal("legacy-metadata"),
      set: z.string().max(30),
      search: z.string().max(200),
      offset: z.number().int().min(0).max(100000),
      limit: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("legacy-apply"),
      entryId: z.string().min(1).max(200),
      action: z.enum(["OPEN_EXAMPLE", "APPLY_COMPONENT"]),
      definition: militarySymbolDefinitionSchema,
    })
    .strict(),
  z.object({ type: z.literal("sets") }).strict(),
  z.object({ type: z.literal("flags") }).strict(),
  z
    .object({
      type: z.literal("main-search"),
      search: z.string().max(200),
      offset: z.number().int().min(0).max(100000),
      limit: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("metadata"),
      set: z.string().regex(/^\d{2}$/),
      field: z.enum([
        "MAIN",
        "MODIFIER_1",
        "MODIFIER_2",
        "COMMON_1",
        "COMMON_2",
      ]),
      search: z.string().max(200),
      offset: z.number().int().min(0),
      limit: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("dictionary"),
      search: z.string().max(200),
      category: z.string().max(160),
      offset: z.number().int().min(0),
      limit: z.number().int().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("dictionary-apply"),
      entryId: symbolId,
      action: z.enum(["OPEN_EXAMPLE", "APPLY_COMPONENT"]),
      definition: militarySymbolDefinitionSchema,
    })
    .strict(),
]);
export const legacyCatalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal("ordo-legacy-selector-v1"),
    release: z.literal("mil-std-2525@0.2.5/2525c"),
    source: z.string().url(),
    license: z.literal("MIT"),
    groups: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            entries: z.array(
              z
                .object({
                  id: z.string().min(1).max(200),
                  scheme: z.string().length(1),
                  dimension: z.string().length(1),
                  functionId: z.string().regex(/^[A-Z0-9\-]{6}$/),
                  name: z.string(),
                  names: z.array(z.string()),
                  remarks: z.string(),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .length(7),
  })
  .strict();
export type SymbolCatalogCommand = z.infer<typeof symbolCatalogCommandSchema>;
export interface BuiltinSymbolEntry {
  id: string;
  name: string;
  group: string;
  kind: string;
  code: string | null;
  definition: MilitarySymbolDefinition | null;
  notes: string[];
  source: string;
  availability: string;
}
export interface SymbolCatalogResult {
  builtin?: {
    entries: BuiltinSymbolEntry[];
    groups: { id: string; name: string }[];
    total: number;
    catalogTotal: number;
  };
  crosswalk?: CrosswalkPreview;
  choices?: { id: string; name: string; note?: string; symbolSet?: string }[];
  total?: number;
  dictionary?: {
    datasetId: string;
    release: string;
    hash: string;
    entries: SymbolDictionaryDataset["entries"];
    categories: string[];
    total: number;
  };
  definition?: MilitarySymbolDefinition;
}
