import type { MilitarySymbolDefinition } from "./symbology";
const segments = {
  context: [2, 1],
  identity: [3, 1],
  symbolSet: [4, 2],
  status: [6, 1],
  hqTaskForceDummy: [7, 1],
  echelonMobility: [8, 2],
  mainFunction: [10, 6],
  modifier1: [16, 2],
  modifier2: [18, 2],
  // Extended sector modifiers are split across the legacy two-digit slots and
  // their separate hundreds digits. Position 22 is frame shape, not a modifier.
  commonModifier1: [16, 3],
  commonModifier2: [18, 3],
  frameShape: [22, 1],
} as const;
export type NumericSegment = keyof typeof segments;
export function numericSegment(
  code: MilitarySymbolDefinition["code"],
  key: NumericSegment,
): string | null {
  if (code.dialect !== "NUMERIC" || !/^(?:\d{20}|\d{30})$/.test(code.sidc))
    return null;
  const [start, length] = segments[key];
  if (key === "commonModifier1" || key === "commonModifier2")
    return code.sidc.length === 30
      ? code.sidc[key === "commonModifier1" ? 20 : 21] +
          code.sidc.slice(start, start + 2)
      : null;
  return code.sidc.length >= start + length
    ? code.sidc.slice(start, start + length)
    : null;
}
export function editNumericSegment(
  code: MilitarySymbolDefinition["code"],
  key: NumericSegment,
  value: string,
): MilitarySymbolDefinition["code"] {
  const old = numericSegment(code, key),
    [start, length] = segments[key];
  if (old === null)
    throw Error(
      "This code form does not contain the selected field; no conversion was inferred",
    );
  if (value.length !== length || !/^[0-9]+$/.test(value))
    throw Error("Incorrect numeric field width");
  if (key === "commonModifier1" || key === "commonModifier2") {
    const extension = key === "commonModifier1" ? 20 : 21,
      chars = code.sidc.split("");
    chars[extension] = value[0];
    chars[start] = value[1];
    chars[start + 1] = value[2];
    return { ...code, sidc: chars.join("") };
  }
  let sidc =
    code.sidc.slice(0, start) + value + code.sidc.slice(start + length);
  if (code.sidc.length === 30 && (key === "modifier1" || key === "modifier2")) {
    const extension = key === "modifier1" ? 20 : 21;
    sidc = sidc.slice(0, extension) + "0" + sidc.slice(extension + 1);
  }
  return {
    ...code,
    sidc,
  };
}
export function legacySegments(code: MilitarySymbolDefinition["code"]) {
  if (code.dialect !== "LETTER" || !/^[A-Z0-9*\-]{12,15}$/.test(code.sidc))
    return null;
  return {
    scheme: code.sidc[0],
    identity: code.sidc[1],
    dimension: code.sidc[2],
    status: code.sidc[3],
    function: code.sidc.slice(4, 10),
    modifier: code.sidc.slice(10, 12),
    country: code.sidc.length >= 14 ? code.sidc.slice(12, 14) : null,
    orderOfBattle: code.sidc.length === 15 ? code.sidc[14] : null,
  };
}
const legacyPositions = {
  scheme: [0, 1],
  identity: [1, 1],
  dimension: [2, 1],
  status: [3, 1],
  function: [4, 6],
  modifier: [10, 2],
  country: [12, 2],
  orderOfBattle: [14, 1],
} as const;
export type LegacySegment = keyof typeof legacyPositions;
export function editLegacySegment(
  code: MilitarySymbolDefinition["code"],
  key: LegacySegment,
  value: string,
): MilitarySymbolDefinition["code"] {
  const [start, length] = legacyPositions[key];
  if (!legacySegments(code) || code.sidc.length < start + length)
    throw Error("This legacy form does not contain the selected field");
  if (value.length !== length || !/^[A-Z0-9*\-]+$/.test(value))
    throw Error("Incorrect legacy field width or characters");
  return {
    ...code,
    sidc: code.sidc.slice(0, start) + value + code.sidc.slice(start + length),
  };
}
