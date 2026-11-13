import { createHash } from "node:crypto";
import dictionaryResource from "./resources/fm-dictionary-v1.json";
import { flagResources as flags } from "./flag-resources";
import legacyResource from "./resources/legacy-catalog-v1.json";
import { symbolDictionaryDatasetSchema } from "../domain/symbol-dictionary";
import {
  symbolCatalogCommandSchema,
  legacyCatalogSchema,
  type SymbolCatalogResult,
} from "../application/symbol-catalog";
import { canonical } from "../export/projection";
import { editNumericSegment } from "../domain/symbol-codes";
import { metadataSelectorsV1 } from "./metadata-selector-v1";
import { previewLegacyCrosswalk } from "../application/legacy-crosswalk";
import { browseBuiltinSymbols } from "./builtin-symbol-catalog";
const metadata = metadataSelectorsV1();
const dictionary = symbolDictionaryDatasetSchema.parse(dictionaryResource),
  hash = createHash("sha256").update(canonical(dictionary)).digest("hex");
const categories = [...new Set(dictionary.entries.map((e) => e.category))];
const legacy = legacyCatalogSchema.parse(legacyResource),
  legacyHash = createHash("sha256").update(canonical(legacy)).digest("hex");
export function symbolCatalog(input: unknown): SymbolCatalogResult {
  const c = symbolCatalogCommandSchema.parse(input);
  if (c.type === "builtin-browse") return browseBuiltinSymbols(c);
  if (c.type === "legacy-crosswalk")
    return { crosswalk: previewLegacyCrosswalk(c.code) };
  if (c.type === "legacy-sets")
    return { choices: legacy.groups.map((g) => ({ id: g.id, name: g.name })) };
  if (c.type === "legacy-metadata") {
    const g = legacy.groups.find((g) => g.id === c.set);
    if (!g) throw Error("Unavailable legacy selector group");
    const query = c.search.toLowerCase(),
      rows = g.entries.filter((e) =>
        `${e.name} ${e.names.join(" ")} ${e.functionId}`
          .toLowerCase()
          .includes(query),
      );
    return {
      choices: rows.slice(c.offset, c.offset + c.limit).map((e) => ({
        id: e.id,
        name: e.names.join(" / "),
        note: `${e.scheme}*${e.dimension}*${e.functionId} · ${e.remarks}`,
      })),
      total: rows.length,
    };
  }
  if (c.type === "legacy-apply") {
    const entry = legacy.groups
      .flatMap((g) => g.entries)
      .find((e) => e.id === c.entryId);
    if (!entry) throw Error("Unknown legacy catalog entry");
    const definition = structuredClone(c.definition),
      old = definition.code;
    if (c.action === "APPLY_COMPONENT") {
      if (
        old.dialect !== "LETTER" ||
        old.sidc[0] !== entry.scheme ||
        old.sidc[2] !== entry.dimension
      )
        throw Error(
          "Different legacy scheme/dimension; use Open Example deliberately",
        );
      definition.code = {
        ...old,
        sidc: old.sidc.slice(0, 4) + entry.functionId + old.sidc.slice(10),
        assertedStandard: "UNVERIFIED",
      };
    } else
      definition.code = {
        dialect: "LETTER",
        sidc:
          entry.scheme + "F" + entry.dimension + "P" + entry.functionId + "--",
        assertedStandard: "UNVERIFIED",
        sourceConvention: "LETTER_CODE",
      };
    definition.origin = {
      kind: "CATALOG",
      catalogId: legacy.id,
      release: legacy.release,
      catalogHash: legacyHash,
      entryId: entry.id,
    };
    return { definition };
  }
  if (c.type === "sets")
    return {
      choices: Object.entries(metadata)
        .filter(([id]) => id !== "common")
        .map(([id, s]) => ({ id, name: s.name })),
    };
  if (c.type === "flags")
    return {
      choices: Object.entries(flags).map(([id, f]) => ({ id, name: f.name })),
    };
  if (c.type === "main-search") {
    const query = c.search.toLowerCase();
    const rows = Object.entries(metadata)
      .filter(([id]) => id !== "common")
      .flatMap(([symbolSet, set]) =>
        set.mainIcon.map((r) => ({
          id: r.Code,
          symbolSet,
          name: Object.entries(r)
            .filter(([k]) => !["Code", "Remarks", "Category"].includes(k))
            .map(([, v]) => v.trim())
            .filter(Boolean)
            .join(" / "),
          note: `${set.name} · ${r.Remarks || r.Category || ""}`,
        })),
      )
      .filter((r) =>
        `${r.name} ${r.id} ${r.note}`.toLowerCase().includes(query),
      );
    return {
      choices: rows.slice(c.offset, c.offset + c.limit),
      total: rows.length,
    };
  }
  if (c.type === "dictionary") {
    const query = c.search.toLowerCase(),
      rows = dictionary.entries.filter(
        (e) =>
          (!c.category || e.category === c.category) &&
          `${e.term} ${e.description} ${e.notes.join(" ")}`
            .toLowerCase()
            .includes(query),
      );
    return {
      dictionary: {
        datasetId: dictionary.datasetId,
        release: dictionary.release,
        hash,
        entries: rows.slice(c.offset, c.offset + c.limit),
        categories,
        total: rows.length,
      },
    };
  }
  if (c.type === "dictionary-apply") {
    const entry = dictionary.entries.find((e) => e.entryId === c.entryId);
    if (!entry?.sidc) throw Error("This dictionary mapping is unavailable");
    const definition = structuredClone(c.definition),
      code = definition.code;
    if (c.action === "OPEN_EXAMPLE")
      definition.code = {
        dialect: "NUMERIC",
        sidc: entry.sidc,
        assertedStandard: "UNVERIFIED",
        sourceConvention: "NUMERIC_13",
      };
    else {
      if (
        code.dialect !== "NUMERIC" ||
        code.sidc.slice(4, 6) !== entry.sidc.slice(4, 6)
      )
        throw Error(
          "This component belongs to a different symbol set; use Open Example deliberately",
        );
      const [start, length] = (
        {
          ECHELON: [8, 2],
          MAIN_FUNCTION: [10, 6],
          SECTOR_1: [16, 2],
          SECTOR_2: [18, 2],
        } as const
      )[entry.mappingKind];
      definition.code = editNumericSegment(
        code,
        (
          {
            ECHELON: "echelonMobility",
            MAIN_FUNCTION: "mainFunction",
            SECTOR_1: "modifier1",
            SECTOR_2: "modifier2",
          } as const
        )[entry.mappingKind],
        entry.sidc.slice(start, start + length),
      );
    }
    definition.origin = {
      kind: "DICTIONARY",
      datasetId: dictionary.datasetId,
      release: dictionary.release,
      datasetHash: hash,
      entryId: entry.entryId,
    };
    return { definition };
  }
  const set = metadata[c.set];
  if (!set) throw Error("Unavailable symbol-set metadata");
  const owner = c.field.startsWith("COMMON") ? metadata.common : set;
  const key =
    c.field === "MAIN"
      ? "mainIcon"
      : c.field.endsWith("1")
        ? "modifier1"
        : "modifier2";
  const query = c.search.toLowerCase(),
    rows = owner[key]
      .map((row) => ({
        id: row.Code,
        name: Object.entries(row)
          .filter(([key]) => !["Code", "Remarks", "Category"].includes(key))
          .map(([, value]) => value.trim())
          .filter(Boolean)
          .join(" / "),
        note: row.Remarks || row.Category || "",
      }))
      .filter((row) =>
        `${row.name} ${row.id} ${row.note}`.toLowerCase().includes(query),
      );
  return {
    choices: rows.slice(c.offset, c.offset + c.limit),
    total: rows.length,
  };
}
