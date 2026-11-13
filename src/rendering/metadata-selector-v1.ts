import raw from "./resources/metadata-0.2.14.json";
import overlay from "./resources/symbol-metadata-overlay-v1.json";
type Row = Record<string, string>;
export type MetadataSet = {
  symbolset: string;
  name: string;
  mainIcon: Row[];
  modifier1: Row[];
  modifier2: Row[];
};
/** Native selector adapter, never modifies licensed base tables or doctrine data.
 * Common modifiers stay in explicit three-digit controls, preventing truncation
 * when choosing a common modifier in a legacy two-digit sector control.
 */
export function metadataSelectorsV1(): Record<string, MetadataSet> {
  const data = structuredClone(raw) as unknown as Record<string, MetadataSet>;
  for (const [id, set] of Object.entries(data)) {
    if (!set.symbolset) {
      for (const [key, label] of [
        ["modifier1", "First Modifier"],
        ["modifier2", "Second Modifier"],
      ] as const)
        set[key] = set[key].filter(
          (r) => !overlay.hiddenValues.includes(r[label]),
        );
      continue;
    }
    if (id === overlay.mainInsertion.symbolSet) {
      const i = set.mainIcon.findIndex(
        (r) => r.Code === overlay.mainInsertion.afterCode,
      );
      if (i < 0) throw Error("Missing reviewed overlay insertion point");
      set.mainIcon.splice(i + 1, 0, { ...overlay.mainInsertion.row });
    }
    if (!overlay.omitUnspecifiedMainSets.includes(id))
      set.mainIcon.unshift({ Code: "000000", Entity: "Unspecified" });
    set.mainIcon = set.mainIcon.filter(
      (r) =>
        (!Object.hasOwn(r, "Geometric Rendering") ||
          r["Geometric Rendering"] === "Point") &&
        !["Entity", "Entity Type", "Entity Subtype"].some(
          (k) => r[k] === "{Disused}",
        ),
    );
    for (const [key, label, priority] of [
      ["modifier1", "First Modifier", overlay.priorityModifier1],
      ["modifier2", "Second Modifier", overlay.priorityModifier2],
    ] as const) {
      if (overlay.emptyModifierSets.includes(id)) {
        set[key] = [];
        continue;
      }
      set[key] = set[key]
        .filter((r) => !overlay.hiddenValues.includes(r[label]))
        .map((r) => (r.Capability ? { ...r, Category: r.Capability } : r))
        .sort((a, b) => {
          if (a[label] === priority) return b[label] === priority ? 0 : -1;
          if (b[label] === priority) return 1;
          // Locale-independent ordering, matching the source's uppercase comparison.
          if (!Object.hasOwn(a, "Category")) return 0;
          const ac = (a.Category || "").toUpperCase(),
            bc = (b.Category || "").toUpperCase();
          if (ac !== bc) return ac < bc ? -1 : 1;
          const an = (a[label] || "").toUpperCase(),
            bn = (b[label] || "").toUpperCase();
          return an < bn ? -1 : an > bn ? 1 : 0;
        });
      set[key].unshift({
        [label]: "Unspecified",
        Category: "",
        Code: "00",
        Remarks: "",
      });
    }
  }
  return data;
}
