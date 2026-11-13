export { assertGeneratedSvg } from "../validation/generated-svg";
export const xmlText = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export const numberText = (n: number) => {
  if (!Number.isFinite(n)) throw Error("Nonfinite SVG geometry");
  return String(Math.round(n * 10000) / 10000);
};
export function namespaceSvg(svg: string, prefix: string) {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix))
    throw Error("Invalid SVG namespace");
  const ids = [...svg.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  for (const id of ids) {
    svg = svg
      .replaceAll(`id="${id}"`, `id="${prefix}-${id}"`)
      .replaceAll(`#${id}"`, `#${prefix}-${id}"`)
      .replaceAll(`#${id})`, `#${prefix}-${id})`);
  }
  return svg;
}
