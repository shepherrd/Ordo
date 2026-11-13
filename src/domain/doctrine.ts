import { z } from "zod";

const label = z.string().trim().min(1).max(240);
const prose = z.string().max(40000);
const uuid = z.string().uuid();
export const sourceClasses = [
  "FM5_TABLE_D2",
  "FM5_SAMPLE_FORMAT",
  "FUNCTIONAL_DOCTRINE",
  "ORDO_DEFAULT",
  "ORGANIZATION_OVERRIDE",
] as const;
export const sourceLabels: Record<(typeof sourceClasses)[number], string> = {
  FM5_TABLE_D2: "FM 5-0 • Table D-2",
  FM5_SAMPLE_FORMAT: "FM 5-0 • Sample format",
  FUNCTIONAL_DOCTRINE: "Functional doctrine",
  ORDO_DEFAULT: "Ordo software default",
  ORGANIZATION_OVERRIDE: "Organization override",
};
export const editorCapabilities = [
  "NARRATIVE_DOCUMENT",
  "FIVE_PARAGRAPH_ATTACHMENT",
  "TASK_ORGANIZATION_TREE",
  "MATRIX",
  "CHECKLIST",
  "PRODUCT_COLLECTION",
  "REPORT_CATALOG",
  "DISTRIBUTION_LIST",
  "SIGNAL_WORKSPACE",
  "PLACEHOLDER_GRAPHIC",
  "GENERIC_STRUCTURED_PRODUCT",
] as const;
export type EditorCapability = (typeof editorCapabilities)[number];
export function resolveEditor(hint: string): {
  capability: EditorCapability;
  fallback: boolean;
} {
  const known = editorCapabilities.includes(hint as EditorCapability);
  return {
    capability: known
      ? (hint as EditorCapability)
      : "GENERIC_STRUCTURED_PRODUCT",
    fallback: !known,
  };
}
export const sourceReferenceSchema = z
  .object({
    title: label,
    publicationIdentifier: label,
    editionDate: z.string().date(),
    changeNumber: z.number().int().nonnegative(),
    changeDate: z.string().date().nullable(),
    locator: label,
    url: z.string().url().optional(),
  })
  .strict();
const reference = sourceReferenceSchema;
export const doctrineNodeSchema = z
  .object({
    id: uuid,
    stableKey: label,
    nodeType: z.enum(["ANNEX", "APPENDIX", "TAB", "EXHIBIT"]),
    code: label,
    canonicalTitle: label,
    aliases: z.array(label),
    parentStableKey: label.nullable(),
    sourceClass: z.enum(sourceClasses),
    sourceReferences: z.array(reference),
    sourceNotes: prose,
    status: z.enum(["ACTIVE", "SPARE"]),
    formatType: z.enum([
      "STANDARD_FIVE_PARAGRAPH",
      "TASK_ORGANIZATION",
      "REPORT_CATALOG",
      "DISTRIBUTION_LIST",
      "CUSTOM",
    ]),
    responsibleStaff: z.array(label),
    supportingStaff: z.array(label),
    ownerBehavior: z.enum(["EXPLICIT", "INHERIT_PARENT"]),
    defaultApplicability: z.enum([
      "AS_REQUIRED",
      "AVAILABLE",
      "DEFAULT_INCLUDED",
      "DEFAULT_OMITTED",
    ]),
    purpose: prose,
    normalApplicabilityNotes: prose,
    echelonNotes: prose,
    editorHint: label,
    editorSourceClass: z.literal("ORDO_DEFAULT"),
    expectedContentTypes: z.array(label),
    primaryInputs: z.array(label),
    primaryOutputs: z.array(label),
    crossReferences: z.array(label),
    specialistDoctrineSources: z.array(label),
    organizationExtensionAllowed: z.boolean(),
    canonicalTableD2: z.boolean(),
    alternativeToStableKey: label.optional(),
    sourceVariants: z.array(
      z
        .object({
          title: label,
          sourceClass: z.enum(sourceClasses),
          sourceReferences: z.array(reference),
          note: prose,
        })
        .strict(),
    ),
  })
  .strict();
export type DoctrineNode = z.infer<typeof doctrineNodeSchema>;
export const factReferenceSchema = z
  .object({
    kind: z.enum([
      "unit",
      "task",
      "objective",
      "phase",
      "event",
      "signal",
      "net",
      "pace",
    ]),
    id: uuid,
  })
  .strict();
export type FactReference = z.infer<typeof factReferenceSchema>;
export const baseFieldSchema = z
  .object({
    id: uuid,
    stableKey: label,
    paragraphId: label,
    title: label,
    guidance: prose,
    parentStableKey: label.nullable(),
    bindings: z.array(factReferenceSchema.shape.kind),
    contentKind: z.enum([
      "group",
      "narrative",
      "task-collection",
      "structured-fields",
      "canonical-tasks",
    ]),
  })
  .strict();
