import type { GraphicalView } from "../export/projections/v5";
import { canonical } from "../export/projection";
import {
  retainedOrderGraphicSchema,
  type RetainedOrderGraphic,
} from "../domain/order-graphics";
import type { GraphicRenderPort } from "./render-contracts";
import { assertGeneratedSvg } from "../validation/generated-svg";
import { foldedGroupDefinitionV1 } from "../domain/folded-group-v1";
import type {
  MilitarySymbolDefinition,
  RenderManifest,
} from "../domain/symbology";

import type { DiagramRequest } from "../domain/diagram";

type Hash = (text: string) => string;
export function verifyDiagramManifests(
  input: DiagramRequest,
  manifests: RenderManifest[],
  hash: Hash,
): void {
  const nodes = new Map(input.nodes.map((n) => [n.id, n]));
  const folded = new Set(
    input.layout.hints.filter((h) => h.folded).map((h) => h.nodeId),
  );
  const hidden = (id: string) => {
    let parent = nodes.get(id)?.parentId;
    while (parent) {
      if (folded.has(parent)) return true;
      parent = nodes.get(parent)?.parentId;
    }
    return false;
  };
  const expected = new Map<
    string,
    { key: string; definitionHash: string; profile: string }
  >();
  const counts = new Map<string, number>();
  const allow = (
    key: string,
    definition: MilitarySymbolDefinition,
    size: number,
    context: "ORBAT_NODE" | "FOLDED_GROUP",
    labelSide: "LEFT" | "RIGHT",
  ) => {
    expected.set(hash(canonical({ definition, size, context, labelSide })), {
      key,
      definitionHash: hash(canonical(definition)),
      profile: canonical(definition.renderProfile),
    });
  };
  for (const n of input.nodes) {
    if (hidden(n.id)) continue;
    if (n.symbol) {
      counts.set(n.id, 1);
      for (const side of ["LEFT", "RIGHT"] as const)
        allow(
          n.id,
          n.symbol,
          (input.symbolSize ?? 30) * (n.parentId === null ? 4 / 3 : 1),
          "ORBAT_NODE",
          side,
        );
    }
    if (
      folded.has(n.id) &&
      input.nodes.some((child) => child.parentId === n.id)
    )
      counts.set("synthetic-fold", (counts.get("synthetic-fold") ?? 0) + 1);
  }
  if (counts.has("synthetic-fold"))
    allow(
      "synthetic-fold",
      foldedGroupDefinitionV1(),
      ((input.symbolSize ?? 30) * 2) / 3,
      "FOLDED_GROUP",
      "RIGHT",
    );
  let resources: string | undefined;
  const compatibilityByProfile = new Map<string, string>();
  for (const m of manifests) {
    const input = expected.get(m.inputHash);
    if (
      !input ||
      input.definitionHash !== m.definitionHash ||
      input.profile !== canonical(m.renderProfile) ||
      !counts.get(input.key)
    )
      throw Error(
        "Order symbol manifest does not match a consumed render input",
      );
    counts.set(input.key, counts.get(input.key)! - 1);
    const identity = canonical({
      upstream: m.upstream,
      metadata: m.metadata,
      textMetrics: m.textMetrics,
      resources: m.resources,
    });
    if (resources && identity !== resources)
      throw Error("Order graphic mixes inconsistent renderer resources");
    resources = identity;
    // Definitions pin their own profile. Mixed versions (including retained v1
    // folded placeholders) share resources but may use distinct label adapters.
    const profile = canonical(m.renderProfile);
    const compatibility = compatibilityByProfile.get(profile);
    if (compatibility && compatibility !== m.compatibilityLayer)
      throw Error(
        "Order graphic mixes inconsistent profile compatibility layers",
      );
    compatibilityByProfile.set(profile, m.compatibilityLayer);
  }
  if ([...counts.values()].some((n) => n !== 0))
    throw Error("Order graphic omits consumed symbol manifests");
}

export function verifyOrderGraphics(
  view: GraphicalView,
  values: readonly RetainedOrderGraphic[],
  hash: Hash,
): void {
  const requests = view.sections.flatMap((s) => (s.graphic ? [s.graphic] : []));
  if (
    requests.length !== values.length ||
    new Set(values.map((v) => v.request.blockId)).size !== values.length
  )
    throw Error("Order graphics do not match the projected blocks");
  let bytes = 0;
  for (const value of values) {
    const g = retainedOrderGraphicSchema.parse(value);
    const request = requests.find((r) => r.blockId === g.request.blockId);
    if (
      !request ||
      canonical(request) !== canonical(g.request) ||
      hash(canonical(request)) !== g.inputHash ||
      hash(g.svg) !== g.svgHash ||
      g.layoutVersion !== request.input.layout.algorithm
    )
      throw Error("Order graphic provenance or bytes mismatch");
    bytes += new TextEncoder().encode(g.svg).length;
    if (bytes > 32 * 1024 * 1024) throw Error("Order graphics exceed 32 MiB");
    assertGeneratedSvg(g.svg);
    verifyDiagramManifests(request.input, g.renderManifests, hash);
  }
}
export async function fulfillOrderGraphics(
  view: GraphicalView,
  renderer: GraphicRenderPort,
  hash: Hash,
  signal?: AbortSignal,
): Promise<RetainedOrderGraphic[]> {
  if (view.sections.filter((s) => s.graphic).length > 500)
    throw Error("Order exceeds 500 graphical blocks");
  const graphics: RetainedOrderGraphic[] = [];
  for (const request of view.sections.flatMap((s) =>
    s.graphic ? [s.graphic] : [],
  )) {
    if (signal?.aborted) throw Error("Order render canceled");
    const result = await renderer.render(
      { kind: "ORBAT", input: request.input },
      signal,
    );
    if (result.kind !== "ORBAT")
      throw Error("Unexpected order graphic render result");
    graphics.push({
      schemaVersion: 1,
      request,
      inputHash: hash(canonical(request)),
      svg: result.result.svg,
      svgHash: result.result.svgHash,
      layoutVersion: result.result.layout.algorithm,
      renderManifests: result.result.renderManifests,
      diagnostics: result.result.diagnostics,
    });
    verifyOrderGraphics(
      {
        ...view,
        sections: view.sections.filter(
          (s) =>
            s.graphic &&
            graphics.some((g) => g.request.blockId === s.graphic!.blockId),
        ),
      },
      graphics,
      hash,
    );
  }
  if (signal?.aborted) throw Error("Order render canceled");
  verifyOrderGraphics(view, graphics, hash);
  return graphics;
}
