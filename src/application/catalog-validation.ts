import type { CatalogItem } from "../domain/catalog";
import type { Repository } from "./ports";
import type { CatalogRepository } from "./catalog-ports";
import { canonical } from "../export/projections/v1";
import { profileSymbol } from "../domain/unit-profiles";
import type {
  ExactLibraryRef,
  MilitarySymbolDefinition,
} from "../domain/symbology";
export function validateCatalogReferences(
  item: CatalogItem,
  repo: Repository,
  store: CatalogRepository,
): void {
  if (
    (item.kind === "SYMBOL" || item.kind === "ORBAT") &&
    item.content.exchangeOrigin
  ) {
    const origin = item.content.exchangeOrigin;
    const source =
      item.kind === "SYMBOL"
        ? repo.getSymbol(origin.targetVersionId)
        : repo.getOrbat(origin.targetVersionId);
    if (canonical(source.exchangeOrigin) !== canonical(origin))
      throw Error(
        "Import source evidence does not match its retained receipt.",
      );
  }
  const symbol = (ref: ExactLibraryRef) => {
    const value = repo.getSymbol(ref.versionId);
    if (
      value.status === "DRAFT" ||
      value.familyId !== ref.familyId ||
      repo.libraryHash("SYMBOL", ref.versionId) !== ref.contentHash
    )
      throw Error("The chosen symbol no longer matches its saved source.");
    return value;
  };
  const definition = (d: MilitarySymbolDefinition) => {
    if (d.origin.kind === "SAVED_SYMBOL") symbol(d.origin.source);
  };
  const snapshot = (s: {
    definition: MilitarySymbolDefinition;
    source: ExactLibraryRef | null;
  }) => {
    definition(s.definition);
    if (
      s.source &&
      canonical(symbol(s.source).definition) !== canonical(s.definition)
    )
      throw Error("The chosen symbol has an invalid saved copy.");
  };
  if (item.kind === "SYMBOL") definition(item.content.definition);
  if (item.kind === "ORBAT")
    for (const n of item.content.nodes) {
      if (n.unit.kind === "UNIT_PROFILE") {
        const p = repo.getUnitProfile(n.unit.source.versionId);
        if (
          p.status === "DRAFT" ||
          p.unitProfileFamilyId !== n.unit.source.familyId ||
          repo.unitProfileHash(p.unitProfileVersionId) !==
            n.unit.source.contentHash ||
          canonical(p.identity) !== canonical(n.unit.identity) ||
          canonical(profileSymbol(p)) !== canonical(n.unit.defaultSymbol)
        )
          throw Error(
            "An ORBAT unit no longer matches its chosen organization.",
          );
        if (n.unit.defaultSymbol) repo.verifySymbolPin(n.unit.defaultSymbol);
      } else if (n.unit.symbol) snapshot(n.unit.symbol);
      if (n.symbolOverride) snapshot(n.symbolOverride);
    }
  if (item.kind === "DOCTRINE")
    repo.verifyAssetReferences(
      item.content.config.doctrine.modules?.assets ?? [],
    );
  if (item.kind === "ORGANIZATION") {
    const p = item.content;
    // Retained manual relationships still need valid references, even while the ORBAT is active.
    for (const child of p.standingSubordinates)
      if (
        store.catalogFind(child.unitProfileVersionId)?.item.kind !==
        "ORGANIZATION"
      )
        throw Error("A subordinate must be an available organization.");
    if (
      p.orbatWorkspace?.orbatId &&
      store.catalogFind(p.orbatWorkspace.orbatId)?.item.kind !== "ORBAT"
    )
      throw Error("Choose an available saved ORBAT for this organization.");
    if (p.defaultSymbol) repo.verifySymbolPin(p.defaultSymbol);
    if (p.insigniaAssetId) repo.assetData(p.insigniaAssetId);
    if (p.defaultDoctrine) {
      const d = store.catalogFind(p.defaultDoctrine.doctrineVersionId);
      if (
        d
          ? d.item.kind !== "DOCTRINE"
          : !repo
              .listDoctrines()
              .some(
                (v) =>
                  v.doctrineVersionId === p.defaultDoctrine!.doctrineVersionId,
              )
      )
        throw Error("Choose an available default doctrine.");
    }
    for (const m of p.roleMappings) {
      const d = store.catalogFind(m.doctrineFamilyId),
        v =
          d?.item.kind === "DOCTRINE"
            ? d.item.content.config.doctrine
            : repo
                .listDoctrines()
                .find(
                  (d) =>
                    d.doctrineFamilyId === m.doctrineFamilyId &&
                    d.config.doctrine.version === m.doctrineVersion,
                )?.config.doctrine;
      if (!v?.staff.some((s) => s.id === m.staffId))
        throw Error(
          "A staff mapping refers to a removed doctrine role. Review the organization’s Defaults page.",
        );
    }
  }
}
