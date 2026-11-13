import { z } from "zod";
import { reviewSemantics } from "./versions";
import {
  idSchema,
  refSchema,
  type Operation,
  type ResolvedConfig,
} from "../model";

const label = z.string().trim().min(1).max(500);
const prose = z.string().max(200000);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const endpointSelectorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("REVISION"),
      operationId: idSchema,
      revisionId: idSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("PUBLICATION"),
      operationId: idSchema,
      publicationId: idSchema,
    })
    .strict(),
]);
export type EndpointSelector = z.infer<typeof endpointSelectorSchema>;
export const endpointSchema = z
  .object({
    kind: z.enum(["REVISION", "PUBLICATION"]),
    operationId: idSchema,
    revisionId: idSchema,
    revisionNumber: z.number().int().positive(),
    publicationId: idSchema.nullable(),
    doctrineRef: refSchema,
    organizationRef: refSchema,
    unitProfileStateVersion: z.literal(1).optional(),
    symbologyStateVersion: z.literal(1).optional(),
    unitProfileProvenance: z
      .object({
        unitProfileFamilyId: idSchema,
        unitProfileVersionId: idSchema,
        versionLabel: label,
        contentHash: digest,
        designation: label,
      })
      .strict()
      .optional(),
    echelonRef: refSchema,
    stateHash: digest,
    configHash: digest,
    timestamp: z.string().datetime(),
    operationName: label,
    label,
  })
  .strict()
  .refine(
    (e) => (e.kind === "PUBLICATION") === !!e.publicationId,
    "Endpoint publication identity does not match its kind",
  );
export type ComparisonEndpoint = z.infer<typeof endpointSchema>;
export type ResolvedEndpoint = {
  endpoint: ComparisonEndpoint;
  operation: Operation;
  config: ResolvedConfig;
};
export const categories = [
  "OPERATION_METADATA",
  "BASE_ORDER",
  "TASK_ORGANIZATION",
  "TASK",
  "OBJECTIVE",
  "PHASE",
  "EVENT",
  "SIGNAL",
  "PRODUCT_APPLICABILITY",
  "RESPONSIBLE_STAFF",
  "MODULE_LAYOUT",
  "MODULE_CONTENT",
  "ASSET",
  "REFERENCE",
  "OTHER",
  "SYMBOL",
  "PROVENANCE",
  "PRESENTATION",
] as const;
export const changeTypes = [
  "ADDED",
  "REMOVED",
  "MODIFIED",
  "MOVED",
  "RELINKED",
  "CONFIGURATION_CHANGED",
] as const;
export type SemanticValue =
  | null
  | string
  | number
  | boolean
  | SemanticValue[]
  | { [key: string]: SemanticValue };
const valueSchema: z.ZodType<SemanticValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.string().max(200000),
    z.number().finite(),
    z.boolean(),
    z.array(valueSchema).max(20000),
    z.record(z.string().max(500), valueSchema),
  ]),
);
export const sourceLocationSchema = z
  .object({
    page: z.enum([
      "overview",
      "base",
      "units",
      "tasks",
      "phases",
      "events",
      "signal",
      "attachment",
      "doctrine",
    ]),
    id: z.string().max(160).nullable(),
    moduleInstanceId: idSchema.nullable(),
  })
  .strict();
export const changeSchema = z
  .object({
    changeId: idSchema,
    m6Kind: z
      .enum([
        "SYMBOL_BASE",
        "SYMBOL_OVERRIDE",
        "SYMBOL_BINDING",
        "SYMBOL_PROVENANCE",
        "ORBAT_SOURCE",
        "ORBAT_LAYOUT",
        "PRODUCT_PRESENTATION",
      ])
      .optional(),
    semanticFingerprint: digest,
    changeType: z.enum(changeTypes),
    category: z.enum(categories),
    operationId: idSchema,
    entityType: label,
    entityId: z.string().min(1).max(160),
    productId: idSchema.nullable(),
    moduleInstanceId: idSchema.nullable(),
    moduleDefinitionId: idSchema.nullable(),
    fieldPath: z.string().min(1).max(2000),
    humanSummary: prose,
    beforeValue: valueSchema,
    afterValue: valueSchema,
    beforeDisplay: prose,
    afterDisplay: prose,
    sourceLabel: label,
    targetLabel: label,
    directProductReferences: z.array(idSchema),
    canonicalEntityReferences: z.array(z.string().max(200)),
    location: sourceLocationSchema,
    detailKind: z.enum([
      "value",
      "text",
      "rich",
      "cell",
      "sequence",
      "reference",
      "asset",
    ]),
  })
  .strict()
  .superRefine((c, ctx) => {
    const expected =
      c.m6Kind === "ORBAT_LAYOUT" || c.m6Kind === "PRODUCT_PRESENTATION"
        ? "PRESENTATION"
        : c.m6Kind === "SYMBOL_PROVENANCE" || c.m6Kind === "ORBAT_SOURCE"
          ? "PROVENANCE"
          : c.m6Kind
            ? "SYMBOL"
            : null;
    if (
      (expected && expected !== c.category) ||
      (!expected &&
        ["PRESENTATION", "PROVENANCE", "SYMBOL"].includes(c.category))
    )
      ctx.addIssue({
        code: "custom",
        message: "M6 change kind and category must match",
      });
  });
