import ms, { type SymbolOptions } from "milsymbol";
import { createHash } from "node:crypto";
import {
  militarySymbolDefinitionSchema,
  renderManifestSchema,
} from "../domain/symbology";
import type {
  SymbolRenderRequest,
  SymbolRenderResult,
} from "../application/symbology-ports";
import { canonical } from "../export/projection";
import resources from "./resources/resource-manifest.json";
import metrics from "./resources/arial-metrics-v1.json";
import paths from "./resources/symbol-marking-paths-v1.json";
import coreDeltas from "./resources/symbol-path-corrections-v1.json";
import natoReplacement from "./resources/nato-flag-replacement-v1.json";
import { restoreCorePathsV1 } from "./symbol-path-corrections-v1";
import {
  installCompatibilityV1,
  type CompatibilityOptions,
} from "./symbol-markings-v1";
import { assertGeneratedSvg, namespaceSvg } from "./svg-safety";
import { symbolRenderRequestSchema } from "./render-request";
import { installSeparatedLabelsV2 } from "./orbat-labels-v2";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function renderSymbol(input: SymbolRenderRequest): SymbolRenderResult {
  const request = symbolRenderRequestSchema.parse(input),
    d = request.definition;
  if (
    d.renderProfile.id !== "ordo-symbol" ||
    ![1, 2].includes(d.renderProfile.version)
  )
    throw Error("Unavailable symbol render profile");
  if (d.renderProfile.version === 2) installSeparatedLabelsV2();
  else installCompatibilityV1();
  const { convention, frameColor, ...appearance } = d.appearance;
  const options: SymbolOptions &
    CompatibilityOptions & { ordoSeparatedLabels?: boolean } = {
    ...(d.renderProfile.version === 2 ? { ordoSeparatedLabels: true } : {}),
    ...d.amplifiers,
    ...appearance,
    ...(frameColor
      ? {
          frameColor: ms.ColorMode(
            frameColor,
            frameColor,
            frameColor,
            frameColor,
            frameColor,
            frameColor,
          ),
        }
      : {}),
    standard: convention,
    size: request.size,
    fontfamily: "Arial",
    infoSize: 40,
    stack: d.compatibility.stack,
    generalStars: d.compatibility.generalStars,
    reinforced: d.compatibility.reinforced,
    signature: d.compatibility.signature,
    specialheadquarter: d.compatibility.specialHeadquarters,
    country_flag: d.compatibility.flagId ?? "",
    full_frame_flag: d.compatibility.flagMode === "FULL_FRAME",
    orbatLabel: request.context === "ORBAT_NODE",
    orbatLabelAlign: request.labelSide === "LEFT" ? "left" : "right",
  };
  if (request.context === "ORBAT_NODE" || request.context === "FOLDED_GROUP") {
    options.infoFields = false;
    options.padding = 20;
  }
  const symbol = new ms.Symbol(d.code.sidc, options);
  if (!symbol.isValid())
    throw Error("Symbol code is not renderable by the pinned engine");
  const inputHash = hash(canonical(request)),
    definitionHash = hash(canonical(d));
  const svg = namespaceSvg(
    restoreCorePathsV1(symbol.asSVG()),
    "s" + inputHash.slice(0, 16),
  );
  assertGeneratedSvg(svg);
  const geometry = {
    size: symbol.getSize(),
    anchor: symbol.getAnchor(),
    octagon: symbol.getOctagonAnchor(),
  };
  for (const point of Object.values(geometry))
    for (const value of Object.values(point))
      if (!Number.isFinite(value)) throw Error("Nonfinite symbol geometry");
  const diagnostics: string[] = [];
  if (d.code.dialect === "LETTER")
    diagnostics.push(
      "Legacy letter code retained; no numeric SIDC conversion was inferred.",
    );
  if (d.code.assertedStandard === "UNVERIFIED")
    diagnostics.push(
      "Rendering does not verify this code against a doctrinal source.",
    );
  if (
    d.compatibility.flagMode === "FULL_FRAME" &&
    d.compatibility.flagId &&
    !(
      symbol.getMetadata().affiliation === "Friend" &&
      symbol.getMetadata().dimension === "Ground"
    )
  )
    diagnostics.push("This frame uses the small-flag fallback.");
  const manifest = renderManifestSchema.parse({
    schemaVersion: 1,
    upstream: {
      name: "milsymbol",
      version: "3.0.4",
      integrity:
        "sha512-Jrs1RBCag2IzyEJwI476i2+pNHdi8WMwAp2mDD23g3TR48ERdHmdQgPXZUosRKyhPMr58/eOPyyLE53lMPPAgw==",
    },
    compatibilityLayer:
      d.renderProfile.version === 2
        ? "ordo-symbol-layout-v1+orbat-labels-v2"
        : "ordo-symbol-layout-v1",
    metadata: resources.metadata,
    textMetrics: { id: metrics.id, hash: hash(canonical(metrics)) },
    resources: {
      id: "ordo-symbol-resources-v1",
      hash: hash(
        canonical({
          flags: resources.flags,
          natoReplacement,
          compatibilityPaths: paths,
          coreDeltas,
        }),
      ),
    },
    renderProfile: d.renderProfile,
    definitionHash,
    inputHash,
  });
  return { svg, geometry, manifest, diagnostics, svgHash: hash(svg) };
}
