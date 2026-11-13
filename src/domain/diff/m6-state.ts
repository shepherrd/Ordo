import type { Operation } from "../model";
import type { ResolvedEndpoint } from "./model";
export function hasM6State(op: Operation): boolean {
  return (
    !!op.orbatLayout ||
    op.units.some((u) => !!u.symbol || !!u.sourceOrbat) ||
    !!op.modules?.instances.some(
      (m) => m.content.type === "TASK_ORGANIZATION" && !!m.content.presentation,
    )
  );
}
/** Only M6 extensions are removed. M5 staff and Unit Profile semantics remain. */
export function withoutM6(e: ResolvedEndpoint): ResolvedEndpoint {
  const operation = structuredClone(e.operation);
  delete operation.orbatLayout;
  for (const unit of operation.units) {
    delete unit.symbol;
    delete unit.sourceOrbat;
  }
  for (const module of operation.modules?.instances ?? [])
    if (module.content.type === "TASK_ORGANIZATION")
      delete module.content.presentation;
  return { ...e, operation };
}
