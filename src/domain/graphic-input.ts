import type { MilitarySymbolDefinition } from "./symbology";
import type { DiagramRequest } from "./diagram";

export interface SymbolRenderRequest {
  definition: MilitarySymbolDefinition;
  size: number;
  context: "SYMBOL" | "ORBAT_NODE" | "FOLDED_GROUP";
  labelSide: "LEFT" | "RIGHT";
}
export type GraphicRenderRequest =
  | { kind: "SYMBOL"; input: SymbolRenderRequest }
  | { kind: "ORBAT"; input: DiagramRequest };
