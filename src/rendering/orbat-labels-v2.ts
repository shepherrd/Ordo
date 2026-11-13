import ms, {
  type SymbolColors,
  type SymbolMetadata,
  type SymbolOptions,
} from "milsymbol";
import {
  installCompatibilityV1,
  type CompatibilityOptions,
} from "./symbol-markings-v1";
import { splitDesignation, textWidth } from "./text-metrics";

type Box = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  merge(value: Partial<Box>): Box;
};
type Draw = { type: string; [key: string]: unknown };
interface SymbolInternals {
  options: SymbolOptions &
    CompatibilityOptions & { ordoSeparatedLabels?: boolean };
  metadata: SymbolMetadata;
  colors: SymbolColors;
  style: { fontfamily: string; infoColor: string | Record<string, string> };
}
type Part = (
  this: SymbolInternals,
  engine: ExtensionEngine,
) => { pre: Draw[]; post: Draw[]; bbox: Box };
interface ExtensionEngine {
  BBox: new (box: Partial<Box>) => Box;
  getSymbolParts(): Part[];
  setSymbolParts(parts: Part[]): void;
}
const engine = ms as unknown as ExtensionEngine;
let installed = false;

/** Profile 2 reserves one aligned text column beyond the existing right-side marks.
 * Frame/flag/signature geometry and the diagram layout adapter stay unchanged.
 * Profile 1 always delegates to the retained original label function.
 */
const separatedLabels: Part = function () {
  const frame = this.metadata.baseGeometry.bbox;
  const box = new engine.BBox(frame),
    post: Draw[] = [];
  const [first, second] = splitDesignation(
    this.options.uniqueDesignation ?? "",
  );
  const left = this.options.orbatLabelAlign === "left";
  const start = frame.x2 + 20 + (this.options.stack ?? 0) * 15;
  const signature = this.options.signature === "!";
  const fullFlag =
    this.options.full_frame_flag &&
    this.metadata.affiliation === "Friend" &&
    this.metadata.dimension === "Ground";
  const smallFlag = !!this.options.country_flag && !fullFlag;
  const x = left
    ? frame.x1 - 20
    : smallFlag
      ? start + (signature ? 30 : 0) + 640 * 0.09 + 12
      : signature
        ? start + 22 + 12
        : start;
  const info = this.style.infoColor;
  const fill =
    (typeof info === "string" ? info : info[this.metadata.affiliation]) ||
    (this.colors.iconColor as unknown as Record<string, string>)[
      this.metadata.affiliation
    ] ||
    this.colors.iconColor.Friend;
  for (const row of [
    { text: first, y: 90, bold: true },
    { text: second, y: 130, bold: true },
    {
      text: this.options.additionalInformation ?? "",
      y: second ? 170 : 130,
      bold: false,
    },
  ]) {
    if (!row.text) continue;
    post.push({
      type: "text",
      text: row.text,
      x,
      y: row.y,
      textanchor: left ? "end" : "start",
      fontsize: 40,
      fontfamily: this.style.fontfamily,
      fill,
      stroke: false,
      ...(row.bold ? { fontweight: "bold" } : {}),
    });
    const width = textWidth(row.text, 40, 4, row.bold);
    box.merge({
      x1: left ? x - width : box.x1,
      x2: left ? box.x2 : x + width,
      y1: Math.min(box.y1, row.y - 40),
      y2: Math.max(box.y2, row.y + 10),
    });
  }
  return { pre: [], post, bbox: box };
};

export function installSeparatedLabelsV2() {
  if (installed) return;
  installCompatibilityV1();
  // V1 appends its ORBAT label extension after the upstream parts. Install once;
  // dispatch per symbol so mixed-profile compositions never mutate global modes.
  const parts = engine.getSymbolParts().slice();
  const original = parts[parts.length - 1];
  parts[parts.length - 1] = function (e) {
    return this.options.ordoSeparatedLabels && this.options.orbatLabel
      ? separatedLabels.call(this, e)
      : original.call(this, e);
  };
  engine.setSymbolParts(parts);
  installed = true;
}
