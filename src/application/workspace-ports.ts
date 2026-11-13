import type { UnitProfile } from "../domain/unit-profiles";
import type { Operation, Preferences } from "../domain/model";
export interface BrowseQuery {
  search: string;
  status: string;
  echelon: string;
  sort: "updated" | "name";
  offset: number;
  limit: number;
}
export interface UnitProfileSummary {
  insigniaAssetId?: string | null;
  unitProfileFamilyId: string;
  unitProfileVersionId: string;
  name: string;
  shortDesignation: string;
  echelon: string;
  unitType: string;
  versionLabel: string;
  status: string;
  updatedAt: string;
  parentNames: string;
  defaultDoctrineName: string | null;
}
export interface DoctrineSummary {
  id: string;
  familyId: string;
  name: string;
  versionLabel: string;
  profileVersion: number;
  status: string;
  sourceKind: string;
  configuration: { id: string; version: number };
  staff: { id: string; name: string }[];
}
export interface GlobalOperationSummary {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  status: string;
  organization: string | null;
  doctrine: string;
  publicationCount: number;
  openReviews: number;
  demo: boolean;
}
export interface SummaryPage<T> {
  items: T[];
  total: number;
}
export interface DashboardSummary {
  recentOperations: GlobalOperationSummary[];
  draftOperations: GlobalOperationSummary[];
  publications: {
    id: string;
    operationId: string;
    name: string;
    version: number;
    publishedAt: string;
  }[];
  reviews: {
    id: string;
    operationId: string;
    title: string;
    createdAt: string;
  }[];
  organizations: UnitProfileSummary[];
  doctrines: Omit<DoctrineSummary, "staff">[];
  preferences: Preferences;
}
export interface UnitProfileRepository {
  getUnitProfile(id: string): UnitProfile;
  unitProfileHash(id: string): string;
  saveUnitProfile(v: UnitProfile, expected: number | null): void;
  retireUnitProfile(id: string, at: string): void;
  copyUnitProfileAsset(
    source: UnitProfile,
    target: UnitProfile,
    id: () => string,
    now: string,
  ): void;
  verifyOperationOrganization(op: Operation): void;
  browseUnitProfiles(q: BrowseQuery): SummaryPage<UnitProfileSummary>;
  browseOperations(q: BrowseQuery): SummaryPage<GlobalOperationSummary>;
  doctrineSummaries(includeStaff?: boolean): DoctrineSummary[];
  dashboard(): DashboardSummary;
}
