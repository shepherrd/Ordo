import { z } from "zod";
import { organizationOrbatSchema } from "./organization-orbat";
import {
  doctrineVersionSchema,
  type DoctrineVersion,
} from "./doctrine-builder";
import { savedSymbolVersionSchema, type SavedSymbolVersion } from "./symbology";
import {
  savedOrbatVersionSchema,
  orbatNodeSchema,
  m6Limits,
  type SavedOrbatVersion,
} from "./orbat";
import { editableOrbatSchema } from "./catalog-orbat";
import {
  unitProfileV2Schema,
  profileSymbol,
  type UnitProfile,
} from "./unit-profiles";

/** Editable library records. A save replaces content; it never creates a library version. */
export const catalogKindSchema = z.enum([
  "DOCTRINE",
  "ORGANIZATION",
  "SYMBOL",
  "ORBAT",
]);
export type CatalogKind = z.infer<typeof catalogKindSchema>;
const base = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
export const catalogItemSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("DOCTRINE"),
      content: z
        .object({
          stableKey: doctrineVersionSchema.shape.stableKey,
          description: doctrineVersionSchema.shape.description,
          author: doctrineVersionSchema.shape.author,
          config: doctrineVersionSchema.shape.config,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("ORGANIZATION"),
      content: z
        .object({
          identity: unitProfileV2Schema.shape.identity,
          staff: unitProfileV2Schema.shape.staff,
          standingSubordinates: unitProfileV2Schema.shape.standingSubordinates,
          defaultDoctrine: unitProfileV2Schema.shape.defaultDoctrine,
          roleMappings: unitProfileV2Schema.shape.roleMappings,
          insigniaAssetId: unitProfileV2Schema.shape.insigniaAssetId,
          defaultSymbol: unitProfileV2Schema.shape.defaultSymbol,
          orbatWorkspace: organizationOrbatSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("SYMBOL"),
      content: z
        .object({
          definition: savedSymbolVersionSchema.shape.definition,
          tags: savedSymbolVersionSchema.shape.tags,
          exchangeOrigin: savedSymbolVersionSchema.shape.exchangeOrigin,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("ORBAT"),
      content: z
        .object({
          rootNodeId: savedOrbatVersionSchema.shape.rootNodeId,
          nodes: z.array(orbatNodeSchema).max(m6Limits.nodes),
          layout: savedOrbatVersionSchema.shape.layout,
          tags: savedOrbatVersionSchema.shape.tags,
          exchangeOrigin: savedOrbatVersionSchema.shape.exchangeOrigin,
        })
        .strict(),
    })
    .strict(),
]);
export type CatalogItem = z.infer<typeof catalogItemSchema>;
export type CatalogEntry = { item: CatalogItem; editToken: string };
export type LegacyCatalogDocument =
  DoctrineVersion | UnitProfile | SavedSymbolVersion | SavedOrbatVersion;

/** Import every old record individually: no latest-version guess and no lost drafts. */
export function catalogItemFromLegacy(
  kind: CatalogKind,
  document: LegacyCatalogDocument,
): CatalogItem {
  const dates = {
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
  if (kind === "DOCTRINE") {
    const v = doctrineVersionSchema.parse(document);
    return catalogItemSchema.parse({
      ...dates,
      kind,
      id: v.doctrineVersionId,
      name: v.displayName,
      content: {
        stableKey: v.stableKey,
        description: v.description,
        author: v.author,
        config: v.config,
      },
    });
  }
  if (kind === "ORGANIZATION") {
    const v = document as UnitProfile;
    return catalogItemSchema.parse({
      ...dates,
      kind,
      id: v.unitProfileVersionId,
      name: v.identity.fullDesignation,
      content: {
        identity: v.identity,
        staff: v.staff,
        standingSubordinates: v.standingSubordinates,
        defaultDoctrine: v.defaultDoctrine,
        roleMappings: v.roleMappings,
        insigniaAssetId: v.insigniaAssetId,
        defaultSymbol: profileSymbol(v),
      },
    });
  }
  if (kind === "SYMBOL") {
    const v = savedSymbolVersionSchema.parse(document);
    return catalogItemSchema.parse({
      ...dates,
      kind,
      id: v.versionId,
      name: v.name,
      content: {
        definition: v.definition,
        tags: v.tags,
        ...(v.exchangeOrigin ? { exchangeOrigin: v.exchangeOrigin } : {}),
      },
    });
  }
  const v = editableOrbatSchema.parse(document);
  return catalogItemSchema.parse({
    ...dates,
    kind,
    id: v.versionId,
    name: v.name,
    content: {
      rootNodeId: v.rootNodeId,
      nodes: v.nodes,
      layout: v.layout,
      tags: v.tags,
      ...(v.exchangeOrigin ? { exchangeOrigin: v.exchangeOrigin } : {}),
    },
  });
}

/** Preserve stable staff IDs while removing the selected role from its actual uses. */
export function removeDoctrineStaff(
  item: Extract<CatalogItem, { kind: "DOCTRINE" }>,
  staffId: string,
) {
  const next = structuredClone(item),
    { doctrine, echelon } = next.content.config;
  doctrine.staff = doctrine.staff.filter((s) => s.id !== staffId);
  echelon.staffIds = echelon.staffIds.filter((id) => id !== staffId);
  for (const node of doctrine.catalog?.nodes ?? []) {
    node.responsibleStaff = node.responsibleStaff.filter(
      (id) => id !== staffId,
    );
    node.supportingStaff = node.supportingStaff.filter((id) => id !== staffId);
  }
  for (const annex of doctrine.annexCatalog) {
    if (annex.ownerId === staffId) annex.ownerId = null;
  }
  return next;
}
