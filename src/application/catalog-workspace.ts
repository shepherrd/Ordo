import {
  catalogItemFromLegacy,
  type CatalogKind,
  type LegacyCatalogDocument,
} from "../domain/catalog";
import { z } from "zod";
import { editableOrbatSchema } from "../domain/catalog-orbat";
import type { DoctrineVersion } from "../domain/doctrine-builder";
import type { UnitProfile } from "../domain/unit-profiles";
import type { SavedSymbolVersion } from "../domain/symbology";
import type { SavedOrbatVersion } from "../domain/orbat";
import type { Repository } from "./ports";
import { CatalogService, catalogEditorDocument } from "./catalog-service";
import { OrdoService, commandSchema, type AppState } from "./service";
import {
  WorkspaceService,
  workspaceCommandSchema,
  type WorkspaceResult,
} from "./workspace-service";
import {
  SymbologyService,
  libraryCommandSchema,
  type LibraryResult,
} from "./symbology-service";
import type { DoctrineSummary, UnitProfileSummary } from "./workspace-ports";

const catalogLibraryCommandSchema = z.union([
  z
    .object({
      type: z.literal("save-orbat"),
      value: editableOrbatSchema,
      expected: z.number().int().positive(),
    })
    .strict(),
  libraryCommandSchema,
]);