export const doctrineCatalogSchema = z
  .object({
    profileKey: label,
    contentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    baseline: reference,
    nodes: z.array(doctrineNodeSchema).max(2000),
    baseFields: z.array(baseFieldSchema).max(200),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    const nodes = catalog.nodes;
    for (const field of ["id", "stableKey"] as const)
      if (new Set(nodes.map((n) => n[field])).size !== nodes.length)
        problem(`Duplicate doctrine ${field}`);
    const kinds = ["ANNEX", "APPENDIX", "TAB", "EXHIBIT"];
    for (const n of nodes) {
      const parent = nodes.find((p) => p.stableKey === n.parentStableKey);
      if (
        n.nodeType === "ANNEX"
          ? n.parentStableKey !== null
          : !parent ||
            kinds.indexOf(parent.nodeType) !== kinds.indexOf(n.nodeType) - 1
      )
        problem(`Invalid hierarchy or missing parent: ${n.stableKey}`);
      for (const key of n.crossReferences)
        if (!nodes.some((p) => p.stableKey === key))
          problem(`Unknown cross-reference: ${key}`);
      const alternative = nodes.find(
        (p) => p.stableKey === n.alternativeToStableKey,
      );
      if (
        n.alternativeToStableKey &&
        (!alternative ||
          alternative.alternativeToStableKey ||
          alternative.parentStableKey !== n.parentStableKey ||
          alternative.code !== n.code ||
          alternative.nodeType !== n.nodeType ||
          n.sourceClass !== "FM5_SAMPLE_FORMAT")
      )
        problem(`Invalid alternative: ${n.stableKey}`);
      for (const sibling of nodes.filter(
        (p) =>
          p.id !== n.id &&
          p.parentStableKey === n.parentStableKey &&
          p.code === n.code,
      ))
        if (
          n.alternativeToStableKey !== sibling.stableKey &&
          sibling.alternativeToStableKey !== n.stableKey
        )
          problem(`Duplicate sibling code: ${n.stableKey}`);
      if (
        n.status === "SPARE" &&
        (n.nodeType !== "ANNEX" || n.canonicalTitle !== "Spare")
      )
        problem(`Invalid spare: ${n.stableKey}`);
      if (
        n.nodeType === "ANNEX" &&
        ["O", "T", "X", "Y"].includes(n.code) &&
        n.status !== "SPARE" &&
        n.sourceClass !== "ORGANIZATION_OVERRIDE"
      )
        problem(
          `Repurposing a spare requires an organization override: ${n.code}`,
        );
      if (n.canonicalTableD2 !== (n.sourceClass === "FM5_TABLE_D2"))
        problem(`Canonical provenance mismatch: ${n.stableKey}`);
      if (n.sourceReferences.length === 0)
        problem(`Missing source reference: ${n.stableKey}`);
    }
    if (
      new Set(catalog.baseFields.map((f) => f.id)).size !==
        catalog.baseFields.length ||
      new Set(catalog.baseFields.map((f) => f.stableKey)).size !==
        catalog.baseFields.length
    )
      problem("Duplicate base field identity");
    for (const f of catalog.baseFields) {
      const seen = new Set([f.stableKey]);
      let parentKey = f.parentStableKey;
      while (parentKey) {
        const parent = catalog.baseFields.find(
          (p) => p.stableKey === parentKey,
        );
        if (
          !parent ||
          parent.paragraphId !== f.paragraphId ||
          seen.has(parentKey)
        ) {
          problem(`Invalid base field parent: ${f.stableKey}`);
          break;
        }
        seen.add(parentKey);
        parentKey = parent.parentStableKey;
      }
    }
  });
export const applicabilitySchema = z.enum(["UNDECIDED", "INCLUDED", "OMITTED"]);
export type Applicability = z.infer<typeof applicabilitySchema>;
const references = z.array(factReferenceSchema).max(1000);
const contentBase = { references };
export const productContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("narrative"),
      ...contentBase,
      sections: z
        .array(z.object({ id: uuid, title: label, text: prose }).strict())
        .max(100),
    })
    .strict(),
  z
    .object({
      kind: z.literal("matrix"),
      ...contentBase,
      columns: z.array(z.object({ id: uuid, title: label }).strict()).max(30),
      rows: z
        .array(z.object({ id: uuid, cells: z.record(uuid, prose) }).strict())
        .max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("checklist"),
      ...contentBase,
      items: z
        .array(
          z.object({ id: uuid, text: prose, checked: z.boolean() }).strict(),
        )
        .max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reports"),
      ...contentBase,
      reports: z
        .array(
          z
            .object({
              id: uuid,
              name: label,
              format: prose,
              submission: prose,
              recipientUnitId: uuid.nullable(),
              eventId: uuid.nullable(),
            })
            .strict(),
        )
        .max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("distribution"),
      ...contentBase,
      recipients: z
        .array(
          z
            .object({
              id: uuid,
              recipient: label,
              dutyPosition: prose,
              unitId: uuid.nullable(),
              location: prose,
              distributionPurpose: prose,
              copyNumber: prose,
              method: prose,
              acknowledgmentRequired: z.boolean(),
            })
            .strict(),
        )
        .max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("generic"),
      ...contentBase,
      fields: z
        .array(z.object({ id: uuid, label: label, value: prose }).strict())
        .max(500),
    })
    .strict(),
]);
export type ProductContent = z.infer<typeof productContentSchema>;
export const baseAuthoringSchema = z
  .object({
    fields: z
      .array(
        z
          .object({
            fieldId: uuid,
            text: prose,
            references,
            entries: z
              .array(
                z
                  .object({ id: uuid, label, value: prose, references })
                  .strict(),
              )
              .max(100)
              .optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
