import { z } from "zod";
import { eventScheduleSchema } from "./planning-schedule";
import { planningCardPlacementSchema } from "./planning-cards";
import { taskOrganizationPresentationSchema } from "./order-graphics";
import {
  factReferenceSchema,
  productContentSchema,
  sourceReferenceSchema,
} from "./doctrine";

const id = z.string().uuid();
const label = z.string().trim().min(1).max(160);
const text = z.string().max(40000);
export const safeUrl = z
  .string()
  .max(2000)
  .refine(
    (v) => /^(https?:\/\/|mailto:)[^\s<>]+$/i.test(v),
    "Use an http, https, or mailto link",
  );
export type RichNode = {
  type:
    | "doc"
    | "paragraph"
    | "heading"
    | "text"
    | "bulletList"
    | "orderedList"
    | "listItem"
    | "blockquote"
    | "hardBreak"
    | "image";
  text?: string;
  attrs?: {
    level?: number;
    start?: number;
    assetId?: string;
    alt?: string;
    title?: string | null;
  };
  marks?: {
    type: "bold" | "italic" | "underline" | "link";
    attrs?: {
      href: string;
      target?: string | null;
      rel?: string | null;
      class?: string | null;
    };
  }[];
  content?: RichNode[];
};
const richNodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "doc",
        "paragraph",
        "heading",
        "text",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "hardBreak",
        "image",
      ]),
      text: text.optional(),
      attrs: z
        .object({
          level: z.number().int().min(1).max(3).optional(),
          start: z.number().int().min(1).max(9999).optional(),
          assetId: id.optional(),
          alt: text.optional(),
          title: text.nullable().optional(),
        })
        .strict()
        .optional(),
      marks: z
        .array(
          z
            .object({
              type: z.enum(["bold", "italic", "underline", "link"]),
              attrs: z
                .object({
                  href: safeUrl,
                  target: z.enum(["_blank", "_self"]).nullable().optional(),
                  rel: z.string().max(100).nullable().optional(),
                  class: z.null().optional(),
                })
                .strict()
                .optional(),
            })
            .strict(),
        )
        .max(4)
        .optional(),
      content: z.array(richNodeSchema).max(2000).optional(),
    })
    .strict(),
);
export const richDocumentSchema = richNodeSchema.superRefine((doc, ctx) => {
  let count = 0;
  const check = (n: RichNode, depth: number, parent?: string) => {
    if (++count > 10000 || depth > 16) {
      ctx.addIssue({
        code: "custom",
        message: "Rich text exceeds nesting or node limit",
      });
      return;
    }
    if ((n.type === "doc" && parent) || (!parent && n.type !== "doc"))
      ctx.addIssue({
        code: "custom",
        message: "Rich document requires exactly one root",
      });
    if (
      n.type === "text"
        ? !n.text || !!n.content || !!n.attrs
        : n.text !== undefined
    )
      ctx.addIssue({ code: "custom", message: "Invalid rich text node" });
    if (n.type === "image" && (!n.attrs?.assetId || n.content || n.marks))
      ctx.addIssue({
        code: "custom",
        message: "Images require a managed asset ID",
      });
    if (n.type === "heading" && !n.attrs?.level)
      ctx.addIssue({ code: "custom", message: "Heading requires a level" });
    if (
      n.attrs &&
      Object.keys(n.attrs).some(
        (k) =>
          !(
            n.type === "heading"
              ? ["level"]
              : n.type === "orderedList"
                ? ["start"]
                : n.type === "image"
                  ? ["assetId", "alt", "title"]
                  : []
          ).includes(k),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Unsupported rich node attributes",
      });
    if (
      n.marks &&
      (n.type !== "text" ||
        n.marks.some((m) => (m.type === "link") !== !!m.attrs))
    )
      ctx.addIssue({ code: "custom", message: "Invalid rich text marks" });
    for (const child of n.content ?? []) {
      const allowed =
        n.type === "paragraph" || n.type === "heading"
          ? ["text", "hardBreak", "image"]
          : n.type === "bulletList" || n.type === "orderedList"
            ? ["listItem"]
            : n.type === "doc" ||
                n.type === "blockquote" ||
                n.type === "listItem"
              ? [
                  "paragraph",
                  "heading",
                  "bulletList",
                  "orderedList",
                  "blockquote",
                  "image",
                ]
              : [];
      if (!allowed.includes(child.type))
        ctx.addIssue({ code: "custom", message: "Invalid rich text nesting" });
      check(child, depth + 1, n.type);
    }
  };
  check(doc, 0);
});
export const emptyRich = (): RichNode => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
export const assetSchema = z
  .object({
    assetId: id,
    operationId: id.nullable(),
    doctrineVersionId: id.nullable(),
    unitProfileVersionId: id.optional(),
    originalFilename: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (v) => !/[\\/:\x00-\x1f]/.test(v) && v !== "." && v !== "..",
        "Asset filename must be a basename",
      ),
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/octet-stream",
    ]),
    sizeBytes: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.string().datetime(),
    storageReference: z.string().regex(/^asset:[0-9a-f-]{36}$/),
  })
  .strict()
  .refine(
    (v) =>
      [v.operationId, v.doctrineVersionId, v.unitProfileVersionId].filter(
        Boolean,
      ).length === 1,
    "Asset requires exactly one owner",
  )
  .refine(
    (v) => v.storageReference === `asset:${v.assetId}`,
    "Asset storage reference must match its ID",
  );