/** Active editable catalogs. Historical services only receive immutable consumption snapshots. */
export class CatalogWorkspace {
  constructor(
    readonly catalog: CatalogService,
    private repo: Repository,
    private operations: OrdoService,
    private workspace: WorkspaceService,
    private symbols: SymbologyService,
  ) {}
  document(id: string, kind?: CatalogKind) {
    const entry = this.catalog.store.catalogGet(id);
    if (kind && entry.item.kind !== kind)
      throw Error("This item belongs to another catalog.");
    return catalogEditorDocument(entry.item);
  }
  private save(
    kind: CatalogKind,
    value: LegacyCatalogDocument,
    expected: number,
  ) {
    const item = catalogItemFromLegacy(kind, value),
      current = this.catalog.store.catalogGet(item.id);
    if (
      current.item.kind !== kind ||
      Date.parse(current.item.updatedAt) !== expected
    )
      throw Error("This item changed. Reload it before saving your edits.");
    // Compatibility fields are not editable library state.
    item.createdAt = current.item.createdAt;
    if (
      item.kind === "ORGANIZATION" &&
      current.item.kind === "ORGANIZATION" &&
      current.item.content.orbatWorkspace
    )
      item.content.orbatWorkspace = structuredClone(
        current.item.content.orbatWorkspace,
      );
    this.catalog.execute({
      type: "save",
      item,
      expectedToken: current.editToken,
    });
    return this.document(item.id, kind);
  }
  private create(
    kind: CatalogKind,
    name: string,
    sourceId?: string,
    empty?: boolean,
  ) {
    const { entry } = this.catalog.execute({
      type: "create",
      kind,
      name,
      sourceId,
      empty,
    });
    return this.document(entry!.item.id, kind);
  }
  state(state: AppState): AppState {
    const doctrines = this.catalog.store
      .catalogList("DOCTRINE")
      .map((e) => catalogEditorDocument(e.item) as DoctrineVersion);
    return {
      ...state,
      doctrines,
      configurations: doctrines.map((d) => d.config),
    };
  }
  execute(input: unknown): AppState {
    const c = commandSchema.parse(input);
    if (c.type === "load" && c.operationId) {
      const doctrineUpdate = this.catalog.followDoctrine(c.operationId);
      const organizationUpdate = this.catalog.followOrganizationStaff(
        c.operationId,
      );
      return {
        ...this.state(this.operations.execute(c)),
        doctrineUpdate,
        organizationUpdate,
      };
    }
    if (c.type === "save")
      return this.repo.transaction(() => {
        this.operations.execute(c);
        const doctrineUpdate = this.catalog.followDoctrine(
          c.operation.id,
          true,
        );
        const organizationUpdate = this.catalog.followOrganizationStaff(
          c.operation.id,
          true,
        );
        return {
          ...this.state(this.operations.load(c.operation.id)),
          doctrineUpdate,
          organizationUpdate,
        };
      });
    if (c.type === "doctrine-publish" || c.type === "doctrine-retire")
      throw Error("Doctrines are edited and saved directly.");
    if (c.type === "doctrine-create") {
      if (!c.newFamily)
        throw Error("Create a separate doctrine or edit the existing one.");
      const d = this.create(
        "DOCTRINE",
        c.name,
        c.sourceId,
        c.empty,
      ) as DoctrineVersion;
      return {
        ...this.state(this.operations.load()),
        selectedDoctrineId: d.doctrineVersionId,
      };
    }
    if (c.type === "doctrine-save") {
      const d = this.save(
        "DOCTRINE",
        c.doctrine,
        c.expectedContentVersion,
      ) as DoctrineVersion;
      return {
        ...this.state(this.operations.load()),
        selectedDoctrineId: d.doctrineVersionId,
      };
    }
    if (c.type === "create")
      return this.repo.transaction(() => {
        if (
          c.configuration &&
          this.catalog.store.catalogFind(c.configuration.id)
        ) {
          this.document(c.configuration.id, "DOCTRINE");
          const id = this.catalog.snapshot(c.configuration.id);
          c.configuration = this.repo
            .listDoctrines()
            .find((d) => d.doctrineVersionId === id)!.config.organization;
          c.configuration = {
            id: c.configuration.id,
            version: c.configuration.version,
          };
        }
        if (c.unitProfileVersionId) {
          this.document(c.unitProfileVersionId, "ORGANIZATION");
          c.unitProfileVersionId = this.catalog.snapshot(
            c.unitProfileVersionId,
          );
        }
        return this.state(this.operations.execute(c));
      });
    return this.state(this.operations.execute(c));
  }
  private organizations(): UnitProfileSummary[] {
    const entries = this.catalog.store.catalogList("ORGANIZATION");
    return entries.map(({ item }) => {
      if (item.kind !== "ORGANIZATION")
        throw Error("Invalid organization catalog");
      const p = item.content;
      return {
        unitProfileFamilyId: item.id,
        unitProfileVersionId: item.id,
        name: item.name,
        shortDesignation: p.identity.shortDesignation,
        echelon: p.identity.echelon,
        unitType: p.identity.unitType,
        versionLabel: "",
        status: "",
        updatedAt: item.updatedAt,
        parentNames: entries
          .filter(
            (e) =>
              e.item.kind === "ORGANIZATION" &&
              !e.item.content.orbatWorkspace?.orbatId &&
              e.item.content.standingSubordinates.some(
                (r) => r.unitProfileVersionId === item.id,
              ),
          )
          .map((e) => e.item.name)
          .join(", "),
        defaultDoctrineName: p.defaultDoctrine
          ? (this.catalog.store.catalogFind(p.defaultDoctrine.doctrineVersionId)
              ?.item.name ??
            this.repo
              .listDoctrines()
              .find(
                (d) =>
                  d.doctrineVersionId === p.defaultDoctrine!.doctrineVersionId,
              )?.displayName ??
            null)
          : null,
        insigniaAssetId: p.insigniaAssetId,
      };
    });
  }
  private doctrines(): DoctrineSummary[] {
    return this.catalog.store.catalogList("DOCTRINE").map(({ item }) => {
      const d = catalogEditorDocument(item) as DoctrineVersion;
      return {
        id: item.id,
        familyId: item.id,
        name: item.name,
        versionLabel: "",
        profileVersion: 1,
        status: "",
        sourceKind: "USER_CREATED",
        configuration: { id: item.id, version: 1 },
        staff: d.config.doctrine.staff,
      };
    });
  }
  workspaceCommand(input: unknown): WorkspaceResult {
    const c = workspaceCommandSchema.parse(input);
    if (c.type === "unit-profile-publish" || c.type === "unit-profile-retire")
      throw Error("Organizations are edited and saved directly.");
    if (c.type === "unit-profile-get") {
      const { item } = this.catalog.store.catalogGet(c.id);
      if (item.kind !== "ORGANIZATION") throw Error("Choose an organization.");
      const orbatId = item.content.orbatWorkspace?.orbatId;
      const orbat = orbatId
        ? this.catalog.store.catalogGet(orbatId).item
        : null;
      if (orbat && orbat.kind !== "ORBAT")
        throw Error("The assigned item is not an ORBAT.");
      return {
        profile: catalogEditorDocument(item) as UnitProfile,
        ...(orbat?.kind === "ORBAT"
          ? {
              assignedOrbat: {
                name: orbat.name,
                unitCount: orbat.content.nodes.length,
              },
            }
          : {}),
      };
    }
    if (c.type === "unit-profile-new")
      return { profile: this.create("ORGANIZATION", c.name) as UnitProfile };
    if (c.type === "unit-profile-save")
      return {
        profile: this.save(
          "ORGANIZATION",
          c.profile,
          c.expectedContentVersion,
        ) as UnitProfile,
      };
    if (c.type === "unit-profile-derive") {
      if (!c.newFamily)
        throw Error("Create a separate organization or edit the existing one.");
      return {
        profile: this.create(
          "ORGANIZATION",
          `${this.catalog.store.catalogGet(c.id).item.name} copy`,
          c.id,
        ) as UnitProfile,
      };
    }
    if (c.type === "unit-profile-instantiate")
      return this.repo.transaction(() =>
        this.workspace.execute({
          ...c,
          unitProfileVersionId: this.catalog.snapshot(c.unitProfileVersionId),
        }),
      );
    if (c.type === "browse-unit-profiles") {
      const q = c.query,
        search = q.search.toLocaleLowerCase();
      const items = this.organizations().filter(
        (p) =>
          (!search ||
            [p.name, p.shortDesignation, p.unitType, p.parentNames]
              .join(" ")
              .toLocaleLowerCase()
              .includes(search)) &&
          (!q.echelon || p.echelon === q.echelon),
      );
      items.sort((a, b) =>
        q.sort === "name"
          ? a.name.localeCompare(b.name)
          : b.updatedAt.localeCompare(a.updatedAt),
      );
      return {
        organizations: {
          total: items.length,
          items: items.slice(q.offset, q.offset + q.limit),
        },
      };
    }
    if (c.type === "doctrine-summaries") return { doctrines: this.doctrines() };
    if (c.type === "dashboard")
      return {
        dashboard: {
          ...this.repo.dashboard(),
          organizations: this.organizations().slice(0, 6),
          doctrines: this.doctrines(),
        },
      };
    return this.workspace.execute(c);
  }
  symbolCommand(input: unknown): LibraryResult {
    const c = catalogLibraryCommandSchema.parse(input);
    const result = (
      kind: "SYMBOL" | "ORBAT",
      v: LegacyCatalogDocument,
    ): LibraryResult =>
      kind === "SYMBOL"
        ? { symbol: v as SavedSymbolVersion }
        : { orbat: v as SavedOrbatVersion };
    if (c.type === "publish" || c.type === "retire")
      throw Error("Symbols and ORBATs are edited and saved directly.");
    if (c.type === "delete-draft")
      throw Error("Use permanent deletion with confirmation.");
    if (c.type === "browse") {
      const search = c.query.search.toLocaleLowerCase(),
        items = this.catalog.store
          .catalogList(c.kind)
          .filter((e) => e.item.name.toLocaleLowerCase().includes(search))
          .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt))
          .map(({ item }) => ({
            familyId: item.id,
            versionId: item.id,
            name: item.name,
            versionLabel: "",
            status: "",
            updatedAt: item.updatedAt,
            contentVersion: Date.parse(item.updatedAt),
          }));
      return {
        page: {
          total: items.length,
          items: items.slice(c.query.offset, c.query.offset + c.query.limit),
        },
      };
    }
    if (c.type === "get") return result(c.kind, this.document(c.id, c.kind));
    if (c.type === "new") return result(c.kind, this.create(c.kind, c.name));
    if (c.type === "derive") {
      if (!c.newFamily)
        throw Error("Create a separate item or edit the existing one.");
      return result(
        c.kind,
        this.create(
          c.kind,
          `${this.catalog.store.catalogGet(c.id).item.name} copy`,
          c.id,
        ),
      );
    }
    if (c.type === "save-symbol")
      return result("SYMBOL", this.save("SYMBOL", c.value, c.expected));
    if (c.type === "save-orbat")
      return result("ORBAT", this.save("ORBAT", c.value, c.expected));
    if (c.type === "new-symbol-from-definition")
      return this.repo.transaction(() => {
        const v = this.create("SYMBOL", c.name) as SavedSymbolVersion;
        v.definition = {
          ...c.definition,
          definitionId: v.definition.definitionId,
        };
        return result("SYMBOL", this.save("SYMBOL", v, v.contentVersion));
      });
    if (c.type === "symbol-pin") {
      this.document(c.id, "SYMBOL");
      return { pin: this.repo.resolveSymbolPin(this.catalog.snapshot(c.id)) };
    }
    if (c.type === "profile-node" || c.type === "orbat-from-profile")
      return this.repo.transaction(() => {
        this.document(c.id, "ORGANIZATION");
        const r = this.symbols.execute({
          ...c,
          id: this.catalog.snapshot(c.id),
        });
        if (r.orbat) {
          this.catalog.importLegacy();
          r.orbat = this.document(
            r.orbat.versionId,
            "ORBAT",
          ) as SavedOrbatVersion;
        }
        return r;
      });
    if (c.type === "import-orbat") {
      this.document(c.orbatVersionId, "ORBAT");
      return this.symbols.execute({
        ...c,
        orbatVersionId: this.catalog.snapshot(c.orbatVersionId),
      });
    }
    throw Error("Unsupported catalog command");
  }
}
