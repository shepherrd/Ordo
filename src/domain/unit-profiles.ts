import { z } from "zod";
import type { Operation, ResolvedConfig } from "./model";
import { savedSymbolPinSchema } from "./symbology";

const id = z.string().uuid();
const label = z.string().trim().min(1).max(160);
const text = z.string().max(40000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const functionalRoles = [
  "COMMAND",
  "EXECUTIVE",
  "PERSONNEL",
  "INTELLIGENCE",
  "OPERATIONS",
  "PLANS",
  "LOGISTICS",
  "SIGNAL",
  "FIRES",
  "ENGINEER",
  "MEDICAL",
  "CIVIL_AFFAIRS",
  "PUBLIC_AFFAIRS",
  "KNOWLEDGE_MANAGEMENT",
  "INSPECTOR_GENERAL",
  "CUSTOM",
] as const;
export const functionalRoleSchema = z.enum(functionalRoles);
export const unitIdentitySchema = z
  .object({
    fullDesignation: label,
    shortDesignation: z.string().max(160),
    abbreviation: z.string().max(80),
    unitType: z.string().max(160),
    echelon: z.string().max(160),
    service: z.string().max(160),
    component: z.string().max(160),
    callsign: z.string().max(160),
    headquarters: z.string().max(500),
    description: text,
    notes: text,
  })
  .strict();
export const staffSectionSchema = z
  .object({ sectionId: id, name: label, description: text })
  .strict();
export const staffPositionSchema = z
  .object({
    positionId: id,
    sectionId: id,
    title: label,
    shortTitle: z.string().max(160),
    functionalRole: functionalRoleSchema.nullable(),
    defaultForRole: z.boolean(),
    description: text,
    notes: text,
    rankGrade: z.string().max(160),
    incumbent: z
      .object({
        name: z.string().max(160),
        rank: z.string().max(160),
        contact: z.string().max(1000),
        notes: text,
      })
      .strict()
      .nullable(),
  })
  .strict();
export const staffConfigurationSchema = z
  .object({
    sections: z.array(staffSectionSchema).max(100),
    positions: z.array(staffPositionSchema).max(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const [key, ids] of [
      ["section", v.sections.map((s) => s.sectionId)],
      ["position", v.positions.map((p) => p.positionId)],
    ] as const)
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", message: `Duplicate ${key} identity` });
    for (const p of v.positions) {
      if (!v.sections.some((s) => s.sectionId === p.sectionId))
        ctx.addIssue({
          code: "custom",
          message: "Position section is missing",
        });
      if (p.defaultForRole && !p.functionalRole)
        ctx.addIssue({
          code: "custom",
          message: "A default position needs a functional role",
        });
    }
    for (const role of functionalRoles)
      if (
        v.positions.filter((p) => p.functionalRole === role && p.defaultForRole)
          .length > 1
      )
        ctx.addIssue({
          code: "custom",
          message: `Multiple defaults for ${role}`,
        });
  });
const doctrineSelectionSchema = z
  .object({
    doctrineFamilyId: id,
    doctrineVersionId: id,
    profileVersion: z.number().int().positive(),
    configuration: z
      .object({ id, version: z.number().int().positive() })
      .strict(),
  })
  .strict();
const roleMappingSchema = z
  .object({
    doctrineFamilyId: id,
    doctrineVersion: z.number().int().positive(),
    staffId: label,
    functionalRole: functionalRoleSchema,
  })
  .strict();
export const unitProfileV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    unitProfileFamilyId: id,
    unitProfileVersionId: id,
    versionLabel: z.string().regex(/^\d+\.\d+\.\d+$/),
    contentVersion: z.number().int().positive(),
    sourceKind: z.enum(["USER_CREATED", "IMPORTED"]),
    status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    retiredAt: z.string().datetime().nullable(),
    parentVersionId: id.nullable(),
    duplicatedFrom: z
      .object({ unitProfileFamilyId: id, unitProfileVersionId: id })
      .strict()
      .nullable(),
    identity: unitIdentitySchema,
    staff: staffConfigurationSchema,
    standingSubordinates: z
      .array(
        z
          .object({
            relationshipId: id,
            unitProfileFamilyId: id,
            unitProfileVersionId: id,
          })
          .strict(),
      )
      .max(500),
    defaultDoctrine: doctrineSelectionSchema.nullable(),
    roleMappings: z.array(roleMappingSchema).max(1000),
    insigniaAssetId: id.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.status === "DRAFT"
        ? !!v.publishedAt || !!v.retiredAt
        : !v.publishedAt || (v.status === "RETIRED") !== !!v.retiredAt
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid Unit Profile lifecycle dates",
      });
    if (
      new Set(v.standingSubordinates.map((r) => r.relationshipId)).size !==
        v.standingSubordinates.length ||
      new Set(v.standingSubordinates.map((r) => r.unitProfileFamilyId)).size !==
        v.standingSubordinates.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate standing child relationship",
      });
    if (
      v.standingSubordinates.some(
        (r) => r.unitProfileFamilyId === v.unitProfileFamilyId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "A profile cannot be its own subordinate",
      });
    if (
      new Set(
        v.roleMappings.map(
          (r) => `${r.doctrineFamilyId}:${r.doctrineVersion}:${r.staffId}`,
        ),
      ).size !== v.roleMappings.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate doctrine role mapping",
      });
  });
