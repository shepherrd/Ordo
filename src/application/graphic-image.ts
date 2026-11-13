import type { SymbologyRepository } from "./symbology-ports";
// SVGs come only from the verified, retained renderer output and are embedded as inert images.
export function graphicImage(
  repo: Pick<SymbologyRepository, "getGraphicExport" | "hashBinary">,
  exportId: string,
) {
  const { record, bytes } = repo.getGraphicExport(exportId);
  if (!["SVG", "PNG"].includes(record.profile.format))
    throw Error("Choose a saved SVG or PNG graphic.");
  if (bytes.byteLength > 10 * 1024 * 1024)
    throw Error("Graphics must be no larger than 10 MiB.");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    data: `data:${record.profile.format === "SVG" ? "image/svg+xml" : "image/png"};base64,${btoa(binary)}`,
    hash: repo.hashBinary(bytes),
    label: record.profile.name,
  };
}
