import { z } from "zod";
import {
  unitIdentitySchema,
  staffConfigurationSchema,
  unitProfileSchema,
  unitProfileV2Schema,
  type UnitProfile,
} from "./unit-profiles";
import type { OrbatNode, SavedOrbatVersion } from "./orbat";
import { diagramFromSaved, type DiagramRequest } from "./diagram";

/** Personnel belong to the organization. Only structure and artwork come from the saved ORBAT. */
export const organizationUnitSchema = z
  .object({
    orbatId: z.string().uuid(),
    nodeId: z.string().uuid(),
    identity: unitIdentitySchema,
    staff: staffConfigurationSchema,
  })
  .strict();
export const organizationOrbatSchema = z
  .object({
    orbatId: z.string().uuid().nullable(),
    profiles: z.array(organizationUnitSchema).max(10000),
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys = value.profiles.map((p) => `${p.orbatId}:${p.nodeId}`);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: "custom",
        message:
          "Each ORBAT unit can have only one profile in this organization.",
      });
  });
export type OrganizationUnit = z.infer<typeof organizationUnitSchema>;
export type OrganizationOrbat = z.infer<typeof organizationOrbatSchema>;
export type OrganizationProfile = UnitProfile & {
  orbatWorkspace?: OrganizationOrbat;
};

// Authoring-only extension: historical UnitProfile and ORBAT schemas remain unchanged.
export const organizationProfileSchema = z
  .object({
    ...unitProfileV2Schema.shape,
    orbatWorkspace: organizationOrbatSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { orbatWorkspace: _workspace, ...profile } = value;
    const parsed = unitProfileSchema.safeParse(profile);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
export const recoverableOrganizationSchema = z.union([
  unitProfileSchema,
  organizationProfileSchema,
]);

export function organizationUnit(
  workspace: OrganizationOrbat | undefined,
  orbatId: string,
  node: OrbatNode,
): OrganizationUnit {
  const saved = workspace?.profiles.find(
    (p) => p.orbatId === orbatId && p.nodeId === node.nodeId,
  );
  if (saved) return saved;
  const identity = structuredClone(node.unit.identity);
  if (node.nameOverride) {
    identity.fullDesignation = node.nameOverride;
    identity.shortDesignation = "";
  }
  return {
    orbatId,
    nodeId: node.nodeId,
    identity,
    staff: { sections: [], positions: [] },
  };
}

/** Active units follow the assigned map; detached profiles remain organization-owned. */
export function organizationUnits(
  workspace: OrganizationOrbat | undefined,
  source?: { id: string; nodes: OrbatNode[] } | null,
) {
  const profiles = workspace?.profiles ?? [];
  const linked = source?.id === workspace?.orbatId ? source : null;
  const saved = new Map(
    profiles.filter((p) => p.orbatId === linked?.id).map((p) => [p.nodeId, p]),
  );
  const active =
    linked?.nodes.map(
      (node) =>
        saved.get(node.nodeId) ?? organizationUnit(undefined, linked.id, node),
    ) ?? [];
  const nodeIds = new Set(active.map((p) => p.nodeId));
  return {
    active,
    retained: profiles.filter(
      (p) => p.orbatId !== linked?.id || !nodeIds.has(p.nodeId),
    ),
  };
}

export function organizationDiagram(
  profile: OrganizationProfile,
  orbat: SavedOrbatVersion,
): DiagramRequest {
  const diagram = diagramFromSaved(orbat);
  const identities = new Map(
    profile.orbatWorkspace?.profiles
      .filter((p) => p.orbatId === orbat.versionId)
      .map((p) => [p.nodeId, p.identity]),
  );
  for (const node of diagram.nodes) {
    const identity = identities.get(node.id);
    if (!identity) continue;
    node.name = identity.shortDesignation || identity.fullDesignation;
    if (node.symbol) node.symbol.amplifiers.uniqueDesignation = node.name;
  }
  return diagram;
}
