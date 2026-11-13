import {
  newSymbolDefinition,
  militarySymbolDefinitionSchema,
  type MilitarySymbolDefinition,
} from "./symbology";
import { editNumericSegment } from "./symbol-codes";

export function resetSymbolDraft(
  value: MilitarySymbolDefinition,
): MilitarySymbolDefinition {
  const current = militarySymbolDefinitionSchema.parse(value),
    next = newSymbolDefinition(() => current.definitionId),
    legacyPrefix = current.code.sidc[2] === "G" ? 5 : 4;
  next.code = {
    ...current.code,
    sidc:
      current.code.dialect === "NUMERIC"
        ? current.code.sidc.slice(0, 6) +
          "0".repeat(current.code.sidc.length - 6)
        : current.code.sidc.slice(0, legacyPrefix) +
          "-".repeat(current.code.sidc.length - legacyPrefix),
  };
  next.renderProfile = structuredClone(current.renderProfile);
  return militarySymbolDefinitionSchema.parse(next);
}

export function changeSymbolSet(
  value: MilitarySymbolDefinition,
  set: string,
): MilitarySymbolDefinition {
  let code = editNumericSegment(value.code, "symbolSet", set);
  for (const key of [
    "mainFunction",
    "modifier1",
    "modifier2",
    "echelonMobility",
  ] as const)
    code = editNumericSegment(
      code,
      key,
      key === "mainFunction" ? "000000" : "00",
    );
  if (code.sidc.length === 30)
    for (const key of ["commonModifier1", "commonModifier2"] as const)
      code = editNumericSegment(code, key, "000");
  return militarySymbolDefinitionSchema.parse({
    ...value,
    code,
    origin: { kind: "MANUAL" },
  });
}
