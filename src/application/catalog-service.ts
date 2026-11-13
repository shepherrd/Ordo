import { z } from "zod";
import { snapshotOrganizationOrbat } from "./organization-orbat-snapshot";
import { editableOrbatSchema } from "../domain/catalog-orbat";
import { validateNarratives } from "../domain/narrative";
import { validateCatalogReferences } from "./catalog-validation";
import {
  validateWorkingDraft,
  type WorkingDraftRepository,
} from "./working-drafts";
import {
  catalogItemFromLegacy,
  catalogItemSchema,
  catalogKindSchema,
  type CatalogEntry,
  type CatalogItem,
  type CatalogKind,
  type LegacyCatalogDocument,
} from "../domain/catalog";
import {
  doctrineVersionSchema,
  createDoctrineDraft,
  syncDoctrineIndex,
  type DoctrineVersion,
} from "../domain/doctrine-builder";
import {
  newSavedSymbol,
  savedSymbolVersionSchema,
  type SavedSymbolVersion,
} from "../domain/symbology";
import { newOrbatLayout, type SavedOrbatVersion } from "../domain/orbat";
import {
  newUnitProfile,
  unitProfileSchema,
  type UnitProfile,
} from "../domain/unit-profiles";
import { canonical } from "../export/projections/v1";
import type { Repository, Runtime } from "./ports";
import type { CatalogRepository } from "./catalog-ports";
import {
  adoptDoctrine,
  DoctrineUpdateConflict,
  type DoctrineUpdateStatus,
} from "../domain/doctrine-adoption";
import {
  adoptOrganizationStaff,
  OrganizationUpdateConflict,
  type OrganizationUpdateStatus,
} from "../domain/organization-adoption";
import { bindOrganization } from "../domain/unit-profiles";

const id = z.string().uuid(),
  token = z.string().regex(/^[a-f0-9]{64}$/);
export const catalogCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list"), kind: catalogKindSchema }).strict(),
  z.object({ type: z.literal("get"), id }).strict(),
  z
    .object({
      type: z.literal("create"),
      kind: catalogKindSchema,
      name: z.string().trim().min(1).max(160),
      sourceId: id.optional(),
      empty: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("save"),
      item: catalogItemSchema,
      expectedToken: token,
    })
    .strict(),
  z.object({ type: z.literal("snapshot"), id, expectedToken: token }).strict(),
]);
export type CatalogCommand = z.infer<typeof catalogCommandSchema>;
export type CatalogResult = {
  entry?: CatalogEntry;
  entries?: CatalogEntry[];
  snapshotId?: string;
};

/** This boundary adapts existing content editors, not a new library lifecycle. */
export function catalogEditorDocument(
  item: CatalogItem,
): LegacyCatalogDocument {
  const common = {
    schemaVersion: 1 as const,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    contentVersion: Date.parse(item.updatedAt),
    versionLabel: "1.0.0",
    status: "DRAFT" as const,
    publishedAt: null,
    retiredAt: null,
    parentVersionId: null,
  };
  if (item.kind === "DOCTRINE") {
    const config = structuredClone(item.content.config);
    for (const profile of [
      config.doctrine,
      config.organization,
      config.echelon,
    ]) {
      profile.id = item.id;
      profile.version = 1;
    }
    config.doctrine.name = item.name;
    config.organization.name = item.name;
    config.organization.doctrineRef = { id: item.id, version: 1 };
    config.organization.echelonRef = { id: item.id, version: 1 };
    if (config.doctrine.modules)
      config.doctrine.modules.doctrineVersionId = item.id;
    const v: DoctrineVersion = {
      ...common,
      doctrineFamilyId: item.id,
      doctrineVersionId: item.id,
      stableKey: item.content.stableKey,
      displayName: item.name,
      description: item.content.description,
      author: item.content.author,
      notes: "",
      sourceKind: "USER_CREATED",
      duplicatedFromVersionId: null,
      config,
    };
    syncDoctrineIndex(v);
    return v;
  }
  if (item.kind === "ORGANIZATION") {
    const { orbatWorkspace: _workspace, ...content } = item.content;
    return {
      ...common,
      schemaVersion: 2,
      unitProfileFamilyId: item.id,
      unitProfileVersionId: item.id,
      sourceKind: "USER_CREATED",
      duplicatedFrom: null,
      ...structuredClone(content),
    };
  }
  return {
    ...common,
    familyId: item.id,
    versionId: item.id,
    name: item.name,
    duplicatedFrom: null,
    ...structuredClone(item.content),
  };
}

