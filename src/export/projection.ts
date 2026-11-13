import type {
  ExportRecord,
  Operation,
  ExportProfile,
  ResolvedConfig,
} from "../domain/model";
import { project as projectV1 } from "./projections/v1";
import { projectV2 } from "./projections/v2";
import { projectV3 } from "./projections/v3";
import { projectV4 } from "./projections/v4";
import { projectV5 } from "./projections/v5";
export { canonical } from "./projections/v1";
export type { ProductView } from "./projections/v1";
export const currentProjectionVersion = 5;
// Kept unchanged for historical impact engines. New callers use selectedProjectionVersion.
export const projectionVersionFor = (op: Operation) =>
  op.modules ? 4 : op.schemaVersion === 2 ? 3 : 2;
export const projectAuthoring = (
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  nodeId?: string,
) =>
  op.modules
    ? projectV4(op, profile, config, nodeId)
    : projectV3(op, profile, config, nodeId);
const projections: Readonly<Record<number, typeof projectV1>> = {
  1: projectV1,
  2: projectV2,
  3: projectV3,
  4: projectV4,
  5: projectV5,
};
export function selectedProjectionVersion(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  nodeId?: string,
): number {
  if (
    profile.product === "communications-card" ||
    !op.modules?.instances.some(
      (m) =>
        m.layoutState === "ACTIVE" &&
        m.content.type === "TASK_ORGANIZATION" &&
        m.content.presentation &&
        m.content.presentation.mode !== "TABLE",
    )
  )
    return projectionVersionFor(op);
  return projectV5(op, profile, config, nodeId).view.sections.some(
    (s) => s.graphic,
  )
    ? 5
    : projectionVersionFor(op);
}
export function projectCurrentAuthoring(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  nodeId?: string,
) {
  return selectedProjectionVersion(op, profile, config, nodeId) === 5
    ? projectV5(op, profile, config, nodeId)
    : projectAuthoring(op, profile, config, nodeId);
}
export function supportsProjection(version: number): boolean {
  return !!projections[version];
}
/** For a new explicit request. Historical artifacts use projectVersion directly. */
export function projectRequestedVersion(
  version: number,
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
) {
  if (version < 5 && selectedProjectionVersion(op, profile, config) === 5)
    throw Error(
      `Projection v${version} does not support graphical Task Organization`,
    );
  return projectVersion(version, op, profile, config);
}
export function projectVersion(
  version: number,
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
) {
  const implementation = projections[version];
  if (!implementation) throw Error(`Unsupported projection version ${version}`);
  return implementation(op, profile, config);
}
export function project(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
) {
  return selectedProjectionVersion(op, profile, config) === 5
    ? projectV5(op, profile, config)
    : projectVersion(projectionVersionFor(op), op, profile, config);
}
export function exportStaleness(
  record: Pick<
    ExportRecord,
    "operationId" | "projectionVersion" | "profile" | "config" | "dependencies"
  > & { rendererVersion?: string; renderTemplateVersion?: number },
  current: Operation,
): {
  outdated: boolean | null;
  changedPaths: string[];
  compatibility: "supported" | "unsupported-projection";
} {
  if (record.operationId !== current.id)
    throw Error("Wrong operation for staleness comparison");
  if (!supportsProjection(record.projectionVersion))
    return {
      outdated: null,
      changedPaths: [],
      compatibility: "unsupported-projection",
    };
  try {
    // Retain the artifact's original selection/dependency semantics. Renderer
    // and template changes are presentation changes, not operational edits.
    const now = projectVersion(
      record.projectionVersion,
      current,
      record.profile,
      record.config,
    ).dependencies;
    const previous = new Map(
      record.dependencies.map((d) => [d.path, d.canonicalValue]),
    );
    const next = new Map(now.map((d) => [d.path, d.canonicalValue]));
    const changedPaths = [
      ...new Set([...previous.keys(), ...next.keys()]),
    ].filter((path) => previous.get(path) !== next.get(path));
    return {
      outdated: changedPaths.length > 0,
      changedPaths,
      compatibility: "supported",
    };
  } catch {
    return {
      outdated: true,
      changedPaths: ["selection/unresolved-reference"],
      compatibility: "supported",
    };
  }
}
