import type { Dependency, Operation } from "../domain/model";
import type { DiagramRequest } from "../domain/diagram";
import { canonical } from "./projections/v1";

/** Versioned normalization shared by new v5 order and standalone projections. */
export function consumedOrbatInputV5(
  input: DiagramRequest,
  prefix: string,
  op?: Operation,
): Dependency[] {
  const deps: Dependency[] = [];

  const track = (path: string, value: unknown) =>
    deps.push({ path: `${prefix}/${path}`, canonicalValue: canonical(value) });
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const folds = new Set(
    input.layout.hints.filter((h) => h.folded).map((h) => h.nodeId),
  );
  const hidden = (id: string) => {
    let parent = byId.get(id)?.parentId;
    while (parent) {
      if (folds.has(parent)) return true;
      parent = byId.get(parent)?.parentId;
    }
    return false;
  };
  input.layout.hints = input.layout.hints.filter((h) => !hidden(h.nodeId));
  track("layout/mode", input.layout.mode);
  track("layout/commandLevels", input.layout.commandLevels);
  track("layout/algorithm", input.layout.algorithm);
  track("layout/labelProfile", input.layout.labelProfile);
  input.layout.siblingOrder = input.layout.siblingOrder.filter(
    (id) => !hidden(id),
  );
  track(
    "node-order",
    input.nodes.filter((n) => !hidden(n.id)).map((n) => n.id),
  );
  track("layout/siblingOrder", input.layout.siblingOrder);
  for (const hint of input.layout.hints)
    track(`layout/hints/${hint.nodeId}`, hint);
  for (const node of input.nodes) {
    // Visible symbol annotations have already resolved into additionalInformation.
    // The raw source field is never rendered, including on folded/text-card nodes.
    node.annotation = "";
    track(`units/${node.id}/parentUnitId`, node.parentId);
    track(`units/${node.id}/boundary`, node.boundary);
    if (hidden(node.id)) {
      // Folded descendants contribute topology only, never names, symbols or label metrics.
      node.symbol = null;
      node.name = "";
      continue;
    }
    if (!node.symbol) {
      if (!node.boundary) track(`units/${node.id}/name`, node.name);
      track(`units/${node.id}/symbol`, null);
      continue;
    }
    const state = op?.units.find((u) => u.id === node.id)?.symbol;
    const d = node.symbol;
    // Input hashes and SVG namespaces must not change for non-displayed provenance.
    d.definitionId = node.id;
    d.origin = { kind: "MANUAL" };
    d.code.assertedStandard = "UNVERIFIED";
    d.code.sourceConvention = "NATIVE";
    d.appearance.infoFields = false; // the pinned ORBAT renderer forces this
    // ORBAT labels replace the standard text fields; direction arrows are also
    // disabled by infoFields=false. Engagement bars render independently.
    d.amplifiers = Object.fromEntries(
      Object.entries(d.amplifiers).filter(
        ([key]) =>
          [
            "uniqueDesignation",
            "additionalInformation",
            "engagementBar",
          ].includes(key) ||
          (key === "engagementType" && !!d.amplifiers.engagementBar),
      ),
    );
    if (!d.compatibility.flagId) d.compatibility.flagMode = "SMALL";
    node.name = ""; // symbol labels come from the resolved definition only
    track(`units/${node.id}/symbol/code`, {
      dialect: d.code.dialect,
      sidc: d.code.sidc,
    });
    track(`units/${node.id}/symbol/appearance`, d.appearance);
    track(`units/${node.id}/symbol/compatibility`, d.compatibility);
    track(`units/${node.id}/symbol/renderProfile`, d.renderProfile);
    for (const [key, value] of Object.entries(d.amplifiers))
      track(`units/${node.id}/symbol/amplifiers/${key}`, value);
    for (const [key, binding] of Object.entries(state?.labels ?? {})) {
      if (key !== "uniqueDesignation") continue;
      track(`units/${node.id}/symbol/labels/${key}`, binding);
      if (binding.kind === "UNIT_NAME")
        track(
          `units/${node.id}/name`,
          op!.units.find((u) => u.id === node.id)!.name,
        );
      if (binding.kind === "PARENT_UNIT_NAME") {
        const unit = op!.units.find((u) => u.id === node.id)!;
        track(`units/${node.id}/labelParent`, unit.parentUnitId);
        if (
          unit.parentUnitId &&
          byId.has(unit.parentUnitId) &&
          !byId.get(unit.parentUnitId)!.boundary
        )
          track(
            `units/${unit.parentUnitId}/name`,
            op!.units.find((u) => u.id === unit.parentUnitId)?.name ?? "",
          );
      }
    }
  }
  return deps;
}