export class CatalogService {
  constructor(
    private repo: Repository,
    readonly store: CatalogRepository,
    private rt: Runtime,
    private recovery?: WorkingDraftRepository,
  ) {}
  followDoctrine(
    operationId: string,
    afterSave = false,
  ): DoctrineUpdateStatus | null {
    const op = this.repo.getOperation(operationId);
    const before = this.repo.getConfig(op);
    const pinned = this.repo
      .listDoctrines()
      .find(
        (d) =>
          d.config.doctrine.id === op.doctrineRef.id &&
          d.config.doctrine.version === op.doctrineRef.version,
      );
    if (!pinned) return null;
    const sourceId =
      this.store.catalogSnapshotOrigin(pinned.doctrineVersionId) ??
      pinned.doctrineVersionId;
    const entry = this.store.catalogFind(sourceId);
    if (entry?.item.kind !== "DOCTRINE") return null;
    const item = entry.item;
    if (
      this.store.catalogSnapshot(item.id, this.closureKey(item)) ===
      pinned.doctrineVersionId
    )
      return null;
    // Untouched legacy doctrines need no adoption merely because the catalog was introduced.
    if (
      sourceId === pinned.doctrineVersionId &&
      canonical(item.content.config) === canonical(pinned.config) &&
      item.name === pinned.displayName
    )
      return null;
    const status = (
      state: DoctrineUpdateStatus["state"],
      message: string,
    ): DoctrineUpdateStatus => ({
      state,
      doctrineId: item.id,
      name: item.name,
      messages: [message],
    });
    if (op.metadata.statusId !== before.doctrine.editingStatus)
      return status(
        "deferred",
        "The saved doctrine has changed. This operation will adopt compatible changes when it returns to Draft.",
      );
    const recovery = this.recovery?.getWorkingDraft({
      kind: "operation",
      id: op.id,
      scope: op.id,
    });
    if (!afterSave && recovery)
      return status(
        "deferred",
        "Recover or discard this operation's unfinished edits before updating its doctrine.",
      );
    try {
      return this.repo.transaction(() => {
        const snapshotId = this.snapshot(item.id);
        const latest = this.repo
          .listDoctrines()
          .find((d) => d.doctrineVersionId === snapshotId)!;
        const updated = adoptDoctrine(
          op,
          before,
          latest.config,
          this.rt.id,
          this.rt.now(),
        );
        updated.revision = op.revision + 1;
        updated.updatedAt = this.rt.now();
        this.repo.saveOperation(updated, op.revision, this.rt.actor);
        return status(
          "updated",
          `Updated to the saved “${item.name}” doctrine. Your operation content has been retained.`,
        );
      });
    } catch (e) {
      if (e instanceof DoctrineUpdateConflict)
        return status("conflict", e.message);
      throw e;
    }
  }
  followOrganizationStaff(
    operationId: string,
    afterSave = false,
  ): OrganizationUpdateStatus | null {
    const op = this.repo.getOperation(operationId);
    const previous = op.operationOrganizationBinding;
    if (!previous) return null;
    const sourceId =
      this.store.catalogSnapshotOrigin(previous.unitProfileVersionId) ??
      previous.unitProfileVersionId;
    const entry = this.store.catalogFind(sourceId);
    if (entry?.item.kind !== "ORGANIZATION") return null;
    const profile = catalogEditorDocument(entry.item) as UnitProfile;
    const config = this.repo.getConfig(op);
    const doctrine = this.repo
      .listDoctrines()
      .find(
        (d) =>
          d.config.doctrine.id === op.doctrineRef.id &&
          d.config.doctrine.version === op.doctrineRef.version,
      );
    const doctrineSource = doctrine
      ? (this.store.catalogSnapshotOrigin(doctrine.doctrineVersionId) ??
        doctrine.doctrineVersionId)
      : op.doctrineRef.id;
    // Catalog mappings identify the saved doctrine, while an operation consumes an exact snapshot.
    profile.roleMappings = profile.roleMappings.map((m) =>
      m.doctrineFamilyId === doctrineSource
        ? {
            ...m,
            doctrineFamilyId: config.doctrine.id,
            doctrineVersion: config.doctrine.version,
          }
        : m,
    );
    const binding = bindOrganization(profile, config, previous.contentHash);
    const relevant = (b: typeof binding) =>
      canonical({
        identity: b.identity,
        staff: b.staff,
        mappings: b.resolvedRoleMappings,
      });
    if (relevant(previous) === relevant(binding)) return null;
    const status = (
      state: OrganizationUpdateStatus["state"],
      message: string,
    ): OrganizationUpdateStatus => ({
      state,
      organizationId: entry.item.id,
      name: entry.item.name,
      messages: [message],
    });
    if (op.metadata.statusId !== config.doctrine.editingStatus)
      return status(
        "deferred",
        "The organization’s staff has changed. Compatible changes will apply when this operation returns to Draft.",
      );
    if (
      !afterSave &&
      this.recovery?.getWorkingDraft({
        kind: "operation",
        id: op.id,
        scope: op.id,
      })
    )
      return status(
        "deferred",
        "Recover or discard this operation’s unfinished edits before updating its organization staff.",
      );
    try {
      return this.repo.transaction(() => {
        const snapshotId = this.snapshot(entry.item.id);
        const snapshot = this.repo.getUnitProfile(snapshotId);
        binding.unitProfileFamilyId = snapshot.unitProfileFamilyId;
        binding.unitProfileVersionId = snapshotId;
        binding.versionLabel = snapshot.versionLabel;
        binding.contentHash = this.repo.unitProfileHash(snapshotId);
        const updated = adoptOrganizationStaff(op, binding, config);
        updated.revision = op.revision + 1;
        updated.updatedAt = this.rt.now();
        this.repo.saveOperation(updated, op.revision, this.rt.actor);
        return status(
          "updated",
          `Updated staff and roles from “${entry.item.name}”.`,
        );
      });
    } catch (e) {
      if (e instanceof OrganizationUpdateConflict)
        return status("conflict", e.message);
      throw e;
    }
  }
  importLegacy() {
    return this.repo.transaction(() => {
      let imported = 0;
      const add = (kind: CatalogKind, v: LegacyCatalogDocument) => {
        const item = catalogItemFromLegacy(kind, v);
        if (this.store.catalogWasImported(kind, item.id)) return;
        if (item.kind === "ORGANIZATION")
          item.content.roleMappings = item.content.roleMappings.map((m) => {
            const d = this.repo
              .listDoctrines()
              .find(
                (d) =>
                  d.doctrineFamilyId === m.doctrineFamilyId &&
                  d.config.doctrine.version === m.doctrineVersion,
              );
            return d
              ? {
                  ...m,
                  doctrineFamilyId: d.doctrineVersionId,
                  doctrineVersion: 1,
                }
              : m;
          });
        this.store.catalogSave(item, null);
        this.store.catalogRememberOrigin(item.id, item.id);
        this.store.catalogMarkImported(
          kind,
          item.id,
          item.id,
          this.repo.hash(canonical(v)),
        );
        const recoveryKind = (
          {
            DOCTRINE: "doctrine",
            ORGANIZATION: "unit-profile",
            SYMBOL: "symbol",
            ORBAT: "orbat",
          } as const
        )[kind];
        const working = this.recovery?.getWorkingDraft({
          kind: recoveryKind,
          id: item.id,
          scope: null,
        });
        if (working && canonical(JSON.parse(working.source)) === canonical(v)) {
          validateWorkingDraft(working);
          const content = catalogItemFromLegacy(
            kind,
            JSON.parse(working.value),
          );
          const converted = {
            ...working,
            source: canonical(catalogEditorDocument(item)),
            value: canonical(
              catalogEditorDocument({
                ...content,
                id: item.id,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              }),
            ),
          };
          validateWorkingDraft(converted);
          this.recovery!.putWorkingDraft(converted, working.sequence);
        }
        imported++;
      };
      for (const v of this.repo.listDoctrines()) add("DOCTRINE", v);
      for (let offset = 0; ; offset += 100) {
        const page = this.repo.browseUnitProfiles({
          search: "",
          status: "",
          echelon: "",
          sort: "name",
          offset,
          limit: 100,
        });
        for (const v of page.items)
          add("ORGANIZATION", this.repo.getUnitProfile(v.unitProfileVersionId));
        if (offset + 100 >= page.total) break;
      }
      for (const kind of ["SYMBOL", "ORBAT"] as const)
        for (let offset = 0; ; offset += 100) {
          const page = this.repo.browseLibrary(kind, {
            search: "",
            status: "",
            offset,
            limit: 100,
          });
          for (const v of page.items)
            add(
              kind,
              kind === "SYMBOL"
                ? this.repo.getSymbol(v.versionId)
                : this.repo.getOrbat(v.versionId),
            );
          if (offset + 100 >= page.total) break;
        }
      return imported;
    });
  }
  execute(input: unknown): CatalogResult {
    const c = catalogCommandSchema.parse(input);
    if (c.type === "list") return { entries: this.store.catalogList(c.kind) };
    if (c.type === "get") return { entry: this.store.catalogGet(c.id) };
    if (c.type === "snapshot") {
      const e = this.store.catalogGet(c.id);
      if (e.editToken !== c.expectedToken)
        throw Error("This item changed. Save or reload it before using it.");
      return { snapshotId: this.snapshot(c.id) };
    }
    return this.repo.transaction(() => {
      if (c.type === "save") {
        const old = this.store.catalogGet(c.item.id);
        if (old.editToken !== c.expectedToken)
          throw Error("This item changed. Reload it before saving your edits.");
        const item = structuredClone(c.item);
        item.updatedAt = new Date(
          Math.max(
            Date.parse(this.rt.now()),
            Date.parse(old.item.updatedAt) + 1,
          ),
        ).toISOString();
        this.validate(item);
        if (
          (item.kind === "SYMBOL" || item.kind === "ORBAT") &&
          (old.item.kind === "SYMBOL" || old.item.kind === "ORBAT") &&
          canonical(item.content.exchangeOrigin ?? null) !==
            canonical(old.item.content.exchangeOrigin ?? null)
        )
          throw Error("Import source evidence cannot be replaced by an edit.");
        const entry = this.store.catalogSave(item, c.expectedToken);
        if (item.kind === "DOCTRINE" && old.item.kind === "DOCTRINE") {
          const removed = new Set(
            old.item.content.config.doctrine.staff
              .filter(
                (s) =>
                  !item.content.config.doctrine.staff.some(
                    (x) => x.id === s.id,
                  ),
              )
              .map((s) => s.id),
          );
          for (const organization of this.store.catalogList("ORGANIZATION")) {
            if (organization.item.kind !== "ORGANIZATION") continue;
            const p = organization.item.content;
            const mappings = p.roleMappings.filter(
              (m) =>
                !(m.doctrineFamilyId === item.id && removed.has(m.staffId)),
            );
            if (mappings.length !== p.roleMappings.length) {
              p.roleMappings = mappings;
              organization.item.updatedAt = new Date(
                Math.max(
                  Date.parse(item.updatedAt),
                  Date.parse(organization.item.updatedAt) + 1,
                ),
              ).toISOString();
              this.store.catalogSave(organization.item, organization.editToken);
            }
          }
        }
        return { entry };
      }
      const now = this.rt.now();
      let item: CatalogItem;
      if (c.sourceId) {
        const source = this.store.catalogGet(c.sourceId).item;
        if (source.kind !== c.kind)
          throw Error("Choose a source of the same library type.");
        item = {
          ...structuredClone(source),
          id: this.rt.id(),
          name: c.name,
          createdAt: now,
          updatedAt: now,
        };
        if (item.kind === "DOCTRINE") {
          item.content.stableKey = `doctrine-${item.id}`;
          if (c.empty) {
            item.content.config.doctrine.annexCatalog = [];
            if (item.content.config.doctrine.catalog) {
              item.content.config.doctrine.catalog.nodes = [];
              item.content.config.doctrine.catalog.baseFields = [];
            }
            if (item.content.config.doctrine.modules) {
              item.content.config.doctrine.modules.layouts = [];
              item.content.config.doctrine.modules.assets = [];
            }
          }
          item.content.config = (
            catalogEditorDocument(item) as DoctrineVersion
          ).config;
        }
        if (item.kind === "ORGANIZATION")
          item.content.identity.fullDesignation = c.name;
      } else if (c.kind === "SYMBOL") {
        item = catalogItemFromLegacy(
          c.kind,
          newSavedSymbol(c.name, this.rt.id, now),
        );
      } else if (c.kind === "ORGANIZATION") {
        item = catalogItemFromLegacy(
          c.kind,
          newUnitProfile(c.name, this.rt.id, now),
        );
      } else if (c.kind === "ORBAT") {
        const { definition: _definition, ...common } = newSavedSymbol(
            c.name,
            this.rt.id,
            now,
          ),
          root = this.rt.id();
        item = catalogItemFromLegacy(c.kind, {
          ...common,
          rootNodeId: root,
          nodes: [],
          layout: newOrbatLayout(this.rt.id),
        });
      } else {
        const template = this.repo
          .listDoctrines()
          .find((d) => d.sourceKind === "BUNDLED" && d.config.doctrine.catalog);
        if (!template)
          throw Error("The built-in doctrine template is unavailable.");
        const document = createDoctrineDraft(
          template,
          this.rt.id(),
          this.rt.id(),
          1,
          c.name,
          "1.0.0",
          now,
          true,
        );
        if (c.empty) {
          document.config.doctrine.annexCatalog = [];
          if (document.config.doctrine.catalog) {
            document.config.doctrine.catalog.nodes = [];
            document.config.doctrine.catalog.baseFields = [];
          }
          if (document.config.doctrine.modules) {
            document.config.doctrine.modules.layouts = [];
            document.config.doctrine.modules.assets = [];
          }
        }
        item = catalogItemFromLegacy("DOCTRINE", document);
        if (item.kind === "DOCTRINE")
          item.content.config = (
            catalogEditorDocument(item) as DoctrineVersion
          ).config;
      }
      this.validate(item);
      const entry = this.store.catalogSave(item, null);
      const origin = c.sourceId ? this.store.catalogOrigin(c.sourceId) : null;
      if (origin) this.store.catalogRememberOrigin(item.id, origin);
      return { entry };
    });
  }
  validate(item: CatalogItem) {
    validateCatalogItem(item, this.repo, this.store);
  }
  private closureKey(item: CatalogItem, path = new Set<string>()): string {
    if (path.has(item.id) || path.size >= 64)
      throw Error("Library reference cycle or excessive depth.");
    const children =
      item.kind === "ORGANIZATION" && !item.content.orbatWorkspace?.orbatId
        ? item.content.standingSubordinates.map((r) =>
            this.closureKey(
              this.store.catalogGet(r.unitProfileVersionId).item,
              new Set([...path, item.id]),
            ),
          )
        : [];
    const doctrine =
      item.kind === "ORGANIZATION" && item.content.defaultDoctrine
        ? this.store.catalogFind(item.content.defaultDoctrine.doctrineVersionId)
        : null;
    return this.repo.hash(
      canonical({
        kind: item.kind,
        name: item.name,
        content: item.content,
        children,
        ...(item.kind === "ORGANIZATION" && item.content.orbatWorkspace?.orbatId
          ? {
              // Earlier snapshots merged the ORBAT root into the organization.
              // New consumption must preserve that root as a subordinate.
              assignedOrbatHierarchy: 2,
              assignedOrbat: this.closureKey(
                this.store.catalogGet(item.content.orbatWorkspace.orbatId).item,
                new Set([...path, item.id]),
              ),
            }
          : {}),
        mappings:
          item.kind === "ORGANIZATION"
            ? item.content.roleMappings.map((m) => {
                const d = this.store.catalogFind(m.doctrineFamilyId);
                return d
                  ? this.closureKey(d.item, new Set([...path, item.id]))
                  : null;
              })
            : [],
        doctrine: doctrine
          ? this.closureKey(doctrine.item, new Set([...path, item.id]))
          : null,
      }),
    );
  }
  /** An internal asset container supplies legacy foreign keys without creating edit history. */
  assetOwner(itemId: string): string {
    return this.repo.transaction(() => {
      const { item } = this.store.catalogGet(itemId);
      if (item.kind !== "DOCTRINE" && item.kind !== "ORGANIZATION")
        throw Error("This catalog does not accept attachments.");
      const cached = this.store.catalogAssetOwner(itemId);
      if (cached) return cached;
      const owner = this.rt.id(),
        at = this.rt.now();
      if (item.kind === "ORGANIZATION") {
        const shell = newUnitProfile(item.name, this.rt.id, at);
        shell.unitProfileVersionId = owner;
        this.repo.saveUnitProfile(shell, null);
      } else {
        const shell = createDoctrineDraft(
          catalogEditorDocument(item) as DoctrineVersion,
          this.rt.id(),
          owner,
          1,
          item.name,
          "1.0.0",
          at,
          true,
        );
        shell.config.doctrine.modules!.layouts = [];
        shell.config.doctrine.modules!.assets = [];
        this.repo.saveDoctrine(shell, null);
      }
      this.store.catalogMarkImported(
        item.kind,
        owner,
        item.id,
        this.repo.hash(canonical({ assetOwner: owner })),
      );
      this.store.catalogRememberAssetOwner(item.id, owner);
      return owner;
    });
  }
  /** Compatibility snapshots are generated only at a consumption boundary, never on save. */
  snapshot(itemId: string): string {
    return this.repo.transaction(() => {
      const { item } = this.store.catalogGet(itemId),
        key = this.closureKey(item);
      if (item.kind === "ORBAT" && !item.content.nodes.length)
        throw Error(
          "Add a root unit to this ORBAT before exporting or using it in an operation.",
        );
      const cached = this.store.catalogSnapshot(itemId, key);
      if (cached) return cached;
      this.validate(item);
      const snapshotId = this.rt.id(),
        at = this.rt.now();
      const mark = () => {
        this.store.catalogRememberSnapshot(item.id, key, snapshotId);
        this.store.catalogMarkImported(item.kind, snapshotId, item.id, key);
        return snapshotId;
      };
      if (item.kind === "DOCTRINE") {
        const source = catalogEditorDocument(item) as DoctrineVersion;
        const number =
          Math.max(
            0,
            ...this.repo
              .listDoctrines()
              .filter((d) => d.doctrineFamilyId === item.id)
              .map((d) => d.config.doctrine.version),
          ) + 1;
        const v = createDoctrineDraft(
          source,
          item.id,
          snapshotId,
          number,
          item.name,
          `${number}.0.0`,
          at,
          true,
        );
        v.stableKey = item.content.stableKey;
        v.duplicatedFromVersionId = null;
        // Create the owner before copying managed assets, then freeze the complete record.
        const layouts = structuredClone(v.config.doctrine.modules!.layouts);
        v.config.doctrine.modules!.layouts = [];
        this.repo.saveDoctrine(v, null);
        v.config.doctrine.modules!.layouts = layouts;
        this.repo.copyDoctrineAssets(source, v, this.rt.id, at);
        v.status = "PUBLISHED";
        v.publishedAt = at;
        v.contentVersion = 2;
        this.repo.saveDoctrine(v, 1);
        return mark();
      }
      if (item.kind === "ORGANIZATION") {
        const source = catalogEditorDocument(item) as UnitProfile;
        const v = {
          ...structuredClone(source),
          unitProfileVersionId: snapshotId,
          versionLabel: `0.0.${this.store.catalogSnapshotCount(item.id) + 1}`,
          contentVersion: 1,
          createdAt: at,
          updatedAt: at,
        };
        const origin = this.store.catalogOrigin(item.id);
        if (origin) {
          const original = this.repo.getUnitProfile(origin);
          v.duplicatedFrom = {
            unitProfileFamilyId: original.unitProfileFamilyId,
            unitProfileVersionId: origin,
          };
        }
        if (item.content.orbatWorkspace?.orbatId)
          snapshotOrganizationOrbat(item, v, this.repo, this.store, this.rt);
        else
          v.standingSubordinates = v.standingSubordinates.map((r) => {
            const child = this.repo.getUnitProfile(
              this.snapshot(r.unitProfileVersionId),
            );
            return {
              ...r,
              unitProfileFamilyId: child.unitProfileFamilyId,
              unitProfileVersionId: child.unitProfileVersionId,
            };
          });
        if (
          v.defaultDoctrine &&
          this.store.catalogFind(v.defaultDoctrine.doctrineVersionId)
        ) {
          const doctrineId = this.snapshot(v.defaultDoctrine.doctrineVersionId);
          const d = this.repo
            .listDoctrines()
            .find((d) => d.doctrineVersionId === doctrineId)!;
          v.defaultDoctrine = {
            doctrineFamilyId: d.doctrineFamilyId,
            doctrineVersionId: doctrineId,
            profileVersion: d.config.doctrine.version,
            configuration: {
              id: d.config.organization.id,
              version: d.config.organization.version,
            },
          };
        }
        v.roleMappings = v.roleMappings.map((m) => {
          const entry = this.store.catalogFind(m.doctrineFamilyId);
          if (!entry) return m;
          if (entry.item.kind !== "DOCTRINE")
            throw Error("A staff mapping must refer to a doctrine.");
          const id = this.snapshot(entry.item.id),
            d = this.repo
              .listDoctrines()
              .find((d) => d.doctrineVersionId === id)!;
          return {
            ...m,
            doctrineFamilyId: d.doctrineFamilyId,
            doctrineVersion: d.config.doctrine.version,
          };
        });
        v.insigniaAssetId = null;
        this.repo.saveUnitProfile(v, null);
        this.repo.copyUnitProfileAsset(source, v, this.rt.id, at);
        v.status = "PUBLISHED";
        v.publishedAt = at;
        v.contentVersion = 2;
        this.repo.saveUnitProfile(v, 1);
        return mark();
      }
      const v = catalogEditorDocument(item) as
        SavedSymbolVersion | SavedOrbatVersion;
      v.versionId = snapshotId;
      v.versionLabel = `0.0.${this.store.catalogSnapshotCount(item.id) + 1}`;
      v.contentVersion = 1;
      v.createdAt = at;
      v.updatedAt = at;
      const origin =
        v.exchangeOrigin?.targetVersionId ?? this.store.catalogOrigin(item.id);
      if (origin) {
        const original =
          item.kind === "SYMBOL"
            ? this.repo.getSymbol(origin)
            : this.repo.getOrbat(origin);
        v.duplicatedFrom = {
          familyId: original.familyId,
          versionId: original.versionId,
          contentHash: this.repo.libraryHash(item.kind, original.versionId),
        };
      }
      this.repo.saveLibrary(item.kind, v, null);
      v.status = "PUBLISHED";
      v.publishedAt = at;
      v.contentVersion = 2;
      this.repo.saveLibrary(item.kind, v, 1);
      return mark();
    });
  }
}

