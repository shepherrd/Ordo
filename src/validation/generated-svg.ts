// Only generated output enters this boundary. This is not an SVG-upload parser.
export function assertGeneratedSvg(svg: string): void {
  if (new TextEncoder().encode(svg).length > 16 * 1024 * 1024)
    throw Error("SVG exceeds 16 MiB");
  if (
    !/^<svg\s/.test(svg) ||
    !/<\/svg>\s*$/.test(svg) ||
    /<!DOCTYPE|<!ENTITY|<\?|<(?:script|foreignObject|iframe|image|style|a|animate|set)\b|\son[a-z]+\s*=/i.test(
      svg,
    )
  )
    throw Error("Unsafe generated SVG");
  const inertTags = new Set([
    "svg",
    "g",
    "defs",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
    "clippath",
    "use",
    "lineargradient",
    "radialgradient",
    "stop",
    "marker",
  ]);
  for (const tag of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b/g))
    if (!inertTags.has(tag[1].toLowerCase()))
      throw Error("Unsupported generated SVG element");
  if (/\s(?:href|xlink:href|style)\s*=\s*[^\s"']/i.test(svg))
    throw Error("Unquoted generated SVG reference or style");
  for (const m of svg.matchAll(/(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/gi))
    if (!/^#[A-Za-z0-9_-]+$/.test(m[2]))
      throw Error("External SVG reference forbidden");
  for (const m of svg.matchAll(/url\((.*?)\)/gi))
    if (!/^['"]?#[A-Za-z0-9_-]+['"]?$/.test(m[1]))
      throw Error("External SVG paint forbidden");
  // Only these inert declarations occur in the pinned licensed flag assets.
  const inertStyles = new Set([
    "marker:none",
    "line-height:normal;text-indent:0;text-align:start;text-decoration-line:none;text-transform:none;marker:none",
    "line-height:125%;text-align:center",
    "-inkscape-font-specification:&quot;Ubuntu Bold&quot;",
    "line-height:125%;text-align:start",
    "-inkscape-stroke:none",
  ]);
  for (const m of svg.matchAll(/<[^>]+\sstyle\s*=\s*(["'])(.*?)\1/gi))
    if (!inertStyles.has(m[2])) throw Error("Untrusted SVG styling");
}
