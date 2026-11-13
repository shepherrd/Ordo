import { projectV3 } from "./v3";
import { canonical, type ProductView } from "./v1";
import type {
  Operation,
  ExportProfile,
  ResolvedConfig,
  Dependency,
} from "../../domain/model";
import { packageIncluded, productCode } from "../../domain/authoring";
import { moduleDefinition } from "../../domain/module-authoring";
import { referencedAssets } from "../../domain/modules";
import { renderModule } from "../module-render";
import { taskOrganizationGraphic } from "../task-organization-v5";
import type { OrderGraphicRequest } from "../../domain/order-graphics";
export type GraphicalView = Omit<ProductView, "sections"> & {
  sections: (ProductView["sections"][number] & {
    moduleHtml?: string;
    graphic?: OrderGraphicRequest;
  })[];
};
export function projectV5(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  previewNodeId?: string,
): { view: GraphicalView; dependencies: Dependency[] } {
  if (profile.product === "communications-card")
    return projectV3(op, profile, config);
  const base = projectV3(
    op,
    {
      ...profile,
      inclusion: {
        ...profile.inclusion,
        packageScope: "selected",
        attachmentIds: [],
      },
    },
    config,
    previewNodeId,
  );
  const view: GraphicalView = {
    ...base.view,
    sections: previewNodeId ? [] : [...base.view.sections],
  };
  const deps = base.dependencies.filter(
    (d) => d.path !== "selection/package-products",
  );
  const selected = op.attachments.filter((a) =>
    previewNodeId
      ? a.doctrineNodeId === previewNodeId
      : (op.schemaVersion === 1
          ? profile.inclusion.attachmentIds.includes(a.id)
          : packageIncluded(op, a)) &&
        (profile.inclusion.packageScope !== "selected" ||
          profile.inclusion.attachmentIds.includes(a.id)) &&
        (!profile.inclusion.audienceUnitIds.length ||
          !a.unitIds.length ||
          a.unitIds.some((id) =>
            profile.inclusion.audienceUnitIds.includes(id),
          )) &&
        (!profile.inclusion.phaseIds.length ||
          !a.phaseIds.length ||
          a.phaseIds.some((id) => profile.inclusion.phaseIds.includes(id))),
  );
  const track = (path: string, value: unknown) =>
    deps.push({ path, canonicalValue: canonical(value) });
  track(
    "selection/package-products",
    selected.map((a) => a.id),
  );
  const append = (productId: string) => {
    const modules = (op.modules?.instances ?? [])
      .filter(
        (m) => m.productInstanceId === productId && m.layoutState === "ACTIVE",
      )
      .sort(
        (a, b) =>
          a.position - b.position ||
          a.moduleInstanceId.localeCompare(b.moduleInstanceId),
      );
    track(
      `selection/modules/${productId}`,
      modules.map((m) => m.moduleInstanceId),
    );
    for (const m of modules) {
      const title = moduleDefinition(m, config)?.title ?? "Unsupported module";
      if (
        m.content.type === "TASK_ORGANIZATION" &&
        m.content.presentation &&
        m.content.presentation.mode !== "TABLE"
      ) {
        if (!moduleDefinition(m, config))
          throw Error("Missing graphical module definition");
        const graphic = taskOrganizationGraphic(op, m, profile);
        track(`modules/${m.moduleInstanceId}/graphic-definition`, {
          title,
          moduleType: "TASK_ORGANIZATION",
        });
        deps.push(...graphic.dependencies);
        view.sections.push({ title, graphic: graphic.request });
        if (m.content.presentation.mode === "BOTH") {
          view.sections.push({
            title: `${title} � unit table`,
            moduleHtml: renderModule(
              { ...m, content: { type: "TASK_ORGANIZATION" } },
              op,
              config,
              deps,
              profile,
            ),
          });
        }
      } else {
        view.sections.push({
          title,
          moduleHtml: renderModule(m, op, config, deps, profile),
        });
      }
      for (const id of referencedAssets(m.content)) {
        const asset = [
          ...(op.modules?.assets ?? []),
          ...(config.doctrine.modules?.assets ?? []),
        ].find((a) => a.assetId === id);
        if (!asset) throw Error(`Missing managed asset ${id}`);
        track(`assets/${id}`, asset);
      }
    }
  };
  if (!previewNodeId) append(op.orderId);
  for (const a of selected.sort(
    (a, b) =>
      (config.doctrine.catalog?.nodes.findIndex(
        (n) => n.id === a.doctrineNodeId,
      ) ?? 0) -
      (config.doctrine.catalog?.nodes.findIndex(
        (n) => n.id === b.doctrineNodeId,
      ) ?? 0),
  )) {
    const node = config.doctrine.catalog?.nodes.find(
      (n) => n.id === a.doctrineNodeId,
    );
    if (node) {
      const legacy = projectV3(op, profile, config, node.id);
      const hasLayout = op.modules?.instances.some(
        (m) => m.productInstanceId === a.id,
      );
      if (a.content || a.narrative || !hasLayout) {
        view.sections.push(...legacy.view.sections);
        deps.push(
          ...legacy.dependencies.filter(
            (d) => d.path !== "selection/package-products",
          ),
        );
      } else
        view.sections.push({
          title: `${node.nodeType} ${productCode(node, config)} — ${node.canonicalTitle}`,
        });
      track(`products/${a.id}/identity`, {
        id: a.id,
        name: a.name,
        code: a.code,
      });
    }
    append(a.id);
  }
  return {
    view,
    dependencies: [...new Map(deps.map((d) => [d.path, d])).values()].sort(
      (a, b) => a.path.localeCompare(b.path),
    ),
  };
}
