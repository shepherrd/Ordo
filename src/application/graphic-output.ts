import type { GraphicExportProfile } from "../domain/graphic-exports";
/** SVG presentation is retained independently of the source renderer's SVG. */
export function presentGraphicSvg(
  svg: string,
  p: GraphicExportProfile,
): string {
  if (p.scale !== 1)
    svg = svg.replace(
      /^(<svg\s[^>]*?\bwidth=")([\d.]+)("\sheight=")([\d.]+)(")/,
      (_m, a, w, b, h, c) =>
        a + Number(w) * p.scale + b + Number(h) * p.scale + c,
    );
  if (p.background === "WHITE")
    svg = svg.replace(
      /^(<svg\s[^>]*>)/,
      '$1<rect x="-1000000" y="-1000000" width="2000000" height="2000000" fill="#ffffff"/>',
    );
  return svg;
}
