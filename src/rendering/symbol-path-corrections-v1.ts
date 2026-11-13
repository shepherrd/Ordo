import rules from "./resources/symbol-path-corrections-v1.json";
/** Exact, reviewed drawing substitutions over trusted generated SVG only.
 * No broad SIDC remapping, geometry inference, or changes to upstream code.
 * The rules resource participates in every render manifest's resource hash.
 */
export function restoreCorePathsV1(svg: string): string {
  for (const rule of rules.pathReplacements)
    svg = svg.replaceAll(`d="${rule.from}"`, `d="${rule.to}"`);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const second of rules.pathOrder.second) {
    const adjacent = new RegExp(
      `(<path d="${escape(rules.pathOrder.first)}"[^>]*><\\/path>)(<path d="${escape(second)}"[^>]*><\\/path>)`,
      "g",
    );
    svg = svg.replace(adjacent, "$2$1");
  }
  return svg;
}
