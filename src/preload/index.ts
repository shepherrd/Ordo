import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi } from "../application/bridge";
const api: DesktopApi = {
  search: (request) => ipcRenderer.invoke("ordo:search", request),
  searchUsage: (request) => ipcRenderer.invoke("ordo:search-usage", request),
  resolveSearch: (request) =>
    ipcRenderer.invoke("ordo:resolve-search", request),
  organizations: (command) => ipcRenderer.invoke("ordo:organizations", command),
  deleteItem: (target) => ipcRenderer.invoke("ordo:delete-item", target),
  recovery: (command) => ipcRenderer.invoke("ordo:recovery", command),
  graphicImage: (id) => ipcRenderer.invoke("ordo:graphic-image", id),
  office: (command) => ipcRenderer.invoke("ordo:office", command),
  whiteboards: (command) => ipcRenderer.invoke("ordo:whiteboards", command),
  documents: (command) => ipcRenderer.invoke("ordo:documents", command),
  workspaceInfo: () => ipcRenderer.invoke("ordo:workspace-info"),
  previewLibraryImport: (id, policy, token, droppedFile) =>
    ipcRenderer.invoke(
      "ordo:preview-library-import",
      id,
      policy,
      token,
      droppedFile,
    ),
  cancelLibraryImport: (id, token) =>
    ipcRenderer.invoke("ordo:cancel-library-import", id, token),
  commitLibraryImport: (token, ack) =>
    ipcRenderer.invoke("ordo:commit-library-import", token, ack),
  libraryImportReceipt: (id) =>
    ipcRenderer.invoke("ordo:library-import-receipt", id),
  symbols: (command) => ipcRenderer.invoke("ordo:symbols", command),
  symbolCatalog: (command) =>
    ipcRenderer.invoke("ordo:symbol-catalog", command),
  renderGraphic: (id, request) =>
    ipcRenderer.invoke("ordo:render-graphic", id, request),
  cancelGraphic: (id) => ipcRenderer.invoke("ordo:cancel-graphic", id),
  exportGraphic: (command) =>
    ipcRenderer.invoke("ordo:export-graphic", command),
  graphicExports: () => ipcRenderer.invoke("ordo:graphic-exports"),
  graphicStaleness: (id: string) =>
    ipcRenderer.invoke("ordo:graphic-staleness", id),
  saveGraphic: (id, copy) => ipcRenderer.invoke("ordo:save-graphic", id, copy),
  copySidc: (code) => ipcRenderer.invoke("ordo:copy-sidc", code),
  workspace: (command) => ipcRenderer.invoke("ordo:workspace", command),
  reviews: (command) => ipcRenderer.invoke("ordo:reviews", command),
  saveReviewReport: (id) => ipcRenderer.invoke("ordo:save-review-report", id),
  files: (command) => ipcRenderer.invoke("ordo:files", command),
  execute: (command) => ipcRenderer.invoke("ordo:execute", command),
  backup: () => ipcRenderer.invoke("ordo:backup"),
  restore: () => ipcRenderer.invoke("ordo:restore"),
  saveHtml: (exportId, operationId) =>
    ipcRenderer.invoke("ordo:save-html", exportId, operationId),
};
contextBridge.exposeInMainWorld("ordo", api);
