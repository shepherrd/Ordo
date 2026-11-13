import { documentLayoutSchema } from "./document-layout";
import { retainedOrderGraphicSchema } from "./order-graphics";
import { z } from "zod";
import {
  eventScheduleSchema,
  timelineSettingsSchema,
  planningProgressSchema,
} from "./planning-schedule";
import { planningCardsSchema } from "./planning-cards";
import { operationSymbolStateSchema } from "./symbology";
import { orbatLayoutSchema, operationOrbatSourceSchema } from "./orbat";
import {
  operationOrganizationBindingSchema,
  staffPositionOverrideSchema,
  unitProfileProvenanceSchema,
  unitIdentitySchema,
} from "./unit-profiles";
import { doctrineModulesSchema, operationModulesSchema } from "./modules";
import {
  doctrineCatalogSchema,
  applicabilitySchema,
  productContentSchema,
  baseAuthoringSchema,
} from "./doctrine";

export const idSchema = z.string().uuid();
const label = z.string().trim().min(1).max(160);
const text = z.string().max(40000);
const ids = z
  .array(idSchema)
  .max(1000)
  .refine((v) => new Set(v).size === v.length, "Duplicate identifiers");
export const refSchema = z
  .object({ id: idSchema, version: z.number().int().positive() })
  .strict();
export type VersionRef = z.infer<typeof refSchema>;
export const metadataSchema = z
  .object({
    ownerId: z.string().nullable(),
    statusId: z.string(),
    references: z.array(z.string()).max(100),
    source: z
      .object({
        type: z.enum([
          "user-entry",
          "higher-hq",
          "guidance",
          "sop",
          "import",
          "derived",
        ]),
        note: text,
      })
      .strict(),
  })
  .strict();
export const metadata = (statusId = "draft"): Metadata => ({
  ownerId: null,
  statusId,
  references: [],
  source: { type: "user-entry", note: "" },
});
export type Metadata = z.infer<typeof metadataSchema>;
const staffSchema = z.object({ id: label, name: label }).strict();
export const doctrineSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    catalog: doctrineCatalogSchema.optional(),
    modules: doctrineModulesSchema.optional(),
    id: idSchema,
    version: z.number().int().positive(),
    name: label,
    productTypes: z
      .array(z.enum(["OPORD", "WARNORD", "FRAGO", "OPLAN"]))
      .min(1),
    paragraphs: z
      .array(
        z.object({ id: label, title: label, required: z.boolean() }).strict(),
      )
      .min(1),
    staff: z.array(staffSchema),
    statuses: z.array(z.object({ id: label, name: label }).strict()).min(1),
    annexCatalog: z.array(
      z
        .object({
          id: idSchema,
          code: label,
          title: label,
          editor: z.enum([
            "narrative",
            "task-organization",
            "operations",
            "signal",
          ]),
          ownerId: z.string().nullable(),
        })
        .strict(),
    ),
    validationRuleIds: z.array(z.string()),
    publicationRequiredStatus: z.string(),
    editingStatus: z.string(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const layout of v.modules?.layouts ?? [])
      if (
        layout.productId &&
        !v.catalog?.nodes.some((n) => n.id === layout.productId)
      )
        ctx.addIssue({
          code: "custom",
          message: "Module layout references an unknown doctrine product",
        });
    if ((v.schemaVersion === 2) !== !!v.catalog)
      ctx.addIssue({
        code: "custom",
        message:
          "Doctrine schema v2 requires a typed catalog; v1 must retain its original shape",
      });
    if (v.catalog) {
      const roots = v.catalog.nodes.filter((n) => n.nodeType === "ANNEX");
      if (
        roots.length !== v.annexCatalog.length ||
        roots.some(
          (n) =>
            !v.annexCatalog.some(
              (a) =>
                a.id === n.id &&
                a.code === n.code &&
                a.title === n.canonicalTitle,
            ),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Legacy annex index must match the canonical catalog roots",
        });
      for (const n of v.catalog.nodes)
        if (
          [...n.responsibleStaff, ...n.supportingStaff].some(
            (id) => !v.staff.some((s) => s.id === id),
          )
        )
          ctx.addIssue({
            code: "custom",
            message: "Unknown doctrine staff owner",
          });
      if (
        v.catalog.baseFields.some(
          (f) => !v.paragraphs.some((p) => p.id === f.paragraphId),
        )
      )
        ctx.addIssue({ code: "custom", message: "Unknown base paragraph" });
    }
    for (const key of [
      "paragraphs",
      "staff",
      "statuses",
      "annexCatalog",
    ] as const) {
      if (new Set(v[key].map((x) => x.id)).size !== v[key].length)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "IDs must be unique",
        });
    }
    if (
      new Set(v.annexCatalog.map((x) => x.code)).size !== v.annexCatalog.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["annexCatalog"],
        message: "Codes must be unique",
      });
    for (const annex of v.annexCatalog)
      if (annex.ownerId && !v.staff.some((s) => s.id === annex.ownerId))
        ctx.addIssue({ code: "custom", message: "Unknown annex owner" });
    if (!v.statuses.some((s) => s.id === v.publicationRequiredStatus))
      ctx.addIssue({ code: "custom", message: "Unknown publication status" });
    if (!v.statuses.some((s) => s.id === v.editingStatus))
      ctx.addIssue({ code: "custom", message: "Unknown editing status" });
  });