export type ChangeRecord = z.infer<typeof changeSchema>;
export const impactSchema = z
  .object({
    id: digest,
    changeIds: z.array(idSchema).min(1),
    kind: z.enum([
      "PRODUCT",
      "MODULE",
      "PREVIEW",
      "EXPORT",
      "PUBLICATION_DIVERGENCE",
      "EFFECTIVE_OWNER",
    ]),
    targetId: z.string().min(1).max(200),
    productId: idSchema.nullable(),
    label,
    reason: prose,
    chain: z.array(label).min(2).max(50),
    beforeDisplay: prose,
    afterDisplay: prose,
    dependencyPaths: z.array(z.string().max(2000)),
    baselineOutdated: z.boolean().nullable(),
    targetOutdated: z.boolean().nullable(),
    compatibility: z.enum([
      "supported",
      "unresolved",
      "unsupported-projection",
    ]),
  })
  .strict();
export type ChangeImpact = z.infer<typeof impactSchema>;
export const comparisonSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    diffEngineVersion: z.enum([
      "diff-engine-v1",
      "diff-engine-v2",
      "diff-engine-v3",
    ]),
    impactEngineVersion: z.enum(["impact-v1", "impact-v2", "impact-v3"]),
    baseline: endpointSchema,
    target: endpointSchema,
    changes: z.array(changeSchema).max(100000),
    impacts: z.array(impactSchema).max(100000),
    analyzedExportIds: z.array(idSchema),
    diagnostics: z
      .array(
        z
          .object({
            artifactId: idSchema,
            code: z.enum(["UNSUPPORTED_PROJECTION"]),
            message: prose,
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      reviewSemantics[c.diffEngineVersion].impact !== c.impactEngineVersion ||
      reviewSemantics[c.diffEngineVersion].schemaVersion !== c.schemaVersion ||
      (c.diffEngineVersion !== "diff-engine-v3" &&
        c.changes.some(
          (x) =>
            x.m6Kind ||
            ["SYMBOL", "PROVENANCE", "PRESENTATION"].includes(x.category),
        ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Comparison semantics versions must match",
      });
    if (
      c.baseline.operationId !== c.target.operationId ||
      c.baseline.revisionNumber > c.target.revisionNumber
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Compare saved states of the same operation in chronological order",
      });
    const ids = new Set(c.changes.map((x) => x.changeId));
    if (
      ids.size !== c.changes.length ||
      new Set(c.changes.map((x) => x.semanticFingerprint)).size !==
        c.changes.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate change identity" });
    if (
      c.changes.some((x) => x.operationId !== c.baseline.operationId) ||
      c.impacts.some((x) => x.changeIds.some((id) => !ids.has(id)))
    )
      ctx.addIssue({ code: "custom", message: "Detached change or impact" });
    if (
      new Set(c.impacts.map((x) => x.id)).size !== c.impacts.length ||
      new Set(c.analyzedExportIds).size !== c.analyzedExportIds.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate impact or export identity",
      });
    if (
      c.impacts.some(
        (x) => x.kind === "EXPORT" && !c.analyzedExportIds.includes(x.targetId),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Impact refers to an unanalyzed export",
      });
    if (c.diagnostics.some((d) => !c.analyzedExportIds.includes(d.artifactId)))
      ctx.addIssue({
        code: "custom",
        message: "Diagnostic refers to an unanalyzed export",
      });
  });
export type Comparison = z.infer<typeof comparisonSchema>;
export type Hash = (canonicalText: string) => string;
export function canonicalValue(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalValue).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalValue((v as Record<string, unknown>)[k])}`,
    )
    .join(",")}}`;
}
export const equalValue = (a: unknown, b: unknown) =>
  canonicalValue(a) === canonicalValue(b);
export const semanticValue = (v: unknown): SemanticValue =>
  JSON.parse(canonicalValue(v));
export const fingerprintId = (hash: string) =>
  `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
