import type { Command } from "./service";
import type { Repository, Runtime } from "./ports";
import type { GraphicRenderPort } from "./render-contracts";
import { hasRichNarrative } from "../domain/narrative";
import {
  canonical,
  project,
  selectedProjectionVersion,
} from "../export/projection";
import { templateFor } from "../export/templates";
import { renderNarrativeHtml } from "../export/narrative-html";
import { fulfillOrderGraphics } from "./order-graphics";
import { exportRecordSchema } from "../domain/model";
export async function generateNarrativeOrder(
  repo: Repository,
  rt: Runtime,
  c: Extract<Command, { type: "generate" }>,
  renderer: GraphicRenderPort,
): Promise<boolean> {
  const current = repo.getOperation(c.operationId);
  if (current.revision !== c.expectedRevision)
    throw Error("Operation changed. Reload the export preview.");
  const publication = c.publicationId
    ? repo.listPublications(current.id).find((p) => p.id === c.publicationId)
    : null;
  if (c.publicationId && !publication)
    throw Error("Publication not found in this operation");
  const source = publication?.snapshot ?? current,
    config = publication?.config ?? repo.getConfig(source);
  if (!hasRichNarrative(source) && !hasRichNarrative(config)) return false;
  const profile = repo.getExportProfile(c.profileRef.id, c.profileRef.version);
  if (profile.operationId !== source.id)
    throw Error("Export profile belongs to another operation");
  const projected = project(source, profile, config),
    projectionVersion = selectedProjectionVersion(source, profile, config);
  const hash = (s: string) => repo.hashBinary(new TextEncoder().encode(s)),
    graphics = await fulfillOrderGraphics(projected.view, renderer, hash);
  const ref = templateFor(profile.product),
    template = repo.getRenderTemplate(ref.id, ref.version),
    at = rt.now();
  const provenance = `${publication ? `${publication.productType} ${publication.orderNumber} v${publication.version}` : "Planning state"} · operation revision ${source.revision} · profile ${profile.name} v${profile.version} · generated ${at} · ${rt.actor} · projection v${projectionVersion} · template ${template.id} v${template.version} · renderer html-v4`;
  const assets = Object.fromEntries(
    [
      ...(source.modules?.assets ?? []),
      ...(config.doctrine.modules?.assets ?? []),
    ]
      .filter((a) => a.mimeType.startsWith("image/"))
      .map((a) => [a.assetId, repo.assetData(a.assetId)]),
  );
  const html = renderNarrativeHtml(
    projected.view,
    provenance,
    template,
    assets,
    graphics.map((g) => ({ blockId: g.request.blockId, svg: g.svg })),
  );
  const record = exportRecordSchema.parse({
    schemaVersion: 4,
    rendererVersion: "html-v4",
    projectionVersion,
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
  });
  repo.transaction(() => {
    if (
      repo.getOperation(current.id).revision !== c.expectedRevision ||
      canonical(repo.getOperation(source.id, source.revision)) !==
        canonical(source)
    )
      throw Error("Operation changed during export. Reload the preview.");
    repo.insertExport(record);
  });
  return true;
}
