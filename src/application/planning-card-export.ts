import type { Command } from "./service";
import type { Repository, Runtime } from "./ports";
import type { GraphicRenderPort } from "./render-contracts";
import type { RetainedOrderGraphic } from "../domain/order-graphics";
import { exportRecordSchema } from "../domain/model";
import { canonical } from "../export/projection";
import {
  hasPlanningBlocks,
  projectPlanningCards,
  cardDocumentCss,
} from "../export/planning-cards";
import { templateFor } from "../export/templates";
import { renderDocumentHtml } from "../export/document-layout-html";
import { fulfillOrderGraphics } from "./order-graphics";
import { newDocumentLayout } from "../domain/document-layout";
export function preparePlanningOrder(
  repo: Repository,
  rt: Runtime,
  c: Extract<Command, { type: "generate" }>,
) {
  const current = repo.getOperation(c.operationId);
  if (current.revision !== c.expectedRevision)
    throw Error("Operation changed. Reload the export preview.");
  const publication = c.publicationId
    ? repo.listPublications(current.id).find((p) => p.id === c.publicationId)
    : null;
  if (c.publicationId && !publication)
    throw Error("Publication not found in this operation");
  const source = publication?.snapshot ?? current,
    config = publication?.config ?? repo.getConfig(source),
    profile = repo.getExportProfile(c.profileRef.id, c.profileRef.version);
  if (profile.operationId !== source.id)
    throw Error("Export profile belongs to another operation");
  if (!hasPlanningBlocks(source) || profile.product !== "opord") return null;
  const projected = projectPlanningCards(source, profile, config),
    ref = templateFor(profile.product),
    template = repo.getRenderTemplate(ref.id, ref.version),
    hash = (text: string) => repo.hashBinary(new TextEncoder().encode(text));
  return {
    ...projected,
    projectionVersion: 6,
    hash,
    retain(graphics: RetainedOrderGraphic[]) {
      if (
        repo.getOperation(current.id).revision !== c.expectedRevision ||
        canonical(repo.getOperation(source.id, source.revision)) !==
          canonical(source)
      )
        throw Error("Operation changed during export. Reload the preview.");
      const at = rt.now(),
        provenance = `${publication ? publication.orderNumber + " v" + publication.version : "Planning state"} · operation revision ${source.revision} · generated ${at} · projection v6 · renderer html-v7`;
      const assets = Object.fromEntries(
        [
          ...(source.metadata.documentLayout?.header.logo
            ? [source.metadata.documentLayout.header.logo]
            : []),
          ...(source.modules?.assets ?? []),
          ...(config.doctrine.modules?.assets ?? []),
        ]
          .filter((a) => a.mimeType.startsWith("image/"))
          .map((a) => [a.assetId, repo.assetData(a.assetId)]),
      );
      const html = renderDocumentHtml(
        projected.view,
        provenance,
        template,
        assets,
        graphics.map((g) => ({ blockId: g.request.blockId, svg: g.svg })),
        source.metadata.documentLayout ?? newDocumentLayout(),
      ).replace("</head>", cardDocumentCss + "</head>");
      repo.insertExport(
        exportRecordSchema.parse({
          schemaVersion: 7,
          rendererVersion: "html-v7",
          projectionVersion: 6,
          ...(source.metadata.documentLayout
            ? { documentLayout: source.metadata.documentLayout }
            : {}),
          renderTemplateId: template.id,
          renderTemplateVersion: template.version,
          id: rt.id(),
          operationId: source.id,
          sourceRevision: source.revision,
          sourcePublicationId: publication?.id ?? null,
          profile,
          config,
          generatedAt: at,
          actor: rt.actor,
          dependencies: projected.dependencies,
          graphics,
          html,
          htmlHash: hash(html),
        }),
      );
    },
  };
}
export async function generatePlanningOrder(
  repo: Repository,
  rt: Runtime,
  c: Extract<Command, { type: "generate" }>,
  renderer: GraphicRenderPort,
) {
  const prepared = preparePlanningOrder(repo, rt, c);
  if (!prepared) return false;
  const graphics = await fulfillOrderGraphics(
    prepared.view,
    renderer,
    prepared.hash,
  );
  repo.transaction(() => prepared.retain(graphics));
  return true;
}
