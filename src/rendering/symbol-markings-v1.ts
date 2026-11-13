import ms, {
  type SymbolMetadata,
  type SymbolColors,
  type SymbolOptions,
} from "milsymbol";
import pathsResource from "./resources/symbol-marking-paths-v1.json";
import { flagResources as flags } from "./flag-resources";
import { namespaceSvg, numberText } from "./svg-safety";
import { splitDesignation, textWidth } from "./text-metrics";

type Draw = { type: string; [key: string]: unknown };
type Box = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  merge(other: Partial<Box>): Box;
};
type Palette = Record<string, string>;
export interface CompatibilityOptions {
  generalStars: number;
  reinforced: string;
  signature: string;
  specialheadquarter: string;
  country_flag: string;
  full_frame_flag: boolean;
  orbatLabel: boolean;
  orbatLabelAlign: "left" | "right";
}
interface SymbolInternals {
  options: SymbolOptions & CompatibilityOptions;
  style: Required<
    Pick<
      SymbolOptions,
      "infoSize" | "fontfamily" | "outlineWidth" | "strokeWidth"
    >
  > & { outlineColor: string | Palette; infoColor: string | Palette };
  bbox: Box;
  metadata: SymbolMetadata;
  colors: SymbolColors;
}
type Part = (
  this: SymbolInternals,
  engine: ExtensionEngine,
) => { pre: Draw[]; post: Draw[]; bbox: Box };
interface ExtensionEngine {
  BBox: new (box: Partial<Box>) => Box;
  getSymbolParts(): Part[];
  setSymbolParts(parts: Part[]): void;
  outline(draw: Draw[], width: number, stroke: number, color: string): Draw;
}
// milsymbol exposes these documented runtime extension hooks; its published .d.ts
// omits them. This is the sole boundary cast, exercised against the exact package.
const engine = ms as unknown as ExtensionEngine;
const paths = pathsResource.paths;
let installed = false;
const affiliationColor = (value: string | Palette, affiliation: string) =>
  typeof value === "string" ? value : value[affiliation];
function withOutline(s: SymbolInternals, draw: Draw[]) {
  return s.style.outlineWidth > 0
    ? [
        engine.outline(
          draw,
          s.style.outlineWidth,
          s.style.strokeWidth,
          affiliationColor(s.style.outlineColor, s.metadata.affiliation),
        ),
      ]
    : [];
}
function frameColor(s: SymbolInternals) {
  return (s.colors.frameColor as unknown as Palette)[s.metadata.affiliation];
}
function labelColor(s: SymbolInternals) {
  return (
    affiliationColor(s.style.infoColor, s.metadata.affiliation) ||
    (s.colors.iconColor as unknown as Palette)[s.metadata.affiliation] ||
    s.colors.iconColor.Friend
  );
}