export const unitProfileV2Schema = z
  .object({
    ...unitProfileV1Schema.shape,
    schemaVersion: z.literal(2),
    defaultSymbol: savedSymbolPinSchema.nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const { defaultSymbol: _symbol, ...legacy } = v;
    const parsed = unitProfileV1Schema.safeParse({
      ...legacy,
      schemaVersion: 1,
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
export const unitProfileSchema = z.union([
  unitProfileV1Schema,
  unitProfileV2Schema,
]);
export type UnitProfile = z.infer<typeof unitProfileSchema>;
export const profileSymbol = (v: UnitProfile) =>
  v.schemaVersion === 2 ? v.defaultSymbol : null;
export type StaffPosition = z.infer<typeof staffPositionSchema>;
export type UnitIdentity = z.infer<typeof unitIdentitySchema>;
export const unitProfileProvenanceSchema = z
  .object({
    sourceUnitProfileFamilyId: id,
    sourceUnitProfileVersionId: id,
    sourceContentHash: digest,
    importId: id,
    sourceRelationshipPath: z.array(id).max(100),
  })
  .strict();
export const operationOrganizationBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    unitProfileFamilyId: id,
    unitProfileVersionId: id,
    versionLabel: label,
    contentHash: digest,
    identity: unitIdentitySchema,
    staff: staffConfigurationSchema,
    roleAdapterVersion: z.literal("staff-roles-v1"),
    resolvedRoleMappings: z
      .array(
        z
          .object({ staffId: label, functionalRole: functionalRoleSchema })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type OperationOrganizationBinding = z.infer<
  typeof operationOrganizationBindingSchema
>;
export const staffPositionOverrideSchema = z
  .object({
    productId: id,
    unitProfileVersionId: id,
    sectionId: id,
    positionId: id,
    functionalRole: functionalRoleSchema.nullable(),
  })
  .strict();

export function newUnitProfile(
  name: string,
  uid: () => string,
  now: string,
): UnitProfile {
  return {
    schemaVersion: 1,
    unitProfileFamilyId: uid(),
    unitProfileVersionId: uid(),
    versionLabel: "1.0.0",
    contentVersion: 1,
    sourceKind: "USER_CREATED",
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    retiredAt: null,
    parentVersionId: null,
    duplicatedFrom: null,
    identity: {
      fullDesignation: name,
      shortDesignation: "",
      abbreviation: "",
      unitType: "",
      echelon: "",
      service: "",
      component: "",
      callsign: "",
      headquarters: "",
      description: "",
      notes: "",
    },
    staff: { sections: [], positions: [] },
    standingSubordinates: [],
    defaultDoctrine: null,
    roleMappings: [],
    insigniaAssetId: null,
  };
}
export function deriveUnitProfile(
  source: UnitProfile,
  versionLabel: string,
  newFamily: boolean,
  uid: () => string,
  now: string,
): UnitProfile {
  const v = structuredClone(source);
  v.unitProfileVersionId = uid();
  v.versionLabel = versionLabel;
  v.contentVersion = 1;
  v.status = "DRAFT";
  v.createdAt = now;
  v.updatedAt = now;
  v.publishedAt = null;
  v.retiredAt = null;
  v.parentVersionId = newFamily ? null : source.unitProfileVersionId;
  if (newFamily) {
    v.unitProfileFamilyId = uid();
    v.sourceKind = "USER_CREATED";
    v.duplicatedFrom = {
      unitProfileFamilyId: source.unitProfileFamilyId,
      unitProfileVersionId: source.unitProfileVersionId,
    };
    const sections = new Map(v.staff.sections.map((s) => [s.sectionId, uid()]));
    v.staff.sections.forEach((s) => (s.sectionId = sections.get(s.sectionId)!));
    v.staff.positions.forEach((p) => {
      p.positionId = uid();
      p.sectionId = sections.get(p.sectionId)!;
    });
    v.standingSubordinates.forEach((r) => (r.relationshipId = uid()));
  }
  return unitProfileSchema.parse(v);
}
export function assertStandingHierarchy(
  root: UnitProfile,
  get: (id: string) => UnitProfile,
  allowRetired = false,
): void {
  let count = 0;
  const visit = (v: UnitProfile, path: Set<string>) => {
    if (++count > 10000 || path.size > 100)
      throw Error("Standing hierarchy exceeds supported size");
    if (path.has(v.unitProfileFamilyId))
      throw Error("Standing hierarchy cycle");
    const next = new Set([...path, v.unitProfileFamilyId]);
    for (const r of v.standingSubordinates) {
      const child = get(r.unitProfileVersionId);
      if (child.unitProfileFamilyId !== r.unitProfileFamilyId)
        throw Error("Standing subordinate family/version mismatch");
      if (
        child.status === "DRAFT" ||
        (!allowRetired && child.status === "RETIRED")
      )
        throw Error("Select an exact published subordinate version");
      visit(child, next);
    }
  };
  visit(root, new Set());
}
const bundledRoles: Record<string, z.infer<typeof functionalRoleSchema>> = {
  ops: "OPERATIONS",
  intel: "INTELLIGENCE",
  signal: "SIGNAL",
  fires: "FIRES",
  sustainment: "LOGISTICS",
  engineer: "ENGINEER",
  pa: "PUBLIC_AFFAIRS",
  civil: "CIVIL_AFFAIRS",
  km: "KNOWLEDGE_MANAGEMENT",
  ig: "INSPECTOR_GENERAL",
};
export function bindOrganization(
  v: UnitProfile,
  config: ResolvedConfig,
  hash: string,
): OperationOrganizationBinding {
  const bundled = [
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
  ].includes(config.doctrine.id);
  const mappings = config.doctrine.staff.flatMap((s) => {
    const role =
      v.roleMappings.find(
        (r) =>
          r.doctrineFamilyId === config.doctrine.id &&
          r.doctrineVersion === config.doctrine.version &&
          r.staffId === s.id,
      )?.functionalRole ?? (bundled ? bundledRoles[s.id] : undefined);
    return role ? [{ staffId: s.id, functionalRole: role }] : [];
  });
  return operationOrganizationBindingSchema.parse({
    schemaVersion: 1,
    unitProfileFamilyId: v.unitProfileFamilyId,
    unitProfileVersionId: v.unitProfileVersionId,
    versionLabel: v.versionLabel,
    contentHash: hash,
    identity: structuredClone(v.identity),
    staff: structuredClone(v.staff),
    roleAdapterVersion: "staff-roles-v1",
    resolvedRoleMappings: mappings,
  });
}
export function assertOrganizationState(op: Operation): void {
  const binding = op.operationOrganizationBinding;
  const overrides = op.staffPositionOverrides ?? [];
  if (new Set(overrides.map((o) => o.productId)).size !== overrides.length)
    throw Error("Duplicate staff override");
  for (const o of overrides) {
    const p = binding?.staff.positions.find(
      (p) => p.positionId === o.positionId,
    );
    if (
      !binding ||
      o.unitProfileVersionId !== binding.unitProfileVersionId ||
      !p ||
      p.sectionId !== o.sectionId ||
      p.functionalRole !== o.functionalRole ||
      ![op.orderId, ...op.attachments.map((a) => a.id)].includes(o.productId)
    )
      throw Error(
        "Staff override does not resolve within the operation's pinned organization",
      );
  }
  for (const u of op.units)
    if (
      u.sourceUnitProfile &&
      (u.id === u.sourceUnitProfile.sourceUnitProfileFamilyId ||
        u.id === u.sourceUnitProfile.sourceUnitProfileVersionId)
    )
      throw Error(
        "Source profile identity cannot be an operation unit identity",
      );
}
