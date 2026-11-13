import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  clipboard,
  ClipboardItem,
} from "electron";
import { join, resolve, basename } from "node:path";
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { restoreWorkspace } from "../persistence/restore";
import { applicationVersion } from "./app-version";
import { SqliteRepository } from "../persistence/repository";
import { OrdoService } from "../application/service";
import { CatalogService } from "../application/catalog-service";
import { SearchService } from "../application/search-service";
import {
  organizationCommand,
  organizationDocument,
} from "../application/organization-service";
import { CatalogWorkspace } from "../application/catalog-workspace";
import { CatalogDeletion } from "../application/catalog-deletion";
import {
  catalogGraphicCommand,
  catalogGraphicStaleness,
} from "../application/catalog-graphics";
import { DocumentLayoutReviewService as ReviewService } from "../application/document-layout-review";
import { WorkspaceService } from "../application/workspace-service";
import { renderReviewReport } from "../export/narrative-review-report";
import { starterConfig, armyConfig } from "../config/profiles";
import { demoOperation } from "../demo/operation";
import { createTestifyExample } from "../demo/testify";
import { idSchema } from "../domain/model";
import { handleFileCommand } from "./files";
import {
  SymbologyService,
  libraryCommandSchema,
} from "../application/symbology-service";
import { DeletionService } from "../application/deletion-service";
import { confirmDeletion } from "./confirm-deletion";
import { GraphicExportService } from "../application/graphic-export-service";
import { SymbolRenderHost } from "./symbol-render-host";
import { GraphicRasterizer } from "./graphic-rasterizer";
import type { GraphicRenderRequest } from "../application/render-contracts";
import { z } from "zod";
import {
  ExchangeService,
  exchangePolicySchema,
} from "../application/exchange-service";
import { m6Limits } from "../domain/orbat";
import { WorkingDraftService } from "../application/working-drafts";
import {
  ConfiguredDocumentService as DocumentService,
  documentCommandSchema,
} from "../application/configured-document-service";
import { graphicImage } from "../application/graphic-image";
import { DocumentRenderer } from "./document-renderer";
import {
  OfficeService,
  officeCommandSchema,
} from "../application/office-service";
import { OfficeRenderer } from "./office-renderer";
import {
  WhiteboardService,
  whiteboardCommandSchema,
  binaryData,
} from "../application/whiteboard-service";
import { printDocumentHtml } from "../export/print-v2";
import { assertSafeOutput } from "./output-path";

let repo: SqliteRepository, service: OrdoService, win: BrowserWindow;
let reviews: ReviewService;
let workspace: WorkspaceService;
let catalog: CatalogService, catalogs: CatalogWorkspace;
let exchange: ExchangeService;
let recovery: WorkingDraftService;
let recoveryToken: string = randomUUID();
let searchService: SearchService;
let documents: DocumentService;
let office: OfficeService;
let whiteboards: WhiteboardService;
const documentRenderer = new DocumentRenderer();
const pendingImports = new Map<string, AbortController>();
let symbols: SymbologyService,
  graphics: GraphicExportService,
  renderHost: SymbolRenderHost | undefined;
const renderPort = {
  render: (request: GraphicRenderRequest, signal?: AbortSignal) =>
    (renderHost ??= new SymbolRenderHost()).render(request, signal),
};
const pendingGraphics = new Map<string, AbortController>();
const dataDir = process.env.ORDO_DATA_DIR
  ? resolve(process.env.ORDO_DATA_DIR)
  : join(app.getPath("userData"), "workspace");
