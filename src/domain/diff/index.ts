import { diffV1 } from "./v1";
import { diffV2 } from "./v2";
import { diffV3 } from "./v3";
import { hasM6State } from "./m6-state";
import type { Hash, ResolvedEndpoint } from "./model";
export const diffEngineVersion = "diff-engine-v1" as const;
export function semanticDiff(
  version: string,
  baseline: ResolvedEndpoint,
  target: ResolvedEndpoint,
  hash: Hash,
) {
  if (version === "diff-engine-v3") return diffV3(baseline, target, hash);
  if ([baseline.operation, target.operation].some(hasM6State))
    throw Error("Symbol and ORBAT comparisons require diff-engine-v3");
  if (version === "diff-engine-v2") return diffV2(baseline, target, hash);
  if (
    [baseline.operation, target.operation].some(
      (o) =>
        o.operationOrganizationBinding ||
        o.staffPositionOverrides?.length ||
        o.units.some((u) => u.sourceUnitProfile || u.profileIdentity),
    )
  )
    throw Error("Organization-aware comparisons require diff-engine-v2");
  if (version !== diffEngineVersion)
    throw Error(`Unsupported diff engine: ${version}`);
  return diffV1(baseline, target, hash);
}
