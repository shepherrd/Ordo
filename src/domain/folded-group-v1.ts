import { newSymbolDefinition } from "./symbology";
// Presentation resource; never materialized as a unit or persisted in a tree.
export function foldedGroupDefinitionV1() {
  const d = newSymbolDefinition(() => "00000000-0000-4000-8000-000000000006");
  d.code.sidc = "130310000000000000000000000000";
  d.appearance.fillColor = "#DCDEDF";
  d.appearance.infoFields = false;
  d.compatibility.stack = 4;
  return d;
}
