import { reviewImpactsV2 } from "./review-impact-v2";
import type {
  ChangeImpact,
  ChangeRecord,
  Hash,
  ResolvedEndpoint,
} from "../domain/diff/model";
import { canonicalValue } from "../domain/diff/model";
import type { Dependency, ExportRecord, Operation } from "../domain/model";
import { createExportProfile } from "../domain/factories";
import { projectV5 } from "../export/projections/v5";
import { exportStaleness, projectVersion } from "../export/projection";
import type { GraphicExportRecord } from "../domain/graphic-exports";
import {
  projectGraphicV2,
  graphicDependencyChanges,
} from "../export/graphic-projection-v2";

const differences = (a: Dependency[], b: Dependency[]) => {
  const x = new Map(a.map((d) => [d.path, d.canonicalValue])),
    y = new Map(b.map((d) => [d.path, d.canonicalValue]));
  return [...new Set([...x.keys(), ...y.keys()])]
    .filter((p) => x.get(p) !== y.get(p))
    .sort();
};
type Unit = Operation["units"][number];
function graphicMatches(
  c: ChangeRecord,
  path: string,
  beforeUnits: Map<string, Unit>,
  afterUnits: Map<string, Unit>,
): boolean {
  if (!path.startsWith("graphics/")) return false;
  if (c.category === "PROVENANCE") return false;
  if (c.fieldPath === "units/presentationOrder")
    return path.endsWith("/node-order") || path.endsWith("/membership");
  if (c.m6Kind === "ORBAT_LAYOUT")
    return path.endsWith(c.fieldPath.replace("orbatLayout/", "layout/"));
  if (c.entityType === "module")
    return c.m6Kind === "PRODUCT_PRESENTATION"
      ? path === `graphics/${c.entityId}/presentation`
      : ["ADDED", "REMOVED"].includes(c.changeType) &&
          path.startsWith(`graphics/${c.entityId}/`);
  if (c.entityType !== "unit") return false;
  if (path.endsWith("/membership"))
    return (
      ["ADDED", "REMOVED"].includes(c.changeType) ||
      c.fieldPath.endsWith("inTaskOrganization")
    );
  const prefix = `units/${c.entityId}/`;
  if (!path.includes(prefix)) return false;
  if (c.m6Kind === "SYMBOL_BASE" || c.m6Kind === "SYMBOL_OVERRIDE") {
    if (!path.includes(`${prefix}symbol/`) || path.includes("/labels/"))
      return false;
    const before = beforeUnits.get(c.entityId)?.symbol,
      after = afterUnits.get(c.entityId)?.symbol;
    if (c.m6Kind === "SYMBOL_BASE" && before?.override && after?.override)
      return false;
    const parts = path.split(`${prefix}symbol/`)[1].split("/");
    if (
      parts[0] === "amplifiers" &&
      parts[1] === "uniqueDesignation" &&
      before?.labels.uniqueDesignation.kind !== "DEFINITION" &&
      after?.labels.uniqueDesignation.kind !== "DEFINITION"
    )
      return false;
    const at = (value: unknown) =>
      parts.reduce<unknown>(
        (v, k) =>
          v && typeof v === "object"
            ? (v as Record<string, unknown>)[k]
            : undefined,
        value,
      );
    return (
      canonicalValue(at(c.beforeValue)) !== canonicalValue(at(c.afterValue))
    );
  }
  if (c.m6Kind === "SYMBOL_BINDING")
    return (
      c.fieldPath.endsWith("/uniqueDesignation") &&
      (path.endsWith(`${prefix}symbol/labels/uniqueDesignation`) ||
        path.endsWith(`${prefix}symbol/amplifiers/uniqueDesignation`) ||
        path.endsWith(`${prefix}name`) ||
        path.endsWith(`${prefix}labelParent`))
    );
  if (["ADDED", "REMOVED"].includes(c.changeType)) return true;
  return (
    path.endsWith(c.fieldPath) ||
    (c.fieldPath.endsWith("parentUnitId") &&
      path.endsWith(`${prefix}labelParent`))
  );
}
export function reviewImpactsV3(
  a: ResolvedEndpoint,
  b: ResolvedEndpoint,
  changes: ChangeRecord[],
  exports: ExportRecord[],
  hash: Hash,
  graphics: GraphicExportRecord[] = [],
): ChangeImpact[] {
  const beforeUnits = new Map(a.operation.units.map((u) => [u.id, u])),
    afterUnits = new Map(b.operation.units.map((u) => [u.id, u]));
  const matches = (c: ChangeRecord, p: string) =>
    graphicMatches(c, p, beforeUnits, afterUnits);
  // Existing staff, canonical references, historical exports and non-graphic products
  // keep the v2 evaluator. Its code and renderer dispatch remain unchanged.
  const result = reviewImpactsV2(a, b, changes, exports, hash);
  for (const record of exports.filter((e) => e.projectionVersion === 5)) {
    let paths: string[];
    try {
      paths = differences(
        projectVersion(5, a.operation, record.profile, record.config)
          .dependencies,
        projectVersion(5, b.operation, record.profile, record.config)
          .dependencies,
      );
    } catch {
      paths = ["selection/unresolved-reference"];
    }
    const oldIndex = result.findIndex(
      (i) => i.kind === "EXPORT" && i.targetId === record.id,
    );
    const old = oldIndex < 0 ? null : result[oldIndex];
    const contributing = changes.filter(
      (c) =>
        old?.changeIds.includes(c.changeId) ||
        paths.some((p) => matches(c, p)) ||
        (paths.includes("selection/unresolved-reference") &&
          ["REMOVED", "RELINKED"].includes(c.changeType)),
    );
    if (!contributing.length) continue;
    if (oldIndex >= 0) result.splice(oldIndex, 1);
    const before = exportStaleness(record, a.operation),
      after = exportStaleness(record, b.operation);
    result.push({
      id: hash(
        `impact-v3:export:${record.id}:${canonicalValue(paths)}:${contributing.map((c) => c.changeId)}`,
      ),
      changeIds: contributing.map((c) => c.changeId),
      kind: "EXPORT",
      targetId: record.id,
      productId: null,
      label: record.profile.name,
      reason:
        "The retained v5 profile consumes changed source fields. Stored SVG and HTML remain immutable.",
      chain: [
        contributing[0].humanSummary.slice(0, 500),
        "Recorded v5 field dependencies",
        record.profile.name,
      ],
      beforeDisplay: before.outdated
        ? "Outdated at baseline"
        : "Current at baseline",
      afterDisplay: after.outdated ? "Outdated at target" : "Current at target",
      dependencyPaths: paths,
      baselineOutdated: before.outdated,
      targetOutdated: after.outdated,
      compatibility: paths.includes("selection/unresolved-reference")
        ? "unresolved"
        : "supported",
    });
  }
  const project = (e: ResolvedEndpoint) =>
    projectV5(
      e.operation,
      createExportProfile(
        e.operation,
        "opord",
        "50000000-0000-4000-8000-000000000001",
      ),
      e.config,
    );
  const x = project(a),
    y = project(b);
  const blocks = new Map(
    [...x.view.sections, ...y.view.sections].flatMap((s) =>
      s.graphic ? [[s.graphic.blockId, s.graphic] as const] : [],
    ),
  );
  for (const [id, block] of blocks) {
    const ancestors = new Set<string>([block.productId]);
    for (const op of [a.operation, b.operation]) {
      let parent = op.attachments.find(
        (p) => p.id === block.productId,
      )?.parentId;
      while (parent && !ancestors.has(parent)) {
        ancestors.add(parent);
        parent = op.attachments.find((p) => p.id === parent)?.parentId;
      }
    }
    const prefix = `graphics/${id}/`;
    const paths = differences(
      x.dependencies.filter((d) => d.path.startsWith(prefix)),
      y.dependencies.filter((d) => d.path.startsWith(prefix)),
    );
    const before =
        x.view.sections.find((s) => s.graphic?.blockId === id)?.graphic ?? null,
      after =
        y.view.sections.find((s) => s.graphic?.blockId === id)?.graphic ?? null;
    if (!paths.length && canonicalValue(before) === canonicalValue(after))
      continue;
    const contributing = changes.filter(
      (c) =>
        paths.some((p) => matches(c, p)) ||
        ((before === null || after === null) &&
          (c.entityId === id ||
            c.productId === block.productId ||
            (c.category === "PRODUCT_APPLICABILITY" &&
              ancestors.has(c.productId ?? c.entityId)))),
    );
    if (!contributing.length) continue;
    for (const [kind, targetId] of [
      ["MODULE", id],
      ["PRODUCT", block.productId],
      ...(block.productId !== a.operation.orderId
        ? [["PRODUCT", a.operation.orderId] as const]
        : []),
    ] as const) {
      result.push({
        id: hash(
          `impact-v3:${kind}:${id}:${canonicalValue(paths)}:${contributing.map((c) => c.changeId)}`,
        ),
        changeIds: contributing.map((c) => c.changeId),
        kind,
        targetId,
        productId: block.productId,
        label:
          kind === "MODULE"
            ? "Graphical Task Organization"
            : "Order product with graphical Task Organization",
        reason:
          "Selected canonical unit fields or presentation settings change this derived diagram.",
        chain: [
          contributing[0].humanSummary.slice(0, 500),
          "Graphical Task Organization",
          kind === "MODULE"
            ? "Read-only module preview"
            : "Current planning package",
        ],
        beforeDisplay: before
          ? `Graphical input SHA-256 ${hash(canonicalValue(before))}`
          : "Diagram absent from package",
        afterDisplay: after
          ? `Graphical input SHA-256 ${hash(canonicalValue(after))}`
          : "Diagram absent from package",
        dependencyPaths: paths,
        baselineOutdated: null,
        targetOutdated: null,
        compatibility: "supported",
      });
    }
  }
  for (const record of graphics) {
    if (record.schemaVersion !== 2 || record.source.kind !== "OPERATION")
      continue;
    let paths: string[],
      baselineOutdated: boolean | null = null,
      targetOutdated: boolean | null = null;
    try {
      const before = projectGraphicV2(
        record.source,
        record.profile,
        a.operation,
      ).dependencies;
      const after = projectGraphicV2(
        record.source,
        record.profile,
        b.operation,
      ).dependencies;
      paths = graphicDependencyChanges(before, after);
      baselineOutdated =
        graphicDependencyChanges(record.dependencies, before).length > 0;
      targetOutdated =
        graphicDependencyChanges(record.dependencies, after).length > 0;
    } catch {
      paths = ["selection/unresolved-reference"];
    }
    const contributing = changes.filter(
      (c) =>
        paths.some((p) =>
          matches(c, p.replace(/^orbat\//, "graphics/standalone/")),
        ) ||
        (paths.includes("selection/unresolved-reference") &&
          c.entityType === "unit" &&
          ["REMOVED", "RELINKED"].includes(c.changeType)),
    );
    if (!contributing.length) continue;
    result.push({
      id: hash(
        `impact-v3:graphic:${record.id}:${canonicalValue(paths)}:${contributing.map((c) => c.changeId)}`,
      ),
      changeIds: contributing.map((c) => c.changeId),
      kind: "EXPORT",
      targetId: record.id,
      productId: null,
      label: record.profile.name,
      reason:
        "This standalone graphic consumes changed operation fields. Retained output bytes and its exact export profile remain immutable.",
      chain: [
        contributing[0].humanSummary.slice(0, 500),
        "Recorded standalone graphic dependencies",
        record.profile.name,
      ],
      beforeDisplay:
        baselineOutdated === null
          ? "Unresolved selection"
          : baselineOutdated
            ? "Outdated at baseline"
            : "Current at baseline",
      afterDisplay:
        targetOutdated === null
          ? "Unresolved selection"
          : targetOutdated
            ? "Outdated at target"
            : "Current at target",
      dependencyPaths: paths,
      baselineOutdated,
      targetOutdated,
      compatibility: paths.includes("selection/unresolved-reference")
        ? "unresolved"
        : "supported",
    });
  }
  return result.sort(
    (x, y) =>
      x.kind.localeCompare(y.kind) ||
      x.label.localeCompare(y.label) ||
      x.id.localeCompare(y.id),
  );
}
