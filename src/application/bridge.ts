import type { AppState, Command } from "./service";
import type { FileCommand, FileResult } from "./files";
import type { ReviewResult } from "./document-layout-review";
import type { NarrativeReviewCommand as ReviewCommand } from "./narrative-review-service";
import type { WorkspaceCommand, WorkspaceResult } from "./workspace-service";
import type { LibraryCommand, LibraryResult } from "./symbology-service";
import type {
  GraphicRenderRequest,
  GraphicRenderResult,
} from "./render-contracts";
import type {
  SymbolCatalogCommand,
  SymbolCatalogResult,
} from "./symbol-catalog";
import type { GraphicExportCommand } from "./graphic-export-service";
import type { GraphicExportRecord } from "../domain/graphic-exports";
import type { GraphicExportSummary } from "./symbology-ports";
import type { ExchangePolicy, ExchangePreview } from "./exchange-service";
import type { ExchangeImportReceipt } from "../domain/library-exchange";
export interface DesktopApi {
  whiteboards(
    command: import("./whiteboard-service").WhiteboardCommand,
  ): Promise<import("./whiteboard-service").WhiteboardResult>;
  office(
    command: import("./office-service").OfficeCommand,
  ): Promise<import("./office-service").OfficeResult>;
  graphicImage(
    id: string,
  ): Promise<{ data: string; hash: string; label: string }>;
  searchUsage(
    request: import("../domain/search").SearchUsageRequest,
  ): Promise<import("../domain/search").SearchUsageResponse>;
  search(
    request: import("../domain/search").SearchRequest,
  ): Promise<import("../domain/search").SearchResponse>;
  resolveSearch(
    request: import("../domain/search").SearchResolve,
  ): Promise<import("../domain/search").SearchHit>;
  organizations(
    command: import("./organization-service").OrganizationCommand,
  ): Promise<import("../domain/organization-orbat").OrganizationProfile>;
  deleteItem(
    target: import("./deletion-service").DeletionTarget,
  ): Promise<import("./deletion-service").DeletionResult>;
  recovery(
    command: import("./working-drafts").RecoveryCommand,
  ): Promise<import("./working-drafts").RecoveryResult>;
  documents(
    command: import("./document-service").DocumentCommand,
  ): Promise<import("./document-service").DocumentResult>;
  workspaceInfo(): Promise<{
    appVersion: string;
    applicationPath: string;
    dataPath: string;
    databasePath: string;
  }>;
  previewLibraryImport(
    requestId: string,
    policy: ExchangePolicy,
    previousToken?: string,
    droppedFile?: { name: string; bytes: Uint8Array },
  ): Promise<ExchangePreview | null>;
  cancelLibraryImport(requestId: string, token?: string): Promise<void>;
  commitLibraryImport(
    token: string,
    acknowledgeLosses: boolean,
  ): Promise<{ receiptId: string; targets: ExchangePreview["targets"] }>;
  libraryImportReceipt(id: string): Promise<ExchangeImportReceipt>;
  symbols(command: LibraryCommand): Promise<LibraryResult>;
  symbolCatalog(command: SymbolCatalogCommand): Promise<SymbolCatalogResult>;
  renderGraphic(
    requestId: string,
    request: GraphicRenderRequest,
  ): Promise<GraphicRenderResult>;
  cancelGraphic(requestId: string): Promise<void>;
  exportGraphic(command: GraphicExportCommand): Promise<GraphicExportRecord>;
  graphicExports(): Promise<GraphicExportSummary[]>;
  graphicStaleness(
    id: string,
  ): Promise<import("./graphic-staleness").GraphicStaleness>;
  saveGraphic(id: string, clipboard: boolean): Promise<string | null>;
  copySidc(code: string): Promise<void>;
  workspace(command: WorkspaceCommand): Promise<WorkspaceResult>;
  reviews(command: ReviewCommand): Promise<ReviewResult>;
  saveReviewReport(reviewId: string): Promise<string | null>;
  files(command: FileCommand): Promise<FileResult | null>;
  execute(command: Command): Promise<AppState>;
  backup(): Promise<string | null>;
  restore(): Promise<AppState | null>;
  saveHtml(exportId: string, operationId: string): Promise<string | null>;
}