export type ManagedAsset = z.infer<typeof assetSchema>;
export const moduleTypes = [
  "PLAIN_TEXT",
  "RICH_TEXT",
  "KEY_VALUE",
  "TABLE",
  "MATRIX",
  "CHECKLIST",
  "TIMELINE",
  "CHART",
  "IMAGE",
  "IMAGE_GALLERY",
  "FILE_ATTACHMENT",
  "CANONICAL_REFERENCES",
  "PLANNING_CARDS",
  "TASK_ORGANIZATION",
  "SIGNAL_NET_MATRIX",
  "PACE",
  "REPORT_CATALOG",
  "DISTRIBUTION_LIST",
] as const;
export type ModuleType = (typeof moduleTypes)[number];
export const fieldTypes = [
  "SHORT_TEXT",
  "LONG_TEXT",
  "RICH_TEXT",
  "INTEGER",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
  "TIME",
  "DATETIME",
  "DURATION",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "UNIT_REFERENCE",
  "PHASE_REFERENCE",
  "EVENT_REFERENCE",
  "OBJECTIVE_REFERENCE",
  "TASK_REFERENCE",
  "NET_REFERENCE",
  "PRODUCT_REFERENCE",
  "STAFF_REFERENCE",
  "URL",
] as const;
export const moduleReferenceSchema = z.union([
  factReferenceSchema,
  z.object({ kind: z.literal("product"), id }).strict(),
]);
export type ModuleReference = z.infer<typeof moduleReferenceSchema>;
export const fieldValueSchema = z.union([
  z.string().max(40000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()).max(1000),
  richDocumentSchema,
  z.null(),
]);
export type FieldValue = z.infer<typeof fieldValueSchema>;
export const fieldDefinitionSchema = z
  .object({
    id,
    stableKey: label,
    label,
    help: text,
    type: z.enum(fieldTypes),
    required: z.boolean(),
    options: z.array(z.object({ id: label, label }).strict()).max(200),
    defaultValue: fieldValueSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.options.map((o) => o.id)).size !== v.options.length)
      ctx.addIssue({ code: "custom", message: "Duplicate select option IDs" });
    if (["SINGLE_SELECT", "MULTI_SELECT"].includes(v.type) && !v.options.length)
      ctx.addIssue({
        code: "custom",
        message: "Select fields require options",
      });
    if (!["SINGLE_SELECT", "MULTI_SELECT"].includes(v.type) && v.options.length)
      ctx.addIssue({
        code: "custom",
        message: "Options are only valid for selects",
      });
    const value = v.defaultValue;
    if (value !== undefined && value !== null && value !== "") {
      const valid =
        v.type === "RICH_TEXT"
          ? typeof value === "object" && !Array.isArray(value)
          : ["INTEGER", "DECIMAL", "DURATION"].includes(v.type)
            ? typeof value === "number" &&
              (v.type === "DECIMAL" || Number.isInteger(value))
            : v.type === "BOOLEAN"
              ? typeof value === "boolean"
              : v.type === "MULTI_SELECT"
                ? Array.isArray(value) &&
                  value.every((x) => v.options.some((o) => o.id === x))
                : v.type === "SINGLE_SELECT"
                  ? v.options.some((o) => o.id === value)
                  : typeof value === "string";
      if (!valid)
        ctx.addIssue({
          code: "custom",
          message: "Default value does not match its field type/options",
        });
      if (v.type.endsWith("_REFERENCE") && v.type !== "STAFF_REFERENCE")
        ctx.addIssue({
          code: "custom",
          message: "Operational references cannot be preset in doctrine",
        });
      if (v.type === "URL" && !safeUrl.safeParse(value).success)
        ctx.addIssue({ code: "custom", message: "Invalid default URL" });
    }
  });
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export const moduleConfigurationSchema = z
  .object({
    fields: z.array(fieldDefinitionSchema).max(100).optional(),
    columns: z.array(fieldDefinitionSchema).max(100).optional(),
    multiline: z.boolean().optional(),
    allowColumnOverride: z.boolean().optional(),
    chartType: z.enum(["BAR", "LINE", "PIE", "SCATTER"]).optional(),
    timelineMode: z.enum(["ABSOLUTE", "RELATIVE", "MIXED"]).optional(),
    referenceKinds: z
      .array(
        z.enum([
          "unit",
          "task",
          "objective",
          "phase",
          "event",
          "signal",
          "net",
          "pace",
          "product",
        ]),
      )
      .optional(),
    defaultAssetIds: z.array(id).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const fields of [v.fields ?? [], v.columns ?? []])
      if (
        new Set(fields.map((f) => f.id)).size !== fields.length ||
        new Set(fields.map((f) => f.stableKey)).size !== fields.length
      )
        ctx.addIssue({
          code: "custom",
          message: "Duplicate field identifiers",
        });
  });
