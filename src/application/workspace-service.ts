import { z } from "zod";
import {
  operationSchema,
  preferencesSchema,
  metadata,
  type Operation,
} from "../domain/model";
import {
  newUnitProfile,
  deriveUnitProfile,
  unitProfileSchema,
  assertStandingHierarchy,
  type UnitProfile,
  profileSymbol,
} from "../domain/unit-profiles";
import { inheritedSymbol } from "../domain/symbology";
import { assertOperation } from "../domain/invariants";
import type { Repository, Runtime } from "./ports";
import type {
  DashboardSummary,
  SummaryPage,
  GlobalOperationSummary,
  UnitProfileSummary,
  DoctrineSummary,
} from "./workspace-ports";
import type { ManagedAsset } from "../domain/modules";
const id = z.string().uuid();
export const browseQuerySchema = z
  .object({
    search: z.string().max(200),
    status: z.string().max(40),
    echelon: z.string().max(160),
    sort: z.enum(["updated", "name"]),
    offset: z.number().int().min(0).max(100000),
    limit: z.number().int().min(1).max(100),
  })
  .strict();
export const workspaceCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dashboard") }).strict(),
  z
    .object({ type: z.literal("browse-operations"), query: browseQuerySchema })
    .strict(),
  z
    .object({
      type: z.literal("browse-unit-profiles"),
      query: browseQuerySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("doctrine-summaries"),
      includeStaff: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("library"), query: browseQuerySchema }).strict(),
  z
    .object({
      type: z.literal("preferences"),
      preferences: preferencesSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("remember-operation"), operationId: id }).strict(),
  z.object({ type: z.literal("unit-profile-get"), id }).strict(),
  z
    .object({
      type: z.literal("unit-profile-new"),
      name: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({
      type: z.literal("unit-profile-save"),
      profile: unitProfileSchema,
      expectedContentVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("unit-profile-publish"),
      id,
      expectedContentVersion: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("unit-profile-retire"), id }).strict(),
  z
    .object({
      type: z.literal("unit-profile-derive"),
      id,
      versionLabel: z.string().regex(/^\d+\.\d+\.\d+$/),
      newFamily: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("unit-profile-instantiate"),
      operation: operationSchema,
      unitProfileVersionId: id,
      subtree: z.boolean(),
      confirmDuplicate: z.boolean(),
      importId: id,
    })
    .strict(),
]);
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export interface WorkspaceResult {
  dashboard?: DashboardSummary;
  operations?: SummaryPage<GlobalOperationSummary>;
  organizations?: SummaryPage<UnitProfileSummary>;
  doctrines?: DoctrineSummary[];
  assets?: SummaryPage<ManagedAsset>;
  preferences?: z.infer<typeof preferencesSchema>;
  profile?: UnitProfile;
  assignedOrbat?: { name: string; unitCount: number };
  operation?: Operation;
}
export function instantiateUnitProfile(
  repo: Repository,
  operation: Operation,
  versionId: string,
  subtree: boolean,
  confirmDuplicate: boolean,
  importId: string,
  uid: () => string,
): Operation {
  const op = structuredClone(operation),
    root = repo.getUnitProfile(versionId);
  if (root.status !== "PUBLISHED")
    throw Error("Select a published, non-retired Unit Profile");
  if (op.units.some((u) => u.sourceUnitProfile?.importId === importId))
    return op;
  assertStandingHierarchy(root, (id) => repo.getUnitProfile(id), true);
  const sources: {
    profile: UnitProfile;
    parent: number | null;
    path: string[];
  }[] = [];
  const collect = (
    profile: UnitProfile,
    parent: number | null,
    path: string[],
  ) => {
    if (sources.length >= 2000)
      throw Error("Subtree import exceeds 2,000 units");
    const index = sources.length;
    sources.push({ profile, parent, path });
    if (subtree)
      for (const r of profile.standingSubordinates)
        collect(repo.getUnitProfile(r.unitProfileVersionId), index, [
          ...path,
          r.relationshipId,
        ]);
  };
  collect(root, null, []);
  if (
    !confirmDuplicate &&
    sources.some((s) =>
      op.units.some(
        (u) =>
          u.sourceUnitProfile?.sourceUnitProfileFamilyId ===
          s.profile.unitProfileFamilyId,
      ),
    )
  )
    throw Error(
      "This profile already has an operational instance. Confirm duplicate import to create another independent instance.",
    );
  const ids = sources.map(() => uid()),
    status = repo.getConfig(op).doctrine.editingStatus;
  for (const [i, s] of sources.entries()) {
    const { fullDesignation, ...identity } = s.profile.identity;
    op.units.push({
      id: ids[i],
      name: fullDesignation,
      metadata: metadata(status),
      inTaskOrganization: true,
      parentUnitId: s.parent === null ? null : ids[s.parent],
      profileIdentity: structuredClone(identity),
      ...(profileSymbol(s.profile)
        ? { symbol: inheritedSymbol(profileSymbol(s.profile)!) }
        : {}),
      sourceUnitProfile: {
        sourceUnitProfileFamilyId: s.profile.unitProfileFamilyId,
        sourceUnitProfileVersionId: s.profile.unitProfileVersionId,
        sourceContentHash: repo.unitProfileHash(s.profile.unitProfileVersionId),
        importId,
        sourceRelationshipPath: s.path,
      },
    });
  }
  return assertOperation(op, repo.getConfig(op));
}
export class WorkspaceService {
  constructor(
    private repo: Repository,
    private runtime: Runtime,
  ) {}
  execute(input: unknown): WorkspaceResult {
    const c = workspaceCommandSchema.parse(input);
    if (c.type === "dashboard") return { dashboard: this.repo.dashboard() };
    if (c.type === "browse-operations")
      return { operations: this.repo.browseOperations(c.query) };
    if (c.type === "browse-unit-profiles")
      return { organizations: this.repo.browseUnitProfiles(c.query) };
    if (c.type === "doctrine-summaries")
      return { doctrines: this.repo.doctrineSummaries(c.includeStaff) };
    if (c.type === "library") {
      const all = this.repo
        .listAssets()
        .filter((a) =>
          a.originalFilename
            .toLowerCase()
            .includes(c.query.search.toLowerCase()),
        )
        .sort((a, b) =>
          c.query.sort === "name"
            ? a.originalFilename.localeCompare(b.originalFilename)
            : b.createdAt.localeCompare(a.createdAt),
        );
      return {
        assets: {
          items: all.slice(c.query.offset, c.query.offset + c.query.limit),
          total: all.length,
        },
      };
    }
    if (c.type === "preferences")
      return { preferences: this.repo.preferences(c.preferences) };
    if (c.type === "remember-operation") {
      this.repo.getOperation(c.operationId);
      return {
        preferences: this.repo.preferences({
          ...this.repo.preferences(),
          lastOpenedOperationId: c.operationId,
        }),
      };
    }
    if (c.type === "unit-profile-get")
      return { profile: this.repo.getUnitProfile(c.id) };
    if (c.type === "unit-profile-instantiate") {
      const current = this.repo.getOperation(c.operation.id);
      if (current.revision !== c.operation.revision)
        throw Error("Operation changed; reload before importing units");
      return {
        operation: instantiateUnitProfile(
          this.repo,
          c.operation,
          c.unitProfileVersionId,
          c.subtree,
          c.confirmDuplicate,
          c.importId,
          this.runtime.id,
        ),
      };
    }
    return this.repo.transaction(() => {
      if (c.type === "unit-profile-new") {
        const v = newUnitProfile(c.name, this.runtime.id, this.runtime.now());
        this.repo.saveUnitProfile(v, null);
        return { profile: v };
      }
      if (c.type === "unit-profile-retire") {
        this.repo.retireUnitProfile(c.id, this.runtime.now());
        return { profile: this.repo.getUnitProfile(c.id) };
      }
      if (c.type === "unit-profile-derive") {
        const source = this.repo.getUnitProfile(c.id);
        if (!c.newFamily && source.status === "DRAFT")
          throw Error("Create a version from a published or retired profile");
        const v = deriveUnitProfile(
          source,
          c.versionLabel,
          c.newFamily,
          this.runtime.id,
          this.runtime.now(),
        );
        v.insigniaAssetId = null;
        this.repo.saveUnitProfile(v, null);
        this.repo.copyUnitProfileAsset(
          source,
          v,
          this.runtime.id,
          this.runtime.now(),
        );
        if (v.insigniaAssetId) {
          v.contentVersion++;
          this.repo.saveUnitProfile(v, 1);
        }
        return { profile: v };
      }
      const old = this.repo.getUnitProfile(
        c.type === "unit-profile-save" ? c.profile.unitProfileVersionId : c.id,
      );
      if (old.status !== "DRAFT")
        throw Error(
          "Published Unit Profile is immutable; create a new version",
        );
      if (old.contentVersion !== c.expectedContentVersion)
        throw Error("Unit Profile draft changed; reload before saving");
      const v =
        c.type === "unit-profile-save" ? structuredClone(c.profile) : old;
      if (
        c.type === "unit-profile-save" &&
        (v.status !== "DRAFT" || v.publishedAt || v.retiredAt)
      )
        throw Error("Use the explicit Publish action");
      v.updatedAt = this.runtime.now();
      v.contentVersion = old.contentVersion + 1;
      if (c.type === "unit-profile-publish") {
        v.status = "PUBLISHED";
        v.publishedAt = v.updatedAt;
      }
      this.repo.saveUnitProfile(v, c.expectedContentVersion);
      return { profile: v };
    });
  }
}
