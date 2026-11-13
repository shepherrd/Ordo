import { createHash } from "node:crypto";
import { z } from "zod";
import {
  legacyCatalogSchema,
  type SymbolCatalogCommand,
  type SymbolCatalogResult,
  type BuiltinSymbolEntry,
} from "../application/symbol-catalog";
import {
  newSymbolDefinition,
  militarySymbolDefinitionSchema,
} from "../domain/symbology";
import {
  editNumericSegment,
  type NumericSegment,
} from "../domain/symbol-codes";
import { symbolDictionaryDatasetSchema } from "../domain/symbol-dictionary";
import { canonical } from "../export/projection";
import { metadataSelectorsV1 } from "./metadata-selector-v1";
import legacyResource from "./resources/legacy-catalog-v1.json";
import sofResource from "./resources/legacy-sof-catalog-v1.json";
import fmResource from "./resources/fm-dictionary-v1.json";

const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const metadata = metadataSelectorsV1(),
  numericHash = hash(metadata);
const legacy = legacyCatalogSchema.parse(legacyResource);
const sof = legacyCatalogSchema
  .extend({
    id: z.literal("ordo-legacy-sof-selector-v1"),
    groups: z.array(legacyCatalogSchema.shape.groups.element).length(1),
  })
  .parse(sofResource);
const dictionary = symbolDictionaryDatasetSchema.parse(fmResource),
  dictionaryHash = hash(dictionary);
type Collection = "NUMERIC" | "LEGACY" | "FM";
type Row = BuiltinSymbolEntry & { groupId: string };
function base(id: string) {
  const h = hash(id);
  return newSymbolDefinition(
    () =>
      `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`,
  );
}
const rows: Record<Collection, Row[]> = { NUMERIC: [], LEGACY: [], FM: [] };
const groups: Record<Collection, { id: string; name: string }[]> = {
  NUMERIC: [],
  LEGACY: [],
  FM: [],
};
for (const [setId, set] of Object.entries(metadata)) {
  groups.NUMERIC.push({ id: setId, name: set.name || "Common modifiers" });
  for (const field of ["mainIcon", "modifier1", "modifier2"] as const) {
    for (const row of set[field]) {
      const id = `numeric:${setId}:${field}:${row.Code}`,
        definition = base(id);
      if (setId !== "common")
        definition.code = editNumericSegment(
          definition.code,
          "symbolSet",
          setId,
        );
      if (setId !== "common")
        definition.code = editNumericSegment(
          definition.code,
          "mainFunction",
          "000000",
        );
      const segment: NumericSegment =
        field === "mainIcon"
          ? "mainFunction"
          : setId === "common"
            ? field === "modifier1"
              ? "commonModifier1"
              : "commonModifier2"
            : field;
      definition.code = editNumericSegment(definition.code, segment, row.Code);
      definition.origin = {
        kind: "CATALOG",
        catalogId: "ordo-numeric-selector-v1",
        release: "milstandard-e@0.2.14+selector-overlay-v1",
        catalogHash: numericHash,
        entryId: id,
      };
      const kind =
        field === "mainIcon"
          ? "Main function"
          : setId === "common"
            ? `Common modifier ${field.endsWith("1") ? "1" : "2"}`
            : `Sector ${field.endsWith("1") ? "1" : "2"}`;
      rows.NUMERIC.push({
        id,
        groupId: setId,
        name: Object.entries(row)
          .filter(([key]) => !["Code", "Remarks", "Category"].includes(key))
          .map(([, v]) => v.trim())
          .filter(Boolean)
          .join(" / "),
        group: set.name || "Common modifiers",
        kind,
        code: row.Code,
        definition: militarySymbolDefinitionSchema.parse(definition),
        notes: [
          row.Remarks,
          row.Category,
          field === "mainIcon"
            ? ""
            : "Component example; configure its main function and other fields in the builder.",
        ].filter(Boolean),
        source: "milstandard-e 0.2.14 · selector overlay",
        availability: "CATALOG",
      });
    }
  }
}
for (const dataset of [legacy, sof]) {
  const catalogHash = hash(dataset);
  for (const group of dataset.groups) {
    groups.LEGACY.push({ id: group.id, name: group.name });
    for (const entry of group.entries) {
      const definition = base(entry.id);
      definition.code = {
        dialect: "LETTER",
        sidc: `${entry.scheme}F${entry.dimension}P${entry.functionId}--`,
        assertedStandard: "UNVERIFIED",
        sourceConvention: "LETTER_CODE",
      };
      definition.origin = {
        kind: "CATALOG",
        catalogId: dataset.id,
        release: dataset.release,
        catalogHash,
        entryId: entry.id,
      };
      rows.LEGACY.push({
        id: entry.id,
        groupId: group.id,
        name: entry.names.join(" / "),
        group: group.name,
        kind: "Legacy function",
        code: definition.code.sidc,
        definition: militarySymbolDefinitionSchema.parse(definition),
        notes: [
          entry.remarks,
          "Original legacy code; no numeric conversion.",
        ].filter(Boolean),
        source: "mil-std-2525 0.2.5 · legacy selectors",
        availability: "CATALOG",
      });
    }
  }
}
for (const entry of dictionary.entries) {
  if (!groups.FM.some((g) => g.id === entry.category))
    groups.FM.push({ id: entry.category, name: entry.category });
  const definition = base(entry.entryId);
  if (entry.sidc)
    definition.code = {
      dialect: "NUMERIC",
      sidc: entry.sidc,
      assertedStandard: "UNVERIFIED",
      sourceConvention: "NUMERIC_13",
    };
  definition.origin = {
    kind: "DICTIONARY",
    datasetId: dictionary.datasetId,
    release: dictionary.release,
    datasetHash: dictionaryHash,
    entryId: entry.entryId,
  };
  const citation = entry.citation;
  rows.FM.push({
    id: entry.entryId,
    groupId: entry.category,
    name: entry.term,
    group: entry.category,
    kind: entry.mappingKind.replaceAll("_", " "),
    code: entry.sidc,
    definition: entry.sidc
      ? militarySymbolDefinitionSchema.parse(definition)
      : null,
    notes: [entry.description, ...entry.notes, ...entry.editorialIssues].filter(
      Boolean,
    ),
    source: [
      citation.publicationTitle,
      citation.publicationIdentifier,
      citation.editionDate,
      citation.incorporatedChangeNumber &&
        `Change ${citation.incorporatedChangeNumber}`,
      citation.incorporatedChangeDate,
      citation.publicationLocation,
      citation.provenanceClass,
      `${citation.table} · section ${citation.section} · row ${citation.row}`,
      `Source SHA-256 ${citation.sourceHash}`,
    ]
      .filter(Boolean)
      .join(" · "),
    availability: entry.availability,
  });
}
export function browseBuiltinSymbols(
  c: Extract<SymbolCatalogCommand, { type: "builtin-browse" }>,
): SymbolCatalogResult {
  const query = c.search.toLowerCase().trim();
  const matched = rows[c.collection].filter(
    (r) =>
      (!c.group || r.groupId === c.group) &&
      `${r.name} ${r.code ?? ""} ${r.definition?.code.sidc ?? ""} ${r.group} ${r.kind} ${r.notes.join(" ")}`
        .toLowerCase()
        .includes(query),
  );
  return {
    builtin: {
      entries: structuredClone(matched.slice(c.offset, c.offset + c.limit)),
      groups: groups[c.collection],
      total: matched.length,
      catalogTotal: rows[c.collection].length,
    },
  };
}