export type DoctrineProfile = z.infer<typeof doctrineSchema>;
export const echelonSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    version: z.number().int().positive(),
    name: label,
    staffIds: z.array(z.string()),
    suggestedAnnexCodes: z.array(z.string()),
  })
  .strict();
export const organizationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    version: z.number().int().positive(),
    name: label,
    doctrineRef: refSchema,
    echelonRef: refSchema,
    references: z.array(z.string()),
    branding: z.object({ heading: text }).strict(),
  })
  .strict();
export type EchelonProfile = z.infer<typeof echelonSchema>;
export type OrganizationProfile = z.infer<typeof organizationSchema>;
export const resolvedConfigSchema = z
  .object({
    doctrine: doctrineSchema,
    echelon: echelonSchema,
    organization: organizationSchema,
  })
  .strict();
export type ResolvedConfig = z.infer<typeof resolvedConfigSchema>;

const entity = { id: idSchema, name: label, metadata: metadataSchema };
export const unitSchema = z
  .object({
    ...entity,
    sourceUnitProfile: unitProfileProvenanceSchema.optional(),
    symbol: operationSymbolStateSchema.optional(),
    sourceOrbat: operationOrbatSourceSchema.optional(),
    profileIdentity: unitIdentitySchema
      .omit({ fullDesignation: true })
      .optional(),
    inTaskOrganization: z.boolean(),
    // Explicitly listed for task planning, even before the unit has a task.
    onTaskList: z.literal(true).optional(),
    parentUnitId: idSchema.nullable(),
  })
  .strict();
export const phaseSchema = z
  .object({ ...entity, sequence: z.number().int().nonnegative() })
  .strict();
export const objectiveSchema = z
  .object({ ...entity, description: text })
  .strict();
export const taskSchema = z
  .object({
    ...entity,
    unitId: idSchema.nullable(),
    objectiveId: idSchema.nullable(),
    phaseId: idSchema.nullable(),
    purpose: text,
  })
  .strict();
export const eventSchema = z
  .object({
    ...entity,
    schedule: eventScheduleSchema.optional(),
    at: z.string().datetime().nullable(),
    relativeToEventId: idSchema.nullable(),
    offsetMinutes: z.number().int(),
    phaseId: idSchema.nullable(),
  })
  .strict();
export const attachmentSchema = z
  .object({
    ...entity,
    kind: z.enum(["annex", "appendix", "tab", "exhibit"]),
    parentId: idSchema,
    code: label,
    catalogId: idSchema.nullable(),
    narrative: text,
    phaseIds: ids,
    unitIds: ids,
    required: z.boolean(),
    doctrineNodeId: idSchema.optional(),
    applicability: applicabilitySchema.optional(),
    content: productContentSchema.optional(),
  })
  .strict();
export const netSchema = z
  .object({
    ...entity,
    purpose: text,
    participantUnitIds: ids,
    phaseIds: ids,
    system: text,
    channel: text,
    callsign: text,
  })
  .strict();
export const paceSchema = z
  .object({
    ...entity,
    unitIds: ids,
    phaseIds: ids,
    primary: text,
    alternate: text,
    contingency: text,
    emergency: text,
    lostCommunications: text,
  })
  .strict();
