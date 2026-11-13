import { dialog, type BrowserWindow } from "electron";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileCommandSchema, type FileResult } from "../application/files";
import type { SqliteRepository } from "../persistence/repository";
import { hashBytes } from "../persistence/modular-store";
import type { OrdoService } from "../application/service";
import type { CatalogService } from "../application/catalog-service";
import type { CatalogWorkspace } from "../application/catalog-workspace";
import type { ManagedAsset } from "../domain/modules";
export async function handleFileCommand(
  input: unknown,
  repo: SqliteRepository,
  service: OrdoService,
  win: BrowserWindow,
  databasePath: string,
  catalog?: CatalogService,
  catalogs?: CatalogWorkspace,
): Promise<FileResult | null> {
  const c = fileCommandSchema.parse(input);
  const save = async (
    title: string,
    name: string,
    bytes: Buffer | string,
    extensions: string[],
  ) => {
    const out = await dialog.showSaveDialog(win, {
      title,
      defaultPath: name,
      filters: [{ name: "Ordo data", extensions }],
    });
    if (out.canceled || !out.filePath) return null;
    if (
      resolve(out.filePath).toLowerCase() ===
        resolve(databasePath).toLowerCase() ||
      /ordo\.db-(wal|shm)$/i.test(out.filePath)
    )
      throw Error("Cannot overwrite the active workspace");
    writeFileSync(out.filePath, bytes);
    return { path: out.filePath };
  };
  if (c.type === "asset-preview") return { data: repo.assetData(c.assetId) };
  if (c.type === "asset-save") {
    const { metadata, bytes } = repo.modular.readAsset(c.assetId);
    return save(
      "Save managed attachment (data only)",
      metadata.originalFilename,
      bytes,
      [extname(metadata.originalFilename).slice(1) || "bin"],
    );
  }
  if (c.type === "doctrine-export")
    return save(
      "Export doctrine package",
      "doctrine.ordo-doctrine",
      JSON.stringify(
        repo.exportDoctrinePackage(catalog ? catalog.snapshot(c.id) : c.id),
      ),
      ["ordo-doctrine"],
    );
  if (c.type === "doctrine-import") {
    const chosen = await dialog.showOpenDialog(win, {
      title: "Import doctrine package",
      properties: ["openFile"],
      filters: [{ name: "Ordo doctrine", extensions: ["ordo-doctrine"] }],
    });
    if (chosen.canceled) return null;
    if (statSync(chosen.filePaths[0]).size > 64 * 1024 * 1024)
      throw Error("Doctrine package exceeds 64 MiB");
    const v = repo.importDoctrinePackage(
      JSON.parse(readFileSync(chosen.filePaths[0], "utf8")),
    );
    catalog?.importLegacy();
    return {
      state: catalogs ? catalogs.state(service.load()) : service.load(),
      doctrineId: v.doctrineVersionId,
    };
  }
  if (catalog && c.owner.kind !== "operation") {
    const item = catalog.store.catalogGet(c.owner.id).item;
    if (
      item.kind !== (c.owner.kind === "doctrine" ? "DOCTRINE" : "ORGANIZATION")
    )
      throw Error("Invalid attachment owner.");
    c.owner.id = catalog.assetOwner(c.owner.id);
  }
  if (c.owner.kind === "operation") repo.getOperation(c.owner.id);
  else if (c.owner.kind === "unit-profile") {
    if (repo.getUnitProfile(c.owner.id).status !== "DRAFT")
      throw Error("Organization assets require a Draft profile version");
  } else if (
    !repo
      .listDoctrines()
      .some(
        (v) =>
          v.doctrineVersionId === c.owner.id &&
          v.status === "DRAFT" &&
          v.sourceKind !== "BUNDLED",
      )
  )
    throw Error("Doctrine assets can only be imported into a custom draft");
  const chosen = await dialog.showOpenDialog(win, {
    title: "Import managed image or file",
    properties: ["openFile"],
  });
  if (chosen.canceled) return null;
  const path = chosen.filePaths[0];
  if (statSync(path).size > 10 * 1024 * 1024)
    throw Error("Asset exceeds 10 MiB limit");
  const bytes = readFileSync(path),
    assetId = randomUUID();
  const types: Record<string, ManagedAsset["mimeType"]> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
  };
  const asset: ManagedAsset = {
    assetId,
    operationId: c.owner.kind === "operation" ? c.owner.id : null,
    doctrineVersionId: c.owner.kind === "doctrine" ? c.owner.id : null,
    ...(c.owner.kind === "unit-profile"
      ? { unitProfileVersionId: c.owner.id }
      : {}),
    originalFilename: basename(path),
    mimeType: types[extname(path).toLowerCase()] ?? "application/octet-stream",
    sizeBytes: bytes.length,
    sha256: hashBytes(bytes),
    createdAt: new Date().toISOString(),
    storageReference: `asset:${assetId}`,
  };
  repo.modular.insertAsset(asset, bytes);
  return {
    asset,
    ...(asset.mimeType.startsWith("image/")
      ? { data: repo.assetData(assetId) }
      : {}),
  };
}