const databasePath = join(dataDir, "ordo.db");
const assertOutputPath = (path: string) => assertSafeOutput(path, dataDir);
// An explicitly isolated workspace also isolates Chromium caches and the
// single-instance lock, so test runs cannot touch a planner's desktop profile.
if (process.env.ORDO_DATA_DIR) {
  const desktopPath = join(dataDir, "desktop-profile");
  mkdirSync(desktopPath, { recursive: true });
  app.setPath("userData", desktopPath);
}
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererPath = join(__dirname, "../renderer/index.html");
const trustedUrl = devUrl ?? pathToFileURL(rendererPath).href;
const adoptRepository = (next: SqliteRepository) => {
  repo = next;
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  const runtime = {
    id: randomUUID,
    now: () => new Date().toISOString(),
    get actor() {
      return repo.preferences().localActor ?? "Local planner";
    },
  };
  workspace = new WorkspaceService(repo, runtime);
  whiteboards = new WhiteboardService(
    repo,
    repo.whiteboards,
    runtime,
    renderPort,
    documentRenderer,
  );
  documents = new DocumentService(repo, runtime, documentRenderer);
  office = new OfficeService(
    repo,
    repo.office,
    runtime,
    new OfficeRenderer(documentRenderer),
  );
  symbols = new SymbologyService(repo, runtime);
  for (const controller of pendingImports.values()) controller.abort();
  exchange = new ExchangeService(repo, runtime, renderPort);
  graphics = new GraphicExportService(
    repo,
    runtime,
    renderPort,
    new GraphicRasterizer(),
  );
  reviews = new ReviewService(repo, {
    id: randomUUID,
    now: () => new Date().toISOString(),
    get actor() {
      return runtime.actor;
    },
  });
  service = new OrdoService(
    repo,
    {
      id: randomUUID,
      now: () => new Date().toISOString(),
      get actor() {
        return runtime.actor;
      },
    },
    (_name, config) =>
      demoOperation(config, randomUUID, new Date().toISOString()),
    () => createTestifyExample(runtime.id, runtime.now()),
  );
  catalog = new CatalogService(repo, repo.catalog, runtime, repo);
  catalog.importLegacy();
  searchService = new SearchService(repo.search, randomUUID());
  const searchRepository = repo;
  const rebuildSearch = () => {
    if (repo !== searchRepository) return;
    if (workspaceBusy) {
      setTimeout(rebuildSearch, 50);
      return;
    }
    try {
      if (!searchRepository.search.rebuildBatch()) setImmediate(rebuildSearch);
    } catch (error) {
      searchRepository.search.indexError =
        error instanceof Error ? error.message : String(error);
    }
  };
  setImmediate(rebuildSearch);
  catalogs = new CatalogWorkspace(catalog, repo, service, workspace, symbols);
  recovery = new WorkingDraftService(
    repo,
    runtime,
    recoveryToken,
    (id, kind) =>
      kind === "unit-profile"
        ? organizationDocument(catalog, id)
        : catalogs.document(
            id,
            (
              {
                symbol: "SYMBOL",
                orbat: "ORBAT",
                doctrine: "DOCTRINE",
                "unit-profile": "ORGANIZATION",
              } as const
            )[kind as "symbol" | "orbat" | "doctrine" | "unit-profile"],
          ),
  );
};
const openRepository = () =>
  adoptRepository(new SqliteRepository(databasePath));