import { briefingsSchema } from "./briefings";
import { whiteboardsSchema } from "./whiteboards";
export const operationSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    authoring: baseAuthoringSchema.optional(),
    modules: operationModulesSchema.optional(),
    planningCards: planningCardsSchema.optional(),
    planningProgress: planningProgressSchema.optional(),
    timeline: timelineSettingsSchema.optional(),
    briefings: briefingsSchema.optional(),
    whiteboards: whiteboardsSchema.optional(),
    orbatLayout: orbatLayoutSchema.optional(),
    id: idSchema,
    name: label,
    orderNumber: label,
    revision: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    demo: z.boolean(),
    doctrineRef: refSchema,
    organizationRef: refSchema,
    operationOrganizationBinding: operationOrganizationBindingSchema.optional(),
    staffPositionOverrides: z
      .array(staffPositionOverrideSchema)
      .max(1000)
      .optional(),
    echelonRef: refSchema,
    metadata: metadataSchema.extend({
      documentLayout: documentLayoutSchema.optional(),
    }),
    orderId: idSchema,
    sections: z.array(z.object({ id: label, summary: text }).strict()),
    units: z.array(unitSchema),
    phases: z.array(phaseSchema),
    objectives: z.array(objectiveSchema),
    tasks: z.array(taskSchema),
    events: z.array(eventSchema),
    attachments: z.array(attachmentSchema),
    signal: z
      .object({
        id: idSchema,
        concept: text,
        architecture: text,
        spectrumNotes: text,
        maintenanceNotes: text,
        nets: z.array(netSchema),
        pacePlans: z.array(paceSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const deck of v.briefings?.decks ?? [])
      for (const slide of deck.slides)
        if (
          slide.graphic?.kind === "image" &&
          (slide.graphic.asset.operationId !== v.id ||
            !slide.graphic.asset.mimeType.startsWith("image/"))
        )
          ctx.addIssue({
            code: "custom",
            path: ["briefings"],
            message: "Briefing images must belong to this operation",
          });
    const placements = (v.modules?.instances ?? []).flatMap((m) =>
      m.content.type === "PLANNING_CARDS" ? m.content.placements : [],
    );
    if (
      placements.length > 2000 ||
      new Set(placements.map((p) => p.id)).size !== placements.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["modules"],
        message:
          "Planning cards are limited to 2,000 uniquely identified placements",
      });
    if (
      v.metadata.documentLayout?.header.logo &&
      v.metadata.documentLayout.header.logo.operationId !== v.id
    )
      ctx.addIssue({
        code: "custom",
        path: ["metadata", "documentLayout", "header", "logo"],
        message: "Header logo must belong to this operation",
      });
    if ((v.schemaVersion === 2) !== !!v.authoring)
      ctx.addIssue({
        code: "custom",
        message: "Operation schema v2 requires structured authoring",
      });
    if (
      v.schemaVersion === 1 &&
      v.attachments.some(
        (a) => a.doctrineNodeId || a.applicability || a.content,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Milestone 2 authoring requires operation schema v2",
      });
  });
export type Operation = z.infer<typeof operationSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type RadioNet = z.infer<typeof netSchema>;
export type PacePlan = z.infer<typeof paceSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Unit = z.infer<typeof unitSchema>;

export const cardFields = [
  "purpose",
  "participants",
  "system",
  "channel",
  "callsign",
] as const;
export const exportProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    version: z.number().int().positive(),
    name: label,
    operationId: idSchema,
    product: z.enum(["opord", "communications-card"]),
    inclusion: z
      .object({
        audienceUnitIds: ids,
        phaseIds: ids,
        netIds: ids,
        netFields: z.array(z.enum(cardFields)),
        includeNetName: z.boolean().optional(),
        includePace: z.boolean(),
        includeLostCommunications: z.boolean(),
        paragraphIds: z.array(z.string()),
        attachmentIds: ids,
        packageScope: z.enum(["included", "selected"]).optional(),
      })
      .strict(),
    rendering: z
      .object({
        detail: z.enum(["full", "execution", "quick-reference"]),
        title: label,
      })
      .strict(),
  })
  .strict();
export type ExportProfile = z.infer<typeof exportProfileSchema>;
export const findingSchema = z
  .object({
    ruleId: z.string(),
    severity: z.enum(["error", "warning", "info"]),
    category: z.string(),
    entityId: z.string(),
    field: z.string(),
    message: z.string(),
    revision: z.number().int(),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;
export const approvalSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    operationId: idSchema,
    sourceRevision: z.number().int().positive(),
    actor: label,
    at: z.string().datetime(),
    note: text,
    scope: z.literal("OPORD"),
    origin: z.enum(["explicit-approval", "legacy-publication"]),
  })
  .strict();
export type RevisionApproval = z.infer<typeof approvalSchema>;
export const renderTemplateSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    version: z.number().int().positive(),
    name: label,
    product: z.enum(["opord", "communications-card"]),
    layout: z.enum(["order-sections", "signal-card"]),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();
