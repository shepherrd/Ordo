import { z } from "zod";
import {
  symbolId as id,
  symbolDigest as digest,
  symbolLabel as label,
} from "./symbology";
export const dictionaryCitationSchema = z
  .object({
    publicationTitle: label,
    publicationIdentifier: label,
    editionDate: label.nullable(),
    incorporatedChangeNumber: label.nullable(),
    incorporatedChangeDate: label.nullable(),
    publicationLocation: label.nullable(),
    provenanceClass: z.literal("CURATED_FM_MAPPING"),
    sourceHash: digest,
    table: label,
    section: z.number().int().nonnegative(),
    row: z.number().int().nonnegative(),
  })
  .strict();
export const symbolDictionaryEntrySchema = z
  .object({
    entryId: id,
    term: label,
    category: label,
    section: z.string().max(500),
    ordinal: z.number().int().nonnegative(),
    description: z.string().max(20000),
    notes: z.array(z.string().max(20000)).max(20),
    mappingKind: z.enum(["ECHELON", "MAIN_FUNCTION", "SECTOR_1", "SECTOR_2"]),
    sidc: z
      .string()
      .regex(/^\d{30}$/)
      .nullable(),
    availability: z.enum([
      "MAPPED",
      "UNAVAILABLE",
      "DISCREPANT",
      "SUBSTITUTION",
    ]),
    editorialIssues: z.array(z.string().max(1000)).max(20),
    citation: dictionaryCitationSchema,
  })
  .strict()
  .refine(
    (v) => (v.sidc === null) === (v.availability === "UNAVAILABLE"),
    "Unavailable dictionary mapping must not invent a SIDC",
  );
export const symbolDictionaryDatasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: id,
    release: label,
    sourceHash: digest,
    title: label,
    entries: z.array(symbolDictionaryEntrySchema).max(2000),
  })
  .strict()
  .refine(
    (v) => new Set(v.entries.map((e) => e.entryId)).size === v.entries.length,
    "Duplicate dictionary identity",
  );
export type SymbolDictionaryDataset = z.infer<
  typeof symbolDictionaryDatasetSchema
>;
