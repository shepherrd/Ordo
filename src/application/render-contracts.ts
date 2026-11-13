import type { GraphicRenderRequest } from "../domain/graphic-input";
export type { GraphicRenderRequest } from "../domain/graphic-input";
import type { SymbolGeometry, SymbolRenderResult } from "./symbology-ports";
import type { RenderManifest } from "../domain/symbology";
export interface LayoutNode {
  id: string;
  parentId: string | null;
  geometry: SymbolGeometry;
  leftGeometry?: SymbolGeometry;
  hq: boolean;
  planned: boolean;
}
export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  box: { left: number; right: number; top: number; bottom: number };
  labelSide: "LEFT" | "RIGHT";
  synthetic: "GROUP" | "FOLD" | null;
}
export interface OrbatLayoutResult {
  algorithm: import("../domain/orbat").OrbatLayout["algorithm"];
  nodes: PositionedNode[];
  connectors: { from: string; to: string; path: string; dashed: boolean }[];
  bounds: { x: number; y: number; width: number; height: number };
  slot: { width: number; height: number };
}
export interface DiagramRenderResult {
  svg: string;
  svgHash: string;
  layout: OrbatLayoutResult;
  renderManifests: RenderManifest[];
  diagnostics: string[];
}
export type GraphicRenderResult =
  | { kind: "SYMBOL"; result: SymbolRenderResult }
  | { kind: "ORBAT"; result: DiagramRenderResult };
export interface GraphicRenderPort {
  render(
    request: GraphicRenderRequest,
    signal?: AbortSignal,
  ): Promise<GraphicRenderResult>;
}
export interface RasterResult {
  bytes: Uint8Array;
  svgHash: string;
  width: number;
  height: number;
  rasterizer: string;
  fontFingerprint: string;
}
export interface RasterPort {
  rasterize(
    svg: string,
    scale: number,
    background: "WHITE" | "TRANSPARENT",
    signal?: AbortSignal,
  ): Promise<RasterResult>;
}