export type RenderTemplate = z.infer<typeof renderTemplateSchema>;
export const publicationSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    id: idSchema,
    operationId: idSchema,
    orderId: idSchema,
    productType: z.enum(["OPORD", "WARNORD", "FRAGO", "OPLAN"]),
    orderNumber: label,
    version: z.number().int().positive(),
    publishedAt: z.string().datetime(),
    sourceRevision: z.number().int().positive(),
    approvalId: idSchema.optional(),
    approval: z
      .object({ actor: label, at: z.string().datetime(), note: text })
      .strict(),
    snapshot: operationSchema,
    config: resolvedConfigSchema,
    supersedesId: idSchema.nullable(),
  })
  .strict()
  .refine(
    (p) => p.schemaVersion === 1 || !!p.approvalId,
    "Publication requires its exact revision approval ID",
  );
export type Publication = z.infer<typeof publicationSchema>;
export const dependencySchema = z
  .object({ path: z.string(), canonicalValue: z.string() })
  .strict();
const legacyExportRecordSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    projectionVersion: z.number().int().positive(),
    rendererVersion: label,
    renderTemplateId: idSchema.optional(),
    renderTemplateVersion: z.number().int().positive().optional(),
    id: idSchema,
    operationId: idSchema,
    sourceRevision: z.number().int().positive(),
    sourcePublicationId: idSchema.nullable(),
    profile: exportProfileSchema,
    config: resolvedConfigSchema,
    generatedAt: z.string().datetime(),
    actor: label,
    dependencies: z.array(dependencySchema),
    html: z.string(),
  })
  .strict()
  .refine(
    (e) =>
      e.schemaVersion === 1 ||
      (!!e.renderTemplateId && !!e.renderTemplateVersion),
    "Export requires an exact render template version",
  );
export const exportRecordSchema = z.union([
  z
    .object({
      ...legacyExportRecordSchema.shape,
      schemaVersion: z.literal(7),
      rendererVersion: z.literal("html-v7"),
      projectionVersion: z.literal(6),
      renderTemplateId: idSchema,
      renderTemplateVersion: z.number().int().positive(),
      documentLayout: documentLayoutSchema.optional(),
      graphics: z.array(retainedOrderGraphicSchema).max(500),
      htmlHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      ...legacyExportRecordSchema.shape,
      schemaVersion: z.literal(6),
      rendererVersion: z.literal("html-v6"),
      projectionVersion: z.number().int().min(1).max(5),
      renderTemplateId: idSchema,
      renderTemplateVersion: z.number().int().positive(),
      documentLayout: documentLayoutSchema,
      graphics: z.array(retainedOrderGraphicSchema).max(500),
      htmlHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .refine(
      (e) => (e.projectionVersion === 5) === e.graphics.length > 0,
      "Graphic dependencies do not match this export",
    ),
  z
    .object({
      ...legacyExportRecordSchema.shape,
      schemaVersion: z.literal(5),
      rendererVersion: z.literal("html-v5"),
      projectionVersion: z.number().int().min(1).max(5),
      renderTemplateId: idSchema,
      renderTemplateVersion: z.number().int().positive(),
      graphics: z.array(retainedOrderGraphicSchema).max(500),
      htmlHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .refine(
      (e) => (e.projectionVersion === 5) === e.graphics.length > 0,
      "Graphic dependencies do not match this export",
    ),
  z
    .object({
      ...legacyExportRecordSchema.shape,
      schemaVersion: z.literal(4),
      rendererVersion: z.literal("html-v4"),
      projectionVersion: z.number().int().min(1).max(5),
      renderTemplateId: idSchema,
      renderTemplateVersion: z.number().int().positive(),
      graphics: z.array(retainedOrderGraphicSchema).max(500),
      htmlHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .refine(
      (e) => (e.projectionVersion === 5) === e.graphics.length > 0,
      "Graphic dependencies do not match this export",
    ),
  legacyExportRecordSchema.refine(
    (e) => e.projectionVersion !== 5,
    "Projection v5 requires a graphical export envelope",
  ),
  z
    .object({
      ...legacyExportRecordSchema.shape,
      schemaVersion: z.literal(3),
      projectionVersion: z.literal(5),
      rendererVersion: z.literal("html-v3"),
      renderTemplateId: idSchema,
      renderTemplateVersion: z.number().int().positive(),
      graphics: z.array(retainedOrderGraphicSchema).min(1).max(500),
      htmlHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export type ExportRecord = z.infer<typeof exportRecordSchema>;
export type Dependency = z.infer<typeof dependencySchema>;
export const preferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    timeDisplay: z.enum(["utc", "local"]),
    pageSize: z.enum(["letter", "a4"]),
    localActor: z.string().trim().min(1).max(160).optional(),
    lastOpenedOperationId: idSchema.nullable().optional(),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;
