import type { CatalogItem } from "../domain/catalog";
import { organizationUnit } from "../domain/organization-orbat";
import type { OrbatNode } from "../domain/orbat";
import { newUnitProfile, type UnitProfile } from "../domain/unit-profiles";
import { newSavedSymbol, type SavedSymbolPin } from "../domain/symbology";
import { canonical } from "../export/projections/v1";
import type { Repository, Runtime } from "./ports";
import type { CatalogRepository } from "./catalog-ports";

/** Freeze organization-owned people and the current shared tree only when an operation consumes them. */
export function snapshotOrganizationOrbat(
  item: Extract<CatalogItem, { kind: "ORGANIZATION" }>,
  root: UnitProfile,
  repo: Repository,
  store: CatalogRepository,
  rt: Runtime,
) {
  const workspace = item.content.orbatWorkspace;
  if (!workspace?.orbatId) return;
  const source = store.catalogGet(workspace.orbatId).item;
  if (source.kind !== "ORBAT" || !source.content.nodes.length)
    throw Error(
      "Add a root unit to the assigned ORBAT before using this organization in an operation.",
    );
  const { nodes, rootNodeId, layout } = source.content;
  const at = root.createdAt;
  const symbolCache = new Map<string, SavedSymbolPin>();
  const pin = (node: OrbatNode): SavedSymbolPin | null => {
    const original =
      node.unit.kind === "UNIT_PROFILE" ? node.unit.defaultSymbol : null;
    if (!node.symbolOverride && original) return original;
    const symbol =
      node.symbolOverride ??
      (node.unit.kind === "INLINE_UNIT" ? node.unit.symbol : null);
    if (!symbol) return null;
    if (symbol.source) return repo.resolveSymbolPin(symbol.source.versionId);
    const key = repo.hash(canonical(symbol.definition));
    const cached = symbolCache.get(key);
    if (cached) return cached;
    const saved = newSavedSymbol(node.unit.identity.fullDesignation, rt.id, at);
    saved.definition = structuredClone(symbol.definition);
    repo.saveLibrary("SYMBOL", saved, null);
    saved.status = "PUBLISHED";
    saved.publishedAt = at;
    saved.contentVersion = 2;
    repo.saveLibrary("SYMBOL", saved, 1);
    store.catalogMarkImported("SYMBOL", saved.versionId, item.id, key);
    const result = repo.resolveSymbolPin(saved.versionId);
    symbolCache.set(key, result);
    return result;
  };
  const freeze = (node: OrbatNode): UnitProfile => {
    const local = organizationUnit(workspace, source.id, node);
    const profile: UnitProfile = {
      ...newUnitProfile(local.identity.fullDesignation, rt.id, at),
      schemaVersion: 2,
      defaultSymbol: pin(node),
    };
    // Every ORBAT node, including its root, is subordinate to the owning organization.
    // Stable only within this organization and this exact ORBAT node; never linked by a name.
    const h = repo.hash(`${item.id}:${source.id}:${node.nodeId}`);
    profile.unitProfileFamilyId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    profile.versionLabel = root.versionLabel;
    profile.identity = structuredClone(local.identity);
    profile.staff = structuredClone(local.staff);
    const children = nodes
      .filter((n) => n.parentNodeId === node.nodeId)
      .sort((a, b) => {
        const ai = layout.siblingOrder.indexOf(a.nodeId),
          bi = layout.siblingOrder.indexOf(b.nodeId);
        return (
          (ai < 0 ? nodes.indexOf(a) : ai) - (bi < 0 ? nodes.indexOf(b) : bi)
        );
      });
    if (children.length > 500)
      throw Error(
        "This unit exceeds the 500 immediate subordinates supported by organization imports.",
      );
    profile.standingSubordinates = children.map((child) => {
      const p = freeze(child);
      return {
        relationshipId: child.nodeId,
        unitProfileFamilyId: p.unitProfileFamilyId,
        unitProfileVersionId: p.unitProfileVersionId,
      };
    });
    repo.saveUnitProfile(profile, null);
    profile.status = "PUBLISHED";
    profile.publishedAt = at;
    profile.contentVersion = 2;
    repo.saveUnitProfile(profile, 1);
    store.catalogMarkImported(
      "ORGANIZATION",
      profile.unitProfileVersionId,
      item.id,
      repo.hash(canonical(profile)),
    );
    return profile;
  };
  const subordinate = freeze(nodes.find((n) => n.nodeId === rootNodeId)!);
  root.standingSubordinates = [
    {
      relationshipId: rootNodeId,
      unitProfileFamilyId: subordinate.unitProfileFamilyId,
      unitProfileVersionId: subordinate.unitProfileVersionId,
    },
  ];
}
