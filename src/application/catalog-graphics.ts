import { graphicExportCommandSchema } from "./graphic-export-service";
import { CatalogService } from "./catalog-service";
import { graphicStaleness, type GraphicStaleness } from "./graphic-staleness";
import type { Repository } from "./ports";
import type { GraphicExportRecord } from "../domain/graphic-exports";
import type { SavedSymbolVersion } from "../domain/symbology";
import type { SavedOrbatVersion } from "../domain/orbat";

export function catalogGraphicCommand(input: unknown, catalog: CatalogService) {
  const command = graphicExportCommandSchema.parse(input),
    s = command.source;
  if (s.kind !== "OPERATION") {
    const { item } = catalog.store.catalogGet(s.versionId);
    if (item.kind !== (s.kind === "SAVED_SYMBOL" ? "SYMBOL" : "ORBAT"))
      throw Error("Graphic source does not match its catalog.");
    if (Date.parse(item.updatedAt) !== s.expectedContentVersion)
      throw Error("Save or reload this item before exporting.");
    s.versionId = catalog.snapshot(s.versionId);
    s.expectedContentVersion = 2;
  }
  return command;
}
/** Reuse the retained dependency semantics, substituting only current consumed content. */
export function catalogGraphicStaleness(
  record: GraphicExportRecord,
  repo: Repository,
  catalog: CatalogService,
): GraphicStaleness {
  if (record.source.kind === "OPERATION") return graphicStaleness(record, repo);
  const source = record.source,
    itemId = catalog.store.catalogSnapshotOrigin(source.ref.versionId);
  if (!itemId) return graphicStaleness(record, repo);
  const entry = catalog.store.catalogFind(itemId);
  if (!entry)
    return {
      outdated: null,
      changedPaths: [],
      comparedWith: "EXACT_LIBRARY_VERSION",
      reason:
        "The source catalog item was deleted. This export retains its original snapshot.",
    };
  const snapshot = {
    ...source.snapshot,
    ...entry.item.content,
    name: entry.item.name,
  };
  // Identity, timestamps and schema belong to the retained consumption snapshot.
  // Editing an unrelated library entry cannot affect these dependencies.
  const view = new Proxy(repo, {
    get(target, key) {
      if (key === "getSymbol" && source.kind === "SAVED_SYMBOL")
        return (id: string) =>
          id === source.ref.versionId
            ? (snapshot as SavedSymbolVersion)
            : target.getSymbol(id);
      if (key === "getOrbat" && source.kind === "SAVED_ORBAT")
        return (id: string) =>
          id === source.ref.versionId
            ? (snapshot as SavedOrbatVersion)
            : target.getOrbat(id);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return graphicStaleness(record, view);
}
