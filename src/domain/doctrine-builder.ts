import { z } from "zod";
import { resolvedConfigSchema, type ResolvedConfig } from "./model";
import { assetSchema, moduleTypes, type ModuleType } from "./modules";

const label = z.string().trim().min(1).max(160);
export const doctrineVersionSchema = z
  .object({
    doctrineFamilyId: z.string().uuid(),
    doctrineVersionId: z.string().uuid(),
    stableKey: label,
    displayName: label,
    description: z.string().max(40000),
    versionLabel: z.string().regex(/^\d+\.\d+\.\d+$/),
    schemaVersion: z.literal(1),
    contentVersion: z.number().int().positive(),
    sourceKind: z.enum(["BUNDLED", "USER_CREATED", "IMPORTED"]),
    status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    publishedAt: z.string().datetime().nullable(),
    retiredAt: z.string().datetime().nullable(),
    parentVersionId: z.string().uuid().nullable(),
    duplicatedFromVersionId: z.string().uuid().nullable(),
    author: z.string().max(160),
    notes: z.string().max(40000),
    config: resolvedConfigSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.config.organization.doctrineRef.id !== v.config.doctrine.id ||
      v.config.organization.doctrineRef.version !== v.config.doctrine.version ||
      v.config.organization.echelonRef.id !== v.config.echelon.id ||
      v.config.organization.echelonRef.version !== v.config.echelon.version
    )
      ctx.addIssue({
        code: "custom",
        message: "Doctrine configuration profile pins disagree",
      });
    if (
      v.config.doctrine.id !== v.doctrineFamilyId ||
      v.config.doctrine.name !== v.displayName
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Doctrine family/display metadata does not match its configuration",
      });
    if (
      v.config.doctrine.modules &&
      v.config.doctrine.modules.doctrineVersionId !== v.doctrineVersionId
    )
      ctx.addIssue({
        code: "custom",
        message: "Module composition belongs to a different doctrine version",
      });
    if (
      v.status === "DRAFT"
        ? !!v.publishedAt || !!v.retiredAt
        : !v.publishedAt || (v.status === "RETIRED") !== !!v.retiredAt
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid doctrine lifecycle dates",
      });
    if (v.sourceKind === "BUNDLED" && v.status !== "PUBLISHED")
      ctx.addIssue({
        code: "custom",
        message: "Bundled doctrine is immutable",
      });
  });
export type DoctrineVersion = z.infer<typeof doctrineVersionSchema>;
export function bundledVersion(config: ResolvedConfig): DoctrineVersion {
  const at = "2026-10-01T00:00:00.000Z";
  return doctrineVersionSchema.parse({
    doctrineFamilyId: config.doctrine.id,
    doctrineVersionId: config.doctrine.id,
    stableKey: config.doctrine.catalog?.profileKey ?? "ordo-starter",
    displayName: config.doctrine.name,
    description: "Bundled immutable doctrine. Duplicate to customize.",
    versionLabel: config.doctrine.catalog?.contentVersion ?? "1.0.0",
    schemaVersion: 1,
    contentVersion: 1,
    sourceKind: "BUNDLED",
    status: "PUBLISHED",
    createdAt: at,
    updatedAt: at,
    publishedAt: at,
    retiredAt: null,
    parentVersionId: null,
    duplicatedFromVersionId: null,
    author: "Ordo",
    notes: "Original configuration retained exactly.",
    config,
  });
}
export function createDoctrineDraft(
  source: DoctrineVersion,
  familyId: string,
  versionId: string,
  profileVersion: number,
  name: string,
  versionLabel: string,
  now: string,
  newFamily: boolean,
): DoctrineVersion {
  const config = structuredClone(source.config);
  config.doctrine.id = familyId;
  config.doctrine.version = profileVersion;
  config.doctrine.name = name;
  config.echelon.id = familyId;
  config.echelon.version = profileVersion;
  config.organization.id = familyId;
  config.organization.version = profileVersion;
  config.organization.name = name;
  config.organization.doctrineRef = { id: familyId, version: profileVersion };
  config.organization.echelonRef = { id: familyId, version: profileVersion };
  config.doctrine.modules = {
    schemaVersion: 1,
    doctrineVersionId: versionId,
    layouts: structuredClone(source.config.doctrine.modules?.layouts ?? []),
    assets: [],
  };
  return {
    ...structuredClone(source),
    doctrineFamilyId: familyId,
    doctrineVersionId: versionId,
    stableKey: newFamily ? `doctrine-${familyId}` : source.stableKey,
    displayName: name,
    versionLabel,
    contentVersion: 1,
    sourceKind: "USER_CREATED",
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    retiredAt: null,
    parentVersionId: newFamily ? null : source.doctrineVersionId,
    duplicatedFromVersionId: newFamily ? source.doctrineVersionId : null,
    config,
  };
}
export function syncDoctrineIndex(v: DoctrineVersion): void {
  v.config.doctrine.name = v.displayName;
  v.config.organization.name = v.displayName;
  const nodes = v.config.doctrine.catalog?.nodes;
  if (nodes)
    v.config.doctrine.annexCatalog = nodes
      .filter((n) => n.nodeType === "ANNEX")
      .map((n) => ({
        id: n.id,
        code: n.code,
        title: n.canonicalTitle,
        editor:
          n.editorHint === "TASK_ORGANIZATION_TREE"
            ? "task-organization"
            : n.editorHint === "SIGNAL_WORKSPACE"
              ? "signal"
              : "narrative",
        ownerId: n.responsibleStaff[0] ?? null,
      }));
  for (const l of v.config.doctrine.modules?.layouts ?? [])
    l.definitions.forEach((d, i) => (d.position = i));
}
export function assertPublishableDoctrine(v: DoctrineVersion): void {
  doctrineVersionSchema.parse(v);
  if (v.status !== "DRAFT" || v.sourceKind === "BUNDLED")
    throw Error("Only a custom draft can be published");
  for (const layout of v.config.doctrine.modules?.layouts ?? [])
    for (const d of layout.definitions) {
      if (d.required && !moduleTypes.includes(d.moduleType as ModuleType))
        throw Error(`Unsupported required module: ${d.moduleType}`);
    }
}
export const doctrinePackageSchema = z
  .object({
    format: z.literal("ordo-doctrine"),
    schemaVersion: z.literal(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    doctrine: doctrineVersionSchema,
    assets: z
      .array(
        z
          .object({
            metadata: assetSchema,
            base64: z
              .string()
              .max(14 * 1024 * 1024)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type DoctrinePackage = z.infer<typeof doctrinePackageSchema>;
