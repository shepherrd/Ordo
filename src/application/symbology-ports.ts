export type { SymbolRenderRequest } from "../domain/graphic-input";
import type {
  SavedSymbolVersion,
  SavedSymbolPin,
  RenderManifest,
} from "../domain/symbology";
import type { SavedOrbatVersion, OrbatImportReceipt } from "../domain/orbat";
import type {
  GraphicExportProfile,
  GraphicExportRecord,
} from "../domain/graphic-exports";
import type { Operation } from "../domain/model";
import type {
  ExchangeDependency,
  ExchangeImportReceipt,
} from "../domain/library-exchange";
export type SymbolLibraryKind = "SYMBOL" | "ORBAT";
export type SymbolLibraryVersion = SavedSymbolVersion | SavedOrbatVersion;
export interface LibraryQuery {
  search: string;
  status: "" | "DRAFT" | "PUBLISHED" | "RETIRED";
  offset: number;
  limit: number;
}
export interface SymbolLibrarySummary {
  familyId: string;
  versionId: string;
  name: string;
  versionLabel: string;
  status: string;
  updatedAt: string;
  contentVersion: number;
}
export interface GraphicExportSummary {
  id: string;
  sourceKind: string;
  name: string;
  format: string;
  generatedAt: string;
  byteLength: number;
  contentHash: string;
  profileId: string;
  profileVersion: number;
}
export interface SymbologyRepository {
  lookupExchangeDependency(
    kind: "SYMBOL" | "PROFILE",
    id: string,
  ): ExchangeDependency | null;
  insertExchangeImport(receipt: ExchangeImportReceipt): void;
  getExchangeImport(id: string): ExchangeImportReceipt;
  hashBinary(bytes: Uint8Array): string;
  getSymbol(id: string): SavedSymbolVersion;
  getOrbat(id: string): SavedOrbatVersion;
  libraryHash(kind: SymbolLibraryKind, id: string): string;
  saveLibrary(
    kind: SymbolLibraryKind,
    value: SymbolLibraryVersion,
    expected: number | null,
  ): void;
  retireLibrary(kind: SymbolLibraryKind, id: string, at: string): void;
  deleteLibraryDraft(kind: SymbolLibraryKind, id: string): void;
  browseLibrary(
    kind: SymbolLibraryKind,
    query: LibraryQuery,
  ): { items: SymbolLibrarySummary[]; total: number };
  resolveSymbolPin(id: string): SavedSymbolPin;
  verifySymbolPin(pin: SavedSymbolPin, allowRetired?: boolean): void;
  verifyOperationSymbology(op: Operation): void;
  getOrbatImport(
    operationId: string,
    importId: string,
  ): OrbatImportReceipt | null;
  insertOrbatImport(receipt: OrbatImportReceipt): void;
  saveGraphicProfile(profile: GraphicExportProfile): void;
  getGraphicProfile(id: string, version: number): GraphicExportProfile;
  insertGraphicExport(record: GraphicExportRecord, bytes: Uint8Array): void;
  getGraphicExport(id: string): {
    record: GraphicExportRecord;
    bytes: Uint8Array;
  };
  listGraphicExports(): GraphicExportSummary[];
  listOperationGraphicExportIds(operationId: string): string[];
}
export interface SymbolGeometry {
  size: { width: number; height: number };
  anchor: { x: number; y: number };
  octagon: { x: number; y: number };
}

export interface SymbolRenderResult {
  svg: string;
  geometry: SymbolGeometry;
  manifest: RenderManifest;
  diagnostics: string[];
  svgHash: string;
}
