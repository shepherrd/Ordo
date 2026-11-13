import type { Command } from "./service";
import type { Repository, Runtime } from "./ports";
import type { GraphicRenderPort } from "./render-contracts";
import { canonical, selectedProjectionVersion } from "../export/projection";
import { projectV5 } from "../export/projections/v5";
import { templateFor } from "../export/templates";
import { renderGraphicalHtml } from "../export/graphical-html";
import { fulfillOrderGraphics } from "./order-graphics";
import { exportRecordSchema } from "../domain/model";

/** Rendering never holds a SQLite transaction. Exact source is rechecked at commit. */
export async function generateGraphicalOrder(
  repo: Repository,
  runtime: Runtime,
  command: Extract<Command, { type: "generate" }>,
  renderer: GraphicRenderPort,
): Promise<boolean> {
  const current = repo.getOperation(command.operationId);
  if (current.revision !== command.expectedRevision)
    throw Error("Operation changed. Reload the export preview.");
  const publication = command.publicationId
    ? repo
        .listPublications(current.id)
        .find((p) => p.id === command.publicationId)
    : null;
  if (command.publicationId && !publication)
    throw Error("Publication not found in this operation");
  const source = publication?.snapshot ?? current;
  const config = publication?.config ?? repo.getConfig(source);
  const profile = repo.getExportProfile(
    command.profileRef.id,
    command.profileRef.version,
  );
  if (profile.operationId !== source.id)
    throw Error("Export profile belongs to another operation");
  if (selectedProjectionVersion(source, profile, config) !== 5) return false;
  const projected = projectV5(source, profile, config);
  const hash = (value: string) =>
    repo.hashBinary(new TextEncoder().encode(value));
  const graphics = await fulfillOrderGraphics(projected.view, renderer, hash);
  const now = runtime.now(),
    ref = templateFor(profile.product);
  const template = repo.getRenderTemplate(ref.id, ref.version);
  const assets = Object.fromEntries(
    [
      ...(source.modules?.assets ?? []),
      ...(config.doctrine.modules?.assets ?? []),
    ]
      .filter((a) => a.mimeType.startsWith("image/"))
      .map((a) => [a.assetId, repo.assetData(a.assetId)]),
  );
  const provenance = `${publication ? `${publication.productType} ${publication.orderNumber} v${publication.version}` : "Planning state"} · operation revision ${source.revision} · profile ${profile.name} v${profile.version} · generated ${now} · ${runtime.actor} · projection v5 · template ${template.id} v${template.version} · renderer html-v3`;
  const html = renderGraphicalHtml(
    projected.view,
    graphics.map((g) => ({ blockId: g.request.blockId, svg: g.svg })),
    provenance,
    template,
    assets,
  );
  const record = exportRecordSchema.parse({
    schemaVersion: 3,
    projectionVersion: 5,
    rendererVersion: "html-v3",
    renderTemplateId: template.id,
    renderTemplateVersion: template.version,
    id: runtime.id(),
    operationId: source.id,
    sourceRevision: source.revision,
    sourcePublicationId: publication?.id ?? null,
    profile,
    config,
    generatedAt: now,
    actor: runtime.actor,
    dependencies: projected.dependencies,
    graphics,
    html,
    htmlHash: hash(html),
  });
  repo.transaction(() => {
    if (
      repo.getOperation(current.id).revision !== command.expectedRevision ||
      canonical(repo.getOperation(source.id, source.revision)) !==
        canonical(source)
    )
      throw Error(
        "Operation changed during rendering. Reload the export preview.",
      );
    repo.insertExport(record);
  });
  return true;
}