export type ModuleConfiguration = z.infer<typeof moduleConfigurationSchema>;
export const moduleDefinitionSchema = z
  .object({
    moduleDefinitionId: id,
    stableKey: label,
    moduleType: label,
    title: label,
    description: text,
    guidance: text,
    position: z.number().int().nonnegative(),
    required: z.boolean(),
    defaultVisible: z.boolean(),
    configuration: moduleConfigurationSchema,
    provenance: z
      .object({
        sourceClass: z.enum([
          "FM5_TABLE_D2",
          "FM5_SAMPLE_FORMAT",
          "FUNCTIONAL_DOCTRINE",
          "ORDO_DEFAULT",
          "ORGANIZATION_OVERRIDE",
        ]),
        sourceReferences: z.array(sourceReferenceSchema).max(30),
        notes: text,
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.required && !moduleTypes.includes(v.moduleType as ModuleType))
      ctx.addIssue({
        code: "custom",
        message: `Unsupported required module type: ${v.moduleType}`,
      });
    if (
      (v.configuration.fields && v.moduleType !== "KEY_VALUE") ||
      (v.configuration.columns && !["TABLE", "MATRIX"].includes(v.moduleType))
    )
      ctx.addIssue({
        code: "custom",
        message: "Configuration does not match module type",
      });
  });
export type ModuleDefinition = z.infer<typeof moduleDefinitionSchema>;
const imageValue = z
  .object({
    id,
    assetId: id,
    title: text,
    caption: text,
    alt: text,
    width: z.enum(["small", "medium", "full"]),
    alignment: z.enum(["left", "center", "right"]),
  })
  .strict();
export const tableRowSchema = z
  .object({ id, cells: z.record(z.string().uuid(), fieldValueSchema) })
  .strict();
export const moduleContentSchema = z.discriminatedUnion("type", [
  // Explicit fallback for retained renderers that cannot compose a card block.
  // Current card output is dispatched to projection v6 before those renderers.
  z
    .object({
      type: z.literal("PLANNING_CARDS"),
      placements: z.array(planningCardPlacementSchema).max(2000),
      message: z.literal(
        "Planning cards require the current document renderer.",
      ),
    })
    .strict(),
  z.object({ type: z.literal("PLAIN_TEXT"), text }).strict(),
  z
    .object({ type: z.literal("RICH_TEXT"), document: richDocumentSchema })
    .strict(),
  z
    .object({
      type: z.literal("KEY_VALUE"),
      values: z.record(z.string().uuid(), fieldValueSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("TABLE"),
      rows: z.array(tableRowSchema).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("MATRIX"),
      rows: z.array(tableRowSchema).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("CHECKLIST"),
      items: z
        .array(
          z
            .object({
              id,
              text,
              checked: z.boolean(),
              notes: text,
              unitId: id.nullable(),
              staffId: z.string().nullable(),
              eventId: id.nullable(),
            })
            .strict(),
        )
        .max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("TIMELINE"),
      items: z
        .array(
          z
            .object({
              id,
              title: label,
              description: text,
              phaseId: id.nullable(),
              schedule: eventScheduleSchema.optional(),
              staffId: z.string().optional(),
              timing: z.discriminatedUnion("mode", [
                z
                  .object({
                    mode: z.literal("ABSOLUTE"),
                    at: z.string().datetime().nullable(),
                  })
                  .strict(),
                z
                  .object({
                    mode: z.literal("RELATIVE"),
                    referenceEventId: id,
                    withinModule: z.literal(true).optional(),
                    offsetMinutes: z.number().int().min(-5256000).max(5256000),
                  })
                  .strict(),
              ]),
            })
            .strict(),
        )
        .max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal("CHART"),
      chartType: z.enum(["BAR", "LINE", "PIE", "SCATTER"]),
      source: z.discriminatedUnion("mode", [
        z
          .object({
            mode: z.literal("DIRECT"),
            points: z
              .array(
                z
                  .object({
                    id,
                    label: z.string().max(160),
                    x: z.number().finite(),
                    value: z.number().finite(),
                  })
                  .strict(),
              )
              .max(2000),
          })
          .strict(),
        z
          .object({
            mode: z.literal("TABLE"),
            moduleInstanceId: id,
            categoryColumnId: id,
            valueColumnIds: z.array(id).min(1).max(10),
          })
          .strict(),
      ]),
    })
    .strict(),
  z.object({ type: z.literal("IMAGE"), image: imageValue.nullable() }).strict(),
  z
    .object({
      type: z.literal("IMAGE_GALLERY"),
      images: z.array(imageValue).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("FILE_ATTACHMENT"),
      assetId: id.nullable(),
      displayName: text,
      description: text,
    })
    .strict(),
  z
    .object({
      type: z.literal("CANONICAL_REFERENCES"),
      references: z.array(moduleReferenceSchema).max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal("TASK_ORGANIZATION"),
      presentation: taskOrganizationPresentationSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("SIGNAL_NET_MATRIX") }).strict(),
  z.object({ type: z.literal("PACE") }).strict(),
  z
    .object({
      type: z.literal("REPORT_CATALOG"),
      data: productContentSchema.refine((v) => v.kind === "reports"),
    })
    .strict(),
  z
    .object({
      type: z.literal("DISTRIBUTION_LIST"),
      data: productContentSchema.refine((v) => v.kind === "distribution"),
    })
    .strict(),
  z.object({ type: z.literal("UNSUPPORTED"), message: text }).strict(),
]);
export type ModuleContent = z.infer<typeof moduleContentSchema>;
export const moduleInstanceSchema = z
  .object({
    moduleInstanceId: id,
    operationId: id,
    productInstanceId: id,
    moduleDefinitionId: id.nullable(),
    localDefinition: moduleDefinitionSchema.optional(),
    origin: z.enum(["DOCTRINE", "OPERATION"]),
    content: moduleContentSchema,
    configurationOverride: moduleConfigurationSchema.optional(),
    recoveryConfiguration: moduleConfigurationSchema.optional(),
    position: z.number().int().nonnegative(),
    layoutState: z.enum(["ACTIVE", "REMOVED_BY_OPERATION_OVERRIDE"]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine(
    (v) =>
      v.origin === "DOCTRINE"
        ? !!v.moduleDefinitionId && !v.localDefinition
        : !v.moduleDefinitionId && !!v.localDefinition,
    "Module origin and definition binding disagree",
  );
export type ModuleInstance = z.infer<typeof moduleInstanceSchema>;
export const doctrineModulesSchema = z
  .object({
    schemaVersion: z.literal(1),
    doctrineVersionId: id,
    layouts: z
      .array(
        z
          .object({
            productId: id.nullable(),
            definitions: z.array(moduleDefinitionSchema).max(100),
          })
          .strict(),
      )
      .max(2001),
    assets: z.array(assetSchema).max(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.layouts.map((l) => l.productId)).size !== v.layouts.length)
      ctx.addIssue({ code: "custom", message: "Duplicate product layouts" });
    const defs = v.layouts.flatMap((l) => l.definitions);
    if (
      new Set(defs.map((d) => d.moduleDefinitionId)).size !== defs.length ||
      new Set(defs.map((d) => d.stableKey)).size !== defs.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate module definition identities",
      });
    for (const l of v.layouts)
      if (l.definitions.some((d, i) => d.position !== i))
        ctx.addIssue({
          code: "custom",
          message: "Module positions must follow their stored order",
        });
    for (const a of v.assets)
      if (a.doctrineVersionId !== v.doctrineVersionId || a.operationId)
        ctx.addIssue({
          code: "custom",
          message: "Doctrine asset owner mismatch",
        });
    for (const d of defs)
      for (const assetId of [
        ...(d.configuration.defaultAssetIds ?? []),
        ...referencedAssets(emptyModuleContent(d)),
      ])
        if (!v.assets.some((a) => a.assetId === assetId))
          ctx.addIssue({
            code: "custom",
            message: "Missing doctrine module asset",
          });
  });
export const operationModulesSchema = z
  .object({
    schemaVersion: z.literal(1),
    instances: z.array(moduleInstanceSchema).max(5000),
    assets: z.array(assetSchema).max(500),
  })
  .strict();
export function newModuleDefinition(
  type: string,
  idValue: string,
  position = 0,
): ModuleDefinition {
  return {
    moduleDefinitionId: idValue,
    stableKey: `module-${idValue}`,
    moduleType: type,
    title: type.replaceAll("_", " "),
    description: "",
    guidance: "",
    position,
    required: false,
    defaultVisible: true,
    configuration:
      type === "KEY_VALUE"
        ? { fields: [] }
        : type === "TABLE" || type === "MATRIX"
          ? { columns: [], allowColumnOverride: true }
          : {},
    provenance: {
      sourceClass: "ORDO_DEFAULT",
      sourceReferences: [],
      notes: "First-party Ordo module; not an external doctrinal requirement.",
    },
  };
}
export function emptyModuleContent(d: ModuleDefinition): ModuleContent {
  switch (d.moduleType) {
    case "PLAIN_TEXT":
      return { type: "PLAIN_TEXT", text: "" };
    case "RICH_TEXT":
      return { type: "RICH_TEXT", document: emptyRich() };
    case "KEY_VALUE":
      return {
        type: "KEY_VALUE",
        values: Object.fromEntries(
          (d.configuration.fields ?? [])
            .filter((f) => f.defaultValue !== undefined)
            .map((f) => [f.id, f.defaultValue!]),
        ),
      };
    case "TABLE":
    case "MATRIX":
      return { type: d.moduleType, rows: [] };
    case "CHECKLIST":
      return { type: "CHECKLIST", items: [] };
    case "TIMELINE":
      return { type: "TIMELINE", items: [] };
    case "CHART":
      return {
        type: "CHART",
        chartType: d.configuration.chartType ?? "BAR",
        source: { mode: "DIRECT", points: [] },
      };
    case "IMAGE":
      return { type: "IMAGE", image: null };
    case "IMAGE_GALLERY":
      return { type: "IMAGE_GALLERY", images: [] };
    case "FILE_ATTACHMENT":
      return {
        type: "FILE_ATTACHMENT",
        assetId: null,
        displayName: "",
        description: "",
      };
    case "CANONICAL_REFERENCES":
      return { type: "CANONICAL_REFERENCES", references: [] };
    case "PLANNING_CARDS":
      return {
        type: "PLANNING_CARDS",
        placements: [],
        message: "Planning cards require the current document renderer.",
      };
    case "TASK_ORGANIZATION":
    case "SIGNAL_NET_MATRIX":
    case "PACE":
      return { type: d.moduleType };
    case "REPORT_CATALOG":
      return {
        type: "REPORT_CATALOG",
        data: { kind: "reports", references: [], reports: [] },
      };
    case "DISTRIBUTION_LIST":
      return {
        type: "DISTRIBUTION_LIST",
        data: { kind: "distribution", references: [], recipients: [] },
      };
    default:
      return {
        type: "UNSUPPORTED",
        message: `Unsupported optional module: ${d.moduleType}`,
      };
  }
}
export function referencedAssets(content: ModuleContent): string[] {
  const ids: string[] = [];
  const walk = (n: RichNode) => {
    if (n.type === "image" && n.attrs?.assetId) ids.push(n.attrs.assetId);
    n.content?.forEach(walk);
  };
  if (content.type === "RICH_TEXT") walk(content.document);
  if (content.type === "KEY_VALUE")
    for (const v of Object.values(content.values))
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v);
  if (content.type === "TABLE" || content.type === "MATRIX")
    for (const row of content.rows)
      for (const v of Object.values(row.cells))
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v);
  if (content.type === "IMAGE" && content.image)
    ids.push(content.image.assetId);
  if (content.type === "IMAGE_GALLERY")
    ids.push(...content.images.map((i) => i.assetId));
  if (content.type === "FILE_ATTACHMENT" && content.assetId)
    ids.push(content.assetId);
  return [...new Set(ids)];
}