export function validateCatalogItem(
  item: CatalogItem,
  repo: Repository,
  store: CatalogRepository,
) {
  validateNarratives(item);
  validateCatalogReferences(item, repo, store);
  const v = catalogEditorDocument(catalogItemSchema.parse(item));
  if (item.kind === "SYMBOL") savedSymbolVersionSchema.parse(v);
  else if (item.kind === "ORBAT") editableOrbatSchema.parse(v);
  else if (item.kind === "DOCTRINE") doctrineVersionSchema.parse(v);
  else {
    unitProfileSchema.parse(v);
    const walk = (entry: CatalogItem, path: Set<string>) => {
      if (entry.kind !== "ORGANIZATION")
        throw Error("A subordinate must be an organization.");
      if (path.has(entry.id) || path.size >= 64)
        throw Error(
          "Organization structure contains a cycle or exceeds 64 levels.",
        );
      // Manual relationships are retained but inactive while an ORBAT supplies the structure.
      if (entry.content.orbatWorkspace?.orbatId) return;
      for (const child of entry.content.standingSubordinates)
        walk(
          child.unitProfileVersionId === item.id
            ? item
            : store.catalogGet(child.unitProfileVersionId).item,
          new Set([...path, entry.id]),
        );
    };
    walk(item, new Set());
  }
}
