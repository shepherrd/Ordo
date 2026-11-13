import { archivedGraphicOperation } from "./recorded-graphic-layout";
import type { GraphicExportRecord } from "../domain/graphic-exports";
import type { Operation } from "../domain/model";
import { projectGraphicV2 } from "../export/graphic-projection-v2";
import { canonical } from "../export/projections/v1";
import { assertGeneratedSvg } from "../validation/generated-svg";
import { verifyDiagramManifests } from "./order-graphics";
import { presentGraphicSvg } from "./graphic-output";

/** Restore verifies retained input and bytes without rerendering or upgrading artifacts. */
export function verifyGraphicV2(
  r: GraphicExportRecord,
  bytes: Uint8Array,
  hash: (s: string) => string,
  op?: Operation,
): void {
  if (r.schemaVersion !== 2) return;
  const { request, dependencies } = projectGraphicV2(
    r.source,
    r.profile,
    op && archivedGraphicOperation(r, op),
  );
  if (canonical(dependencies) !== canonical(r.dependencies))
    throw Error("Graphic consumed source dependencies mismatch");
  if (!r.renderedSvg || hash(r.renderedSvg) !== r.renderedSvgHash)
    throw Error("Retained graphic SVG hash mismatch");
  assertGeneratedSvg(r.renderedSvg);
  if (
    r.layoutVersion !==
    (request.kind === "ORBAT" ? request.input.layout.algorithm : null)
  )
    throw Error("Graphic layout manifest mismatch");
  if (request.kind === "ORBAT")
    verifyDiagramManifests(request.input, r.renderManifests, hash);
  else {
    const m = r.renderManifests[0];
    if (
      r.renderManifests.length !== 1 ||
      m.inputHash !== hash(canonical(request.input)) ||
      m.definitionHash !== hash(canonical(request.input.definition)) ||
      canonical(m.renderProfile) !==
        canonical(request.input.definition.renderProfile)
    )
      throw Error("Graphic symbol manifest does not match its consumed input");
  }
  if (
    r.profile.format === "SVG" &&
    new TextDecoder("utf-8", { fatal: true }).decode(bytes) !==
      presentGraphicSvg(r.renderedSvg, r.profile)
  )
    throw Error("Graphic SVG output differs from retained rendering");
  if (r.profile.format === "PNG" && r.raster?.svgHash !== r.renderedSvgHash)
    throw Error("Raster source SVG mismatch");
}
