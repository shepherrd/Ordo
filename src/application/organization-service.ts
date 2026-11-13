import { z } from "zod";
import {
  organizationProfileSchema,
  type OrganizationProfile,
} from "../domain/organization-orbat";
import { catalogItemFromLegacy } from "../domain/catalog";
import { catalogEditorDocument, type CatalogService } from "./catalog-service";

export const organizationCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("get"), id: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal("save"),
      profile: organizationProfileSchema,
      expectedContentVersion: z.number().int().positive(),
    })
    .strict(),
]);
export type OrganizationCommand = z.infer<typeof organizationCommandSchema>;

export function organizationDocument(
  catalog: CatalogService,
  id: string,
): OrganizationProfile {
  const { item } = catalog.store.catalogGet(id);
  if (item.kind !== "ORGANIZATION") throw Error("Choose an organization.");
  return {
    ...(catalogEditorDocument(item) as OrganizationProfile),
    ...(item.content.orbatWorkspace
      ? { orbatWorkspace: structuredClone(item.content.orbatWorkspace) }
      : {}),
  };
}

export function organizationCommand(
  catalog: CatalogService,
  input: unknown,
): OrganizationProfile {
  const command = organizationCommandSchema.parse(input);
  if (command.type === "get") return organizationDocument(catalog, command.id);
  const { orbatWorkspace, ...profile } = command.profile;
  const current = catalog.store.catalogGet(profile.unitProfileVersionId);
  if (
    current.item.kind !== "ORGANIZATION" ||
    Date.parse(current.item.updatedAt) !== command.expectedContentVersion
  )
    throw Error(
      "This organization changed. Reload it before saving your edits.",
    );
  const item = catalogItemFromLegacy("ORGANIZATION", profile);
  if (item.kind !== "ORGANIZATION") throw Error("Invalid organization.");
  item.createdAt = current.item.createdAt;
  if (orbatWorkspace) item.content.orbatWorkspace = orbatWorkspace;
  else if (current.item.content.orbatWorkspace)
    item.content.orbatWorkspace = structuredClone(
      current.item.content.orbatWorkspace,
    );
  // New assignments require an actual root. An already linked ORBAT may become empty later.
  if (
    orbatWorkspace?.orbatId &&
    orbatWorkspace.orbatId !== current.item.content.orbatWorkspace?.orbatId
  ) {
    const source = catalog.store.catalogGet(orbatWorkspace.orbatId).item;
    if (source.kind !== "ORBAT" || !source.content.nodes.length)
      throw Error("Add a root unit to the saved ORBAT before assigning it.");
  }
  catalog.execute({ type: "save", item, expectedToken: current.editToken });
  return organizationDocument(catalog, item.id);
}
