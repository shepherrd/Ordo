import { z } from "zod";
import raw from "./legacy-crosswalk-v1.json";
import {
  symbolCodeSchema,
  type MilitarySymbolDefinition,
} from "../domain/symbology";
import { legacySegments } from "../domain/symbol-codes";
const target = z
  .object({
    symbolSet: z.string().regex(/^\d{2}$/),
    function: z.string().regex(/^\d{6}$/),
    modifier1: z.string().regex(/^\d{2}$/),
    modifier2: z.string().regex(/^\d{2}$/),
  })
  .strict();
const schema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.literal("ordo-legacy-crosswalk-v1"),
    release: z.string(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    upstreamSource: z.string().url(),
    upstreamHash: z.string().regex(/^[a-f0-9]{64}$/),
    upstreamLicense: z.string(),
    entries: z
      .array(
        z
          .object({
            key: z.string().regex(/^S-[PAGSU]-[A-Z0-9*-]{6}$/),
            sourceRowHash: z.string().regex(/^[a-f0-9]{64}$/),
            status: z.enum([
              "MATCHED",
              "AMBIGUOUS",
              "DISCREPANT",
              "UNVERIFIED",
            ]),
            target: target.nullable(),
            upstreamCandidates: z.array(target).max(20),
          })
          .strict(),
      )
      .length(730),
  })
  .strict();
export const legacyCrosswalkV1 = schema.parse(raw);
const rows = new Map(legacyCrosswalkV1.entries.map((r) => [r.key, r]));
export interface CrosswalkPreview {
  sourceCode: string;
  candidateCode: string | null;
  status: "MATCHED" | "AMBIGUOUS" | "DISCREPANT" | "UNVERIFIED" | "UNAVAILABLE";
  sourceKey: string;
  sourceRowHash: string | null;
  release: string;
  diagnostics: string[];
  fields: {
    field: string;
    source: string;
    target: string | null;
    action: "MAPPED" | "OMITTED" | "UNSUPPORTED";
  }[];
}
/** Inspection only. No source mutation, implicit conversion or nearest match. */
export function previewLegacyCrosswalk(
  code: MilitarySymbolDefinition["code"],
): CrosswalkPreview {
  code = symbolCodeSchema.parse(code);
  const s = legacySegments(code);
  const result: CrosswalkPreview = {
    sourceCode: code.sidc,
    candidateCode: null,
    status: "UNAVAILABLE",
    sourceKey: "",
    sourceRowHash: null,
    release: legacyCrosswalkV1.release,
    diagnostics: [],
    fields: [],
  };
  if (
    !s ||
    s.scheme !== "S" ||
    !["P", "A", "G", "S", "U"].includes(s.dimension)
  ) {
    result.diagnostics.push(
      "Only the inspected non-SOF warfighting legacy selector scope is available.",
    );
    return result;
  }
  const key = `${s.scheme}-${s.dimension}-${s.function}`,
    row = rows.get(key);
  result.sourceKey = key;
  if (!row) {
    result.diagnostics.push(
      "No exact inspected crosswalk row; no fallback was inferred.",
    );
    return result;
  }
  result.status = row.status;
  result.sourceRowHash = row.sourceRowHash;
  if (row.status !== "MATCHED" || !row.target) {
    result.diagnostics.push(
      row.status === "AMBIGUOUS"
        ? "Multiple licensed upstream targets exist; no target was selected."
        : row.status === "DISCREPANT"
          ? "The reference row differs from licensed upstream mapping data. Conversion is unavailable pending provenance resolution."
          : "No licensed upstream counterpart was verified; conversion is unavailable.",
    );
    return result;
  }
  const field = (
    field: string,
    source: string,
    target: string | null,
    omitted = false,
  ) =>
    result.fields.push({
      field,
      source,
      target,
      action: omitted ? "OMITTED" : target === null ? "UNSUPPORTED" : "MAPPED",
    });
  const identity: Record<string, string> = {
      P: "0",
      U: "1",
      A: "2",
      F: "3",
      N: "4",
      S: "5",
      H: "6",
    },
    status: Record<string, string> = {
      P: "0",
      A: "1",
      C: "2",
      D: "3",
      X: "4",
      F: "5",
    };
  field("identity", s.identity, identity[s.identity] ?? null);
  field("status", s.status, status[s.status] ?? null);
  const hqs: Record<string, string> = {
    "-": "0",
    F: "1",
    A: "2",
    C: "3",
    E: "4",
    G: "5",
    B: "6",
    D: "7",
  };
  const echelons: Record<string, string> = {
      "-": "00",
      A: "11",
      B: "12",
      C: "13",
      D: "14",
      E: "15",
      F: "16",
      G: "17",
      H: "18",
      I: "21",
      J: "22",
      K: "23",
      L: "24",
      M: "25",
      N: "26",
    },
    mobility: Record<string, string> = {
      O: "31",
      P: "32",
      Q: "33",
      R: "34",
      S: "35",
      T: "36",
      W: "37",
      U: "41",
      V: "42",
      X: "51",
      Y: "52",
    },
    towed: Record<string, string> = { S: "61", L: "62" };
  const m = s.modifier[0],
    e = s.modifier[1],
    hq =
      m === "M" || m === "N"
        ? "0"
        : s.dimension === "G"
          ? (hqs[m] ?? null)
          : m === "-"
            ? "0"
            : null;
  const echelon =
    (m === "M" ? mobility : m === "N" ? towed : echelons)[e] ?? null;
  field("headquarters/task force/dummy", m, hq);
  field("echelon/mobility", e, echelon);
  field("function", s.function, row.target.function);
  field("sector 1", s.function, row.target.modifier1);
  field("sector 2", s.function, row.target.modifier2);
  if (code.sidc.length > 12)
    field("country suffix", code.sidc.slice(12, 14), null, true);
  if (s.orderOfBattle !== null)
    field("order-of-battle suffix", s.orderOfBattle, null, true);
  if (result.fields.some((f) => f.action === "UNSUPPORTED")) {
    result.status = "UNAVAILABLE";
    result.diagnostics.push(
      "At least one legacy component has no verified conversion; no default was substituted.",
    );
    return result;
  }
  result.candidateCode =
    "130" +
    identity[s.identity] +
    row.target.symbolSet +
    status[s.status] +
    hq +
    echelon +
    row.target.function +
    row.target.modifier1 +
    row.target.modifier2;
  result.diagnostics.push(
    "Read-only numeric candidate uses the numeric prefix 13 and reality context. This is not an assertion of edition equivalence.",
    "Country and order-of-battle suffixes have no target slots in this 20-digit candidate; original code remains authoritative.",
  );
  return result;
}