const stars: Part = function () {
  const box = new engine.BBox(this.bbox),
    post: Draw[] = [];
  const count = this.options.generalStars;
  if (this.metadata.baseGeometry.g && frameColor(this) && count) {
    post.push({
      type: "path",
      d:
        `M0,${box.y1 - 50} ` +
        paths.stars[String(count) as keyof typeof paths.stars],
      fill: "yellow",
      stroke: "black",
      strokewidth: 3,
    });
    box.merge({
      y1: box.y1 - 40,
      x1: 100 - (40 * count) / 2,
      x2: 100 + (40 * count) / 2,
    });
  }
  return { pre: withOutline(this, post), post, bbox: box };
};
const additions: Part = function () {
  const frame = this.metadata.baseGeometry.bbox,
    box = new engine.BBox(this.bbox),
    post: Draw[] = [];
  const color = frameColor(this),
    size = this.style.infoSize,
    stack = (this.options.stack ?? 0) * 15;
  if (this.metadata.baseGeometry.g && color) {
    const r = this.options.reinforced as "+" | "-" | "±" | "";
    if (r) {
      post.push({
        type: "path",
        d: `M${frame.x2 + 20 + stack},${90 - 1.5 * size} ` + paths[r],
        fill: color,
        stroke: false,
      });
      box.merge({ x2: frame.x2 + 57 + stack, y1: 100 - 2.5 * size });
    }
    if (this.options.signature === "!") {
      post.push({
        type: "text",
        text: "!",
        x: frame.x2 + 20 + stack,
        y: 100 + 2.5 * size,
        fill: color,
        fontfamily: this.style.fontfamily,
        fontsize: size,
        fontweight: "bold",
        textanchor: "start",
      });
      // Keep the font's descender extent inside standalone exports as well as
      // the ink above the baseline; reference's box stopped at the text baseline.
      box.merge({ x2: frame.x2 + 42 + stack, y1: 145, y2: 110 + 2.5 * size });
    }
    const hq = this.options.specialheadquarter;
    if (hq) {
      const fontSize =
        hq.length <= 2
          ? 45
          : hq.length === 3
            ? 35
            : hq.length === 4
              ? 32
              : hq.length === 5
                ? 29
                : hq.length === 6
                  ? 26
                  : hq.length === 7
                    ? 25
                    : 24;
      post.push({
        type: "text",
        text: hq,
        x: 100,
        y: 103,
        textanchor: "middle",
        alignmentBaseline: "middle",
        fontsize: fontSize,
        fontfamily: this.style.fontfamily,
        fill: labelColor(this),
        stroke: false,
        fontweight: "bold",
      });
      const half = textWidth(hq, fontSize, 0, true) / 2;
      box.merge({ x1: 100 - half, x2: 100 + half });
    }
  }
  return { pre: withOutline(this, post), post, bbox: box };
};
const flag: Part = function () {
  const box = new engine.BBox(this.metadata.baseGeometry.bbox),
    post: Draw[] = [];
  const id = this.options.country_flag;
  if (!id) return { pre: [], post, bbox: box };
  const source = flags[id];
  if (!source)
    throw Error("Flag is unavailable in the pinned resource profile: " + id);
  const full =
    this.options.full_frame_flag &&
    this.metadata.affiliation === "Friend" &&
    this.metadata.dimension === "Ground";
  const stack = (this.options.stack ?? 0) * 15,
    signature = this.options.signature === "!" ? 30 : 0;
  const scale = full ? 0.24 : 0.09,
    x = full ? 23 : box.x2 + 20 + stack + signature,
    y = full ? 42 : 140;
  const svg = namespaceSvg(source.svg, "flag-" + id).replace(
    "<svg ",
    `<svg x="${numberText(x)}" y="${numberText(y)}" width="${numberText(640 * scale)}" height="${numberText(480 * scale)}" `,
  );
  const geometry = this.metadata.baseGeometry.g;
  if (full && typeof geometry === "object" && geometry.type === "path")
    post.push({
      type: "clip",
      clipId: "ordo-full-flag",
      d: geometry.d,
      draw: [{ type: "svg", svg }],
    });
  else if (full && typeof geometry === "object") {
    // Upstream circular frames expose their geometric instruction at runtime.
    const g = geometry as unknown as {
      type: string;
      cx: number;
      cy: number;
      r: number;
    };
    if (g.type !== "circle")
      throw Error("Unsupported full-frame flag geometry");
    post.push({
      type: "svg",
      svg: `<defs><clipPath id="ordo-full-flag"><circle cx="${numberText(g.cx)}" cy="${numberText(g.cy)}" r="${numberText(g.r)}"/></clipPath></defs><g clip-path="url(#ordo-full-flag)">${svg}</g>`,
    });
  } else {
    post.push({ type: "svg", svg });
    box.x2 += 100 + stack + signature;
    box.y2 += 40;
  }
  return { pre: [], post, bbox: box };
};
const labels: Part = function () {
  const frame = this.metadata.baseGeometry.bbox,
    box = new engine.BBox(frame),
    post: Draw[] = [];
  if (!this.options.orbatLabel) return { pre: [], post, bbox: box };
  const [first, second] = splitDesignation(
      this.options.uniqueDesignation ?? "",
    ),
    additional = this.options.additionalInformation ?? "";
  const left = this.options.orbatLabelAlign === "left",
    stack = (this.options.stack ?? 0) * 15;
  const extra = second && this.options.country_flag ? 70 : 0,
    x = left ? frame.x1 - 20 : frame.x2 + 20 + stack;
  const rows = [
    { text: first, y: 90, bold: true, x },
    { text: second, y: 130, bold: true, x },
    {
      text: additional,
      y: 130 + (second ? 40 : 0),
      bold: false,
      x: x + (left ? 0 : extra),
    },
  ];
  for (const row of rows) {
    if (!row.text) continue;
    post.push({
      type: "text",
      text: row.text,
      x: row.x,
      y: row.y,
      textanchor: left ? "end" : "start",
      fontsize: 40,
      fontfamily: this.style.fontfamily,
      fill: labelColor(this),
      stroke: false,
      ...(row.bold ? { fontweight: "bold" } : {}),
    });
    const width = textWidth(row.text, 40, 4, row.bold);
    box.merge({
      x1: left ? row.x - width : box.x1,
      x2: left ? box.x2 : row.x + width,
      y1: Math.min(box.y1, row.y - 40),
      y2: Math.max(box.y2, row.y + 10),
    });
  }
  return { pre: [], post, bbox: box };
};
export function installCompatibilityV1() {
  if (installed) return;
  if (ms.getVersion() !== "3.0.4")
    throw Error("Unreviewed symbol engine version");
  const parts = engine.getSymbolParts().slice();
  parts.splice(5, 0, stars);
  parts.splice(6, 0, additions);
  parts.splice(2, 0, flag);
  parts.push(labels);
  engine.setSymbolParts(parts);
  installed = true;
}
