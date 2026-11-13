import type { Dependency, ExportProfile, Operation } from "../domain/model";
import type { ModuleInstance } from "../domain/modules";
import { selectOperationDiagram } from "../domain/diagram";
import { newOrbatLayout } from "../domain/orbat";
import type { OrderGraphicRequest } from "../domain/order-graphics";
import { canonical } from "./projections/v1";
import { consumedOrbatInputV5 } from "./orbat-input-v5";

/** The diagram uses canonical units; no second hierarchy or library lookup. */
export function taskOrganizationGraphic(
  op: Operation,
  module: ModuleInstance,
  profile: ExportProfile,
): { request: OrderGraphicRequest; dependencies: Dependency[] } {
  const content = module.content;
  if (
    content.type !== "TASK_ORGANIZATION" ||
    !content.presentation ||
    content.presentation.mode === "TABLE"
  )
    throw Error("Module does not request graphical task organization");
  const p = content.presentation;
  const selected = op.units.filter(
    (u) =>
      u.inTaskOrganization &&
      (!profile.inclusion.audienceUnitIds.length ||
        profile.inclusion.audienceUnitIds.includes(u.id)),
  );
  const input = selectOperationDiagram(
    op,
    newOrbatLayout(() => module.moduleInstanceId),
    {
      ...p,
      selectedUnitIds: selected.map((u) => u.id),
    },
  );
  input.symbolSize = p.symbolSize;
  // Layout identity is provenance, not geometry. Use the stable product block identity.
  input.layout.layoutId = module.moduleInstanceId;
  const prefix = `graphics/${module.moduleInstanceId}`;
  const deps: Dependency[] = [
    { path: `${prefix}/presentation`, canonicalValue: canonical(p) },
    {
      path: `${prefix}/membership`,
      canonicalValue: canonical(selected.map((u) => u.id)),
    },
    ...consumedOrbatInputV5(input, prefix, op),
  ];
  return {
    request: {
      schemaVersion: 1,
      kind: "TASK_ORGANIZATION",
      blockId: module.moduleInstanceId,
      productId: module.productInstanceId,
      input,
    },
    dependencies: deps,
  };
}
