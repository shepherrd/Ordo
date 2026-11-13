import type {
  Operation,
  ResolvedConfig,
  ExportProfile,
  Publication,
  ExportRecord,
  Preferences,
  RevisionApproval,
  RenderTemplate,
} from "../domain/model";
export interface OperationSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  demo: boolean;
}
import type { ModularRepository } from "./modular-ports";
import type { ReviewRepository } from "./review-ports";
import type { UnitProfileRepository } from "./workspace-ports";
import type { SymbologyRepository } from "./symbology-ports";
export interface Repository
  extends
    ModularRepository,
    ReviewRepository,
    UnitProfileRepository,
    SymbologyRepository {
  transaction<T>(work: () => T): T;
  listOperations(): OperationSummary[];
  getOperation(id: string, revision?: number): Operation;
  saveOperation(
    operation: Operation,
    expectedRevision: number | null,
    actor: string,
  ): void;
  getConfig(
    operation?: Pick<
      Operation,
      "doctrineRef" | "organizationRef" | "echelonRef"
    >,
  ): ResolvedConfig;
  listConfigurations(): ResolvedConfig[];
  seedConfig(config: ResolvedConfig): void;
  saveExportProfile(profile: ExportProfile): void;
  getExportProfile(id: string, version: number): ExportProfile;
  listExportProfiles(operationId: string): ExportProfile[];
  insertApproval(approval: RevisionApproval): void;
  listApprovals(operationId: string): RevisionApproval[];
  getRenderTemplate(id: string, version: number): RenderTemplate;
  insertPublication(publication: Publication): void;
  listPublications(operationId: string): Publication[];
  insertExport(record: ExportRecord): void;
  listExports(operationId: string): ExportRecord[];
  cardOrigins?(op: Operation): Record<string, string>;
  preferences(value?: Preferences): Preferences;
}
export interface Runtime {
  id(): string;
  now(): string;
  actor: string;
}