let workspaceBusy = false;
const withWorkspaceLock = async (work: () => Promise<unknown>) => {
  if (workspaceBusy) throw Error("Workspace backup or restore is in progress");
  workspaceBusy = true;
  try {
    return await work();
  } finally {
    workspaceBusy = false;
  }
};
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(() => {
      mkdirSync(dataDir, { recursive: true });
      openRepository();
      session.defaultSession.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const allowed =
          details.url.startsWith("file:") ||
          details.url.startsWith("data:") ||
          details.url.startsWith("about:") ||
          (!!devUrl && new URL(details.url).host === new URL(devUrl).host);
        callback({ cancel: !allowed });
      });
      win = new BrowserWindow({
        width: 1500,
        height: 980,
        minWidth: 1120,
        minHeight: 720,
        show: !process.env.ORDO_HEADLESS,
        backgroundColor: "#edf1ee",
        title: "Ordo",
        webPreferences: {
          preload: join(__dirname, "../preload/index.js"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      });
      win.removeMenu();
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-prevent-unload", (event) => {
        if (workspaceBusy) {
          dialog.showMessageBoxSync(win, {
            type: "info",
            buttons: ["Keep editing"],
            message: "Workspace work is still in progress.",
            detail:
              "Wait for the current backup, restore, import, or export to finish before closing.",
          });
          return;
        }
        const choice = dialog.showMessageBoxSync(win, {
          type: "question",
          buttons: ["Keep editing", "Discard changes and close"],
          defaultId: 0,
          cancelId: 0,
          message:
            "There are unsaved planning, library, or export-profile changes.",
        });
        if (choice === 1) {
          recovery.discardSessionCopies();
          event.preventDefault();
        }
      });
      win.webContents.on("will-navigate", (event, url) => {
        if (url !== trustedUrl) event.preventDefault();
      });
      const handle = (channel: string, handler: (...args: any[]) => unknown) =>
        ipcMain.handle(channel, (event, ...args) => {
          if (
            event.sender !== win.webContents ||
            event.senderFrame !== win.webContents.mainFrame ||
            event.senderFrame.url !== trustedUrl
          )
            throw Error("Untrusted application command");
          return handler(...args);
        });
      handle("ordo:search", (request) => {
        if (workspaceBusy)
          throw Error(
            "Workspace work is in progress. Search again when it finishes.",
          );
        return searchService.query(request);
      });
      handle("ordo:search-usage", (request) => {
        if (workspaceBusy)
          throw Error(
            "Workspace work is in progress. Try again when it finishes.",
          );
        return searchService.usage(request);
      });
      handle("ordo:resolve-search", (request) => {
        if (workspaceBusy)
          throw Error(
            "Workspace work is in progress. Search again when it finishes.",
          );
        return searchService.resolve(request);
      });
      handle("ordo:execute", (command) => {
        if (command?.type === "generate")
          return withWorkspaceLock(() =>
            service
              .executeWithGraphics(command, renderPort)
              .then((state) => catalogs.state(state)),
          );
        if (workspaceBusy)
          throw Error("Workspace backup or restore is in progress");
        const result = catalogs.execute(command);
        recovery.commandSucceeded(command);
        return result;
      });
      handle("ordo:workspace", (command) => {
        if (workspaceBusy)
          throw Error("Workspace backup or restore is in progress");
        const result = catalogs.workspaceCommand(command);
        recovery.commandSucceeded(command);
        return result;
      });
      handle("ordo:organizations", (command) => {
        if (workspaceBusy)
          throw Error("Workspace backup or restore is in progress");
        const result = organizationCommand(catalog, command);
        if (command?.type === "save")
          recovery.commandSucceeded({
            type: "unit-profile-save",
            profile: command.profile,
          });
        return result;
      });
      handle("ordo:recovery", (command) => {
        if (workspaceBusy)
          throw Error("Workspace work is in progress; recovery will retry.");
        return recovery.execute(command);
      });
      handle("ordo:delete-item", (target) =>
        withWorkspaceLock(() =>
          confirmDeletion(
            new DeletionService(new CatalogDeletion(repo, repo.catalog)),
            win,
            target,
          ),
        ),
      );
      handle("ordo:workspace-info", () => ({
        appVersion: applicationVersion,
        applicationPath: app.getPath("exe"),
        dataPath: dataDir,
        databasePath,
      }));
      handle("ordo:office", (input) => {
        const c = officeCommandSchema.parse(input);
        if (workspaceBusy)
          throw Error(
            "Workspace work is in progress. Try again when it finishes.",
          );
        if (c.type === "list")
          return { records: office.list(c.operationId, c.offset, "DOCX") };
        if (c.type === "generate" && c.source.kind !== "order")
          throw Error("Only Word orders are available in this release.");
        if (c.type === "inspect") return office.inspect(c.id, "DOCX");
        return withWorkspaceLock(async () => {
          if (c.type === "generate")
            return { record: await office.generate(c) };
          const { record, bytes } = repo.office.get(c.id),
            ext = record.format.toLowerCase();
          if (record.format !== "DOCX")
            throw Error("Only Word orders are available in this release.");
          const selected = await dialog.showSaveDialog(win, {
            title: `Save ${record.format}`,
            defaultPath: record.name.replace(/[<>:"/\\|?*]/g, "-") + "." + ext,
            filters: [{ name: record.format, extensions: [ext] }],
          });
          if (selected.canceled || !selected.filePath) return { path: null };
          assertOutputPath(selected.filePath);
          writeFileSync(selected.filePath, bytes);
          return { path: selected.filePath };
        });
      });
      handle("ordo:whiteboards", (input) => {
        const c = whiteboardCommandSchema.parse(input);
        if (workspaceBusy)
          throw Error(
            "Workspace work is in progress. Try again when it finishes.",
          );
        if (c.type === "list")
          return { records: whiteboards.list(c.operationId, c.offset) };
        if (c.type === "preview")
          return {
            data: binaryData(repo.whiteboards.get(c.id).bytes, "image/png"),
          };
        return withWorkspaceLock(async () => {
          if (c.type === "generate")
            return { record: await whiteboards.generate(c) };
          if (c.type === "image") return whiteboards.image(c.id);
          const { record, bytes } = repo.whiteboards.get(c.id),
            ext = c.format.toLowerCase();
          const selected = await dialog.showSaveDialog(win, {
            title: `Save whiteboard ${c.format}`,
            defaultPath:
              record.name.replace(/[<>:"/\\|?*]/g, "-") + " - snapshot." + ext,
            filters: [{ name: c.format, extensions: [ext] }],
          });
          if (selected.canceled || !selected.filePath) return { path: null };
          assertOutputPath(selected.filePath);
          writeFileSync(
            selected.filePath,
            c.format === "SVG" ? record.svg : bytes,
          );
          return { path: selected.filePath };
        });
      });
      handle("ordo:graphic-image", (id) =>
        graphicImage(repo, idSchema.parse(id)),
      );
      handle("ordo:documents", (input) => {
        const command = documentCommandSchema.parse(input);
        if (command.type === "list")
          return { records: repo.listDocuments(command.operationId) };
        return withWorkspaceLock(async () => {
          if (command.type === "generate")
            return { record: await documents.generate(command) };
          const { record, bytes } = repo.getDocument(command.id);
          if (command.type === "print") {
            if (
              record.environment.electron !== process.versions.electron ||
              record.environment.chromium !== process.versions.chrome ||
              record.environment.fontFingerprint !==
                documentRenderer.environment().fontFingerprint
            )
              throw Error(
                "This document used an earlier print engine. Save its retained PDF and print that file, or explicitly generate a new PDF.",
              );
            const source = repo
              .listExports(record.operationId)
              .find((e) => e.id === record.sourceExportId)!;
            return {
              printed: await documentRenderer.print(
                printDocumentHtml(source, record.options),
                record.options,
              ),
            };
          }
          const selected = await dialog.showSaveDialog(win, {
            title: "Save retained PDF",
            defaultPath: `Ordo-${record.id}.pdf`,
            filters: [{ name: "PDF document", extensions: ["pdf"] }],
          });
          if (selected.canceled || !selected.filePath) return { path: null };
          assertOutputPath(selected.filePath);
          writeFileSync(selected.filePath, bytes);
          return { path: selected.filePath };
        });
      });
      handle("ordo:symbols", (command) => {
        if (workspaceBusy)
          throw Error("Workspace backup or restore is in progress");
        if (command?.type === "delete-draft") {
          const parsed = libraryCommandSchema.parse(command);
          if (parsed.type !== "delete-draft")
            throw Error("Invalid deletion command");
          return withWorkspaceLock(async () => {
            await confirmDeletion(
              new DeletionService(new CatalogDeletion(repo, repo.catalog)),
              win,
              {
                kind: parsed.kind === "SYMBOL" ? "symbol" : "orbat",
                id: parsed.id,
              },
            );
            return {};
          });
        }
        const result = catalogs.symbolCommand(command);
        recovery.commandSucceeded(command);
        return result;
      });
      handle("ordo:symbol-catalog", async (command) =>
        (await import("../rendering/symbol-catalog")).symbolCatalog(command),
      );
      handle("ordo:render-graphic", async (id, request) => {
        id = idSchema.parse(id);
        if (pendingGraphics.has(id) || pendingGraphics.size >= 8)
          throw Error(
            "Render request identity is already active or queue is full",
          );
        const controller = new AbortController();
        pendingGraphics.set(id, controller);
        try {
          return await renderPort.render(request, controller.signal);
        } finally {
          pendingGraphics.delete(id);
        }
      });
      handle("ordo:cancel-graphic", (id) =>
        pendingGraphics.get(idSchema.parse(id))?.abort(),
      );
      handle("ordo:export-graphic", (command) =>
        withWorkspaceLock(() =>
          graphics.generate(catalogGraphicCommand(command, catalog)),
        ),
      );
      handle("ordo:graphic-exports", () => repo.listGraphicExports());
      handle("ordo:graphic-staleness", (id) =>
        catalogGraphicStaleness(
          repo.getGraphicExport(idSchema.parse(id)).record,
          repo,
          catalog,
        ),
      );
      handle(
        "ordo:preview-library-import",
        async (requestId, rawPolicy, previousToken, droppedFile) => {
          const id = idSchema.parse(requestId),
            policy = exchangePolicySchema.parse(rawPolicy);
          if (pendingImports.size >= 1)
            throw Error("Another library import is being validated");
          const controller = new AbortController();
          pendingImports.set(id, controller);
          try {
            return await withWorkspaceLock(async () => {
              if (droppedFile !== undefined) {
                if (previousToken !== undefined)
                  throw Error("Choose either a new file or a prior preview");
                const source = z
                  .object({
                    name: z.string().min(1).max(255),
                    bytes: z
                      .instanceof(Uint8Array)
                      .refine(
                        (bytes) => bytes.byteLength <= m6Limits.jsonBytes,
                        "Import exceeds 10 MiB",
                      ),
                  })
                  .strict()
                  .parse(droppedFile);
                return exchange.prepare(
                  new TextDecoder("utf-8", {
                    fatal: true,
                    ignoreBOM: true,
                  }).decode(source.bytes),
                  basename(source.name),
                  policy,
                  controller.signal,
                );
              }
              if (previousToken !== undefined)
                return exchange.revise(
                  idSchema.parse(previousToken),
                  policy,
                  controller.signal,
                );
              const chosen = await dialog.showOpenDialog(win, {
                title: "Import Saved Symbols or ORBAT",
                properties: ["openFile"],
                filters: [{ name: "Ordo JSON", extensions: ["json", "txt"] }],
              });
              if (
                chosen.canceled ||
                !chosen.filePaths[0] ||
                controller.signal.aborted
              )
                return null;
              const file = await open(chosen.filePaths[0], "r");
              let bytes: Buffer;
              try {
                const stat = await file.stat();
                if (!stat.isFile() || stat.size > m6Limits.jsonBytes)
                  throw Error("Select a JSON file no larger than 10 MiB");
                // Bounded read remains bounded if the selected file grows after stat.
                const buffer = Buffer.alloc(m6Limits.jsonBytes + 1);
                let length = 0;
                while (length < buffer.length) {
                  const read = await file.read(
                    buffer,
                    length,
                    buffer.length - length,
                    null,
                  );
                  if (!read.bytesRead) break;
                  length += read.bytesRead;
                }
                if (length > m6Limits.jsonBytes)
                  throw Error("Import exceeds 10 MiB");
                bytes = buffer.subarray(0, length);
              } finally {
                await file.close();
              }
              return exchange.prepare(
                new TextDecoder("utf-8", {
                  fatal: true,
                  ignoreBOM: true,
                }).decode(bytes),
                basename(chosen.filePaths[0]),
                policy,
                controller.signal,
              );
            });
          } finally {
            pendingImports.delete(id);
          }
        },
      );
      handle("ordo:cancel-library-import", (id, token) => {
        pendingImports.get(idSchema.parse(id))?.abort();
        if (token !== undefined) exchange.cancel(idSchema.parse(token));
      });
      handle("ordo:commit-library-import", (token, ack) => {
        if (workspaceBusy) throw Error("Workspace is busy");
        const result = exchange.commit(token, ack);
        catalog.importLegacy();
        return result;
      });
      handle("ordo:library-import-receipt", (id) =>
        repo.getExchangeImport(idSchema.parse(id)),
      );
      handle("ordo:copy-sidc", (code) =>
        clipboard.writeText(
          z
            .string()
            .regex(/^(?:\d{20}|\d{30}|[A-Z0-9*\-]{12,15})$/)
            .parse(code),
        ),
      );
      handle("ordo:save-graphic", async (id, copy) => {
        const { record, bytes } = repo.getGraphicExport(idSchema.parse(id));
        z.boolean().parse(copy);
        if (copy) {
          if (record.profile.format === "PNG")
            await clipboard.write([
              new ClipboardItem({
                "image/png": new Blob([Uint8Array.from(bytes)], {
                  type: "image/png",
                }),
              }),
            ]);
          else if (record.profile.format === "SVG")
            await clipboard.write([
              new ClipboardItem({
                "text/plain": Buffer.from(bytes).toString("utf8"),
                "image/svg+xml": new Blob([Uint8Array.from(bytes)], {
                  type: "image/svg+xml",
                }),
              }),
            ]);
          else await clipboard.writeText(Buffer.from(bytes).toString("utf8"));
          return "Copied " + record.profile.format + " to clipboard";
        }
        const ext = record.profile.format.toLowerCase(),
          selection = await dialog.showSaveDialog(win, {
            title: "Save generated graphic",
            defaultPath: `Ordo-${record.id}.${ext}`,
            filters: [{ name: record.profile.format, extensions: [ext] }],
          });
        if (selection.canceled || !selection.filePath) return null;
        if (
          [databasePath, databasePath + "-wal", databasePath + "-shm"].some(
            (p) =>
              resolve(p).toLowerCase() ===
              resolve(selection.filePath!).toLowerCase(),
          )
        )
          throw Error("Cannot overwrite the active workspace");
        writeFileSync(selection.filePath, bytes);
        return selection.filePath;
      });
      handle("ordo:reviews", (command) => {
        if (workspaceBusy)
          throw Error("Workspace backup or restore is in progress");
        return reviews.execute(command);
      });
      handle("ordo:save-review-report", (id) =>
        withWorkspaceLock(async () => {
          const review = repo.getReview(idSchema.parse(id));
          const html = renderReviewReport(review);
          const selection = await dialog.showSaveDialog(win, {
            title: "Save Change Review report",
            defaultPath: `Ordo-review-${review.id}.html`,
            filters: [{ name: "HTML document", extensions: ["html"] }],
          });
          if (selection.canceled || !selection.filePath) return null;
          if (
            resolve(selection.filePath).toLowerCase() ===
              databasePath.toLowerCase() ||
            /ordo\.db-(wal|shm)$/i.test(selection.filePath)
          )
            throw Error("Cannot overwrite the active workspace");
          writeFileSync(selection.filePath, html, "utf8");
          return selection.filePath;
        }),
      );
      handle("ordo:files", (command) =>
        withWorkspaceLock(async () =>
          handleFileCommand(
            command,
            repo,
            service,
            win,
            databasePath,
            catalog,
            catalogs,
          ),
        ),
      );
      handle("ordo:backup", () =>
        withWorkspaceLock(async () => {
          const selection = await dialog.showSaveDialog(win, {
            title: "Back up Ordo workspace",
            defaultPath: `Ordo-backup-${new Date().toISOString().slice(0, 10)}.db`,
            filters: [{ name: "Ordo workspace", extensions: ["db"] }],
          });
          if (selection.canceled || !selection.filePath) return null;
          if (
            resolve(selection.filePath).toLowerCase() ===
            databasePath.toLowerCase()
          )
            throw Error("Choose a backup path outside the active database");
          await repo.backup(selection.filePath);
          return selection.filePath;
        }),
      );
      handle("ordo:restore", () =>
        withWorkspaceLock(async () => {
          const selection = await dialog.showOpenDialog(win, {
            title: "Restore Ordo workspace",
            properties: ["openFile"],
            filters: [{ name: "Ordo workspace", extensions: ["db"] }],
          });
          if (selection.canceled) return null;
          if (
            resolve(selection.filePaths[0]).toLowerCase() ===
            databasePath.toLowerCase()
          )
            throw Error("Choose a saved backup, not the active database");
          const answer = await dialog.showMessageBox(win, {
            type: "question",
            buttons: ["Cancel", "Restore workspace"],
            defaultId: 0,
            cancelId: 0,
            message: "Replace this local workspace with the selected backup?",
            detail:
              "The current workspace will be retained as a recovery backup. All operations in the selected backup will be restored.",
          });
          if (answer.response !== 1) return null;
          await restoreWorkspace(
            repo,
            databasePath,
            selection.filePaths[0],
            adoptRepository,
          );
          recoveryToken = recovery.startNewSession();
          return catalogs.state(service.load());
        }),
      );
      handle("ordo:save-html", async (exportId, operationId) => {
        const record = repo
          .listExports(idSchema.parse(operationId))
          .find((e) => e.id === idSchema.parse(exportId));
        if (!record) throw Error("Export not found");
        const selection = await dialog.showSaveDialog(win, {
          title: "Save generated product",
          defaultPath: `Ordo-${record.profile.product}-r${record.sourceRevision}.html`,
          filters: [{ name: "HTML document", extensions: ["html"] }],
        });
        if (selection.canceled || !selection.filePath) return null;
        assertOutputPath(selection.filePath);
        writeFileSync(selection.filePath, record.html, "utf8");
        return selection.filePath;
      });
      if (devUrl) win.loadURL(devUrl);
      else win.loadFile(rendererPath);
    })
    .catch((error) => {
      dialog.showErrorBox("Ordo could not start", String(error));
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    renderHost?.close();
    for (const request of pendingGraphics.values()) request.abort();
    if (repo?.sqlite.open) repo.close();
  });
}
