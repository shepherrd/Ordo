import { m6Limits } from "../domain/orbat";
export function rasterDimensions(svg: string, scale: number) {
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 8)
    throw Error("Invalid raster scale");
  const root = svg.match(/^<svg\s[^>]*>/)?.[0];
  const w = root?.match(/\bwidth="([\d.]+)"/)?.[1],
    h = root?.match(/\bheight="([\d.]+)"/)?.[1];
  if (!w || !h)
    throw Error("Raster source requires explicit numeric dimensions");
  const width = Math.ceil(Number(w) * scale),
    height = Math.ceil(Number(h) * scale);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > m6Limits.rasterSide ||
    height > m6Limits.rasterSide ||
    width * height > m6Limits.rasterPixels
  )
    throw Error("Raster exceeds supported dimensions or pixel budget");
  return { width, height };
}
