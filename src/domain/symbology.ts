import { archivedId } from "./archived-format";
import { z } from "zod";
import { exchangeOriginSchema } from "./exchange-origin";

export const symbolId = z.string().uuid();
export const symbolDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const symbolLabel = z.string().trim().min(1).max(160);
const amplifier = z.string().max(500);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const exactLibraryRefSchema = z
  .object({
    familyId: symbolId,
    versionId: symbolId,
    contentHash: symbolDigest,
  })
  .strict();
export const renderProfileRefSchema = z
  .object({ id: symbolLabel, version: z.number().int().positive() })
  .strict();
export const symbolOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MANUAL") }).strict(),
  z
    .object({
      kind: z.literal("CATALOG"),
      catalogId: symbolLabel,
      release: symbolLabel,
      catalogHash: symbolDigest,
      entryId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("DICTIONARY"),
      datasetId: symbolId,
      release: symbolLabel,
      datasetHash: symbolDigest,
      entryId: symbolId,
    })
    .strict(),
  z
    .object({
      kind: z.literal("IMPORT"),
      fileHash: symbolDigest,
      importerVersion: symbolLabel,
      originalCode: z.string().max(100),
    })
    .strict(),
  z
    .object({ kind: z.literal("SAVED_SYMBOL"), source: exactLibraryRefSchema })
    .strict(),
]);
export const symbolCodeSchema = z.discriminatedUnion("dialect", [
  z
    .object({
      dialect: z.literal("NUMERIC"),
      sidc: z.string().regex(/^(?:\d{20}|\d{30})$/),
      assertedStandard: z.enum(["MIL_STD_2525E", "APP6E", "UNVERIFIED"]),
      sourceConvention: z.union([
        z.enum(["NUMERIC_13", "NATIVE", "IMPORTED"]),
        archivedId("numeric"),
      ]),
    })
    .strict(),
  z
    .object({
      dialect: z.literal("LETTER"),
      sidc: z.string().regex(/^[A-Z0-9*\-]{12,15}$/),
      assertedStandard: z.enum([
        "MIL_STD_2525B",
        "MIL_STD_2525C",
        "APP6B",
        "UNVERIFIED",
      ]),
      sourceConvention: z.union([
        z.enum(["LETTER_CODE", "NATIVE", "IMPORTED"]),
        archivedId("letter"),
      ]),
    })
    .strict(),
]);
export const militarySymbolDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    definitionId: symbolId,
    code: symbolCodeSchema,
    amplifiers: z
      .object({
        quantity: amplifier.optional(),
        reinforcedReduced: amplifier.optional(),
        staffComments: amplifier.optional(),
        additionalInformation: amplifier.optional(),
        evaluationRating: amplifier.optional(),
        combatEffectiveness: amplifier.optional(),
        signatureEquipment: amplifier.optional(),
        higherFormation: amplifier.optional(),
        hostile: amplifier.optional(),
        iffSif: amplifier.optional(),
        uniqueDesignation: amplifier.optional(),
        type: amplifier.optional(),
        dtg: amplifier.optional(),
        altitudeDepth: amplifier.optional(),
        location: amplifier.optional(),
        speed: amplifier.optional(),
        specialHeadquarters: amplifier.optional(),
        country: amplifier.optional(),
        platformType: amplifier.optional(),
        equipmentTeardownTime: amplifier.optional(),
        commonIdentifier: amplifier.optional(),
        auxiliaryEquipmentIndicator: amplifier.optional(),
        headquartersElement: amplifier.optional(),
        installationComposition: amplifier.optional(),
        guardedUnit: amplifier.optional(),
        specialDesignator: amplifier.optional(),
        sigint: amplifier.optional(),
        direction: z.number().min(0).max(360).optional(),
        speedLeader: z.number().min(0).max(1000).optional(),
        engagementBar: amplifier.optional(),
        engagementType: z.enum(["TARGET", "NON-TARGET", "EXPIRED"]).optional(),
      })
      .strict(),
    appearance: z
      .object({
        convention: z.enum(["2525", "APP6"]),
        colorMode: z.enum(["Light", "Medium", "Dark"]),
        fill: z.boolean(),
        frame: z.boolean(),
        icon: z.boolean(),
        infoFields: z.boolean(),
        fillColor: color.optional(),
        frameColor: color.optional(),
        iconColor: color.optional(),
        monoColor: color.optional(),
        outlineColor: color.optional(),
        fillOpacity: z.number().min(0).max(1),
        outlineWidth: z.number().min(0).max(20),
        strokeWidth: z.number().min(0.1).max(20),
      })
      .strict(),
    compatibility: z
      .object({
        schemaVersion: z.literal(1),
        stack: z.number().int().min(0).max(10),
        generalStars: z.number().int().min(0).max(5),
        reinforced: z.enum(["", "+", "-", "±"]),
        signature: z.string().max(16),
        specialHeadquarters: z.string().max(30),
        flagId: z
          .string()
          .regex(/^[A-Z0-9-]{2,16}$/)
          .nullable(),
        flagMode: z.enum(["SMALL", "FULL_FRAME"]),
      })
      .strict(),
    renderProfile: renderProfileRefSchema,
    origin: symbolOriginSchema,
  })
  .strict();
export type MilitarySymbolDefinition = z.infer<
  typeof militarySymbolDefinitionSchema
>;
export type ExactLibraryRef = z.infer<typeof exactLibraryRefSchema>;
export const savedSymbolPinSchema = exactLibraryRefSchema
  .extend({
    definition: militarySymbolDefinitionSchema,
    definitionHash: symbolDigest,
  })
  .strict();
export type SavedSymbolPin = z.infer<typeof savedSymbolPinSchema>;
export const symbolSnapshotSchema = z
  .object({
    definition: militarySymbolDefinitionSchema,
    source: exactLibraryRefSchema.nullable(),
  })
  .strict();
export type SymbolSnapshot = z.infer<typeof symbolSnapshotSchema>;
export const symbolLabelBindingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DEFINITION") }).strict(),
  z.object({ kind: z.literal("UNIT_NAME") }).strict(),
  z.object({ kind: z.literal("PARENT_UNIT_NAME") }).strict(),
  z.object({ kind: z.literal("LITERAL"), text: amplifier }).strict(),
]);
export const operationSymbolStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    base: symbolSnapshotSchema,
    override: symbolSnapshotSchema.nullable(),
    labels: z
      .object({
        uniqueDesignation: symbolLabelBindingSchema,
        higherFormation: symbolLabelBindingSchema,
      })
      .strict(),
  })
  .strict();
export type OperationSymbolState = z.infer<typeof operationSymbolStateSchema>;
export function inheritedSymbol(pin: SavedSymbolPin): OperationSymbolState {
  const { definition, definitionHash: _hash, ...source } = pin;
  return {
    schemaVersion: 1,
    base: { definition: structuredClone(definition), source },
    override: null,
    labels: {
      uniqueDesignation: { kind: "UNIT_NAME" },
      higherFormation: { kind: "DEFINITION" },
    },
  };
}
export function resolveSymbol(
  state: OperationSymbolState,
  name: string,
  parentName: string | null,
): MilitarySymbolDefinition {
  const result = structuredClone((state.override ?? state.base).definition);
  for (const key of ["uniqueDesignation", "higherFormation"] as const) {
    const b = state.labels[key];
    if (b.kind !== "DEFINITION")
      result.amplifiers[key] =
        b.kind === "UNIT_NAME"
          ? name
          : b.kind === "PARENT_UNIT_NAME"
            ? (parentName ?? "")
            : b.text;
  }
  return militarySymbolDefinitionSchema.parse(result);
}
export const libraryVersionFields = {
  exchangeOrigin: exchangeOriginSchema.optional(),
  schemaVersion: z.literal(1),
  familyId: symbolId,
  versionId: symbolId,
  versionLabel: z.string().regex(/^\d+\.\d+\.\d+$/),
  contentVersion: z.number().int().positive(),
  name: symbolLabel,
  tags: z.array(symbolLabel).max(30),
  status: z.enum(["DRAFT", "PUBLISHED", "RETIRED"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  retiredAt: z.string().datetime().nullable(),
  parentVersionId: symbolId.nullable(),
  duplicatedFrom: exactLibraryRefSchema.nullable(),
};
export function validLibraryLifecycle(v: {
  status: string;
  publishedAt: string | null;
  retiredAt: string | null;
}): boolean {
  return v.status === "DRAFT"
    ? !v.publishedAt && !v.retiredAt
    : !!v.publishedAt && (v.status === "RETIRED") === !!v.retiredAt;
}
export const savedSymbolVersionSchema = z
  .object({
    ...libraryVersionFields,
    definition: militarySymbolDefinitionSchema,
  })
  .strict()
  .refine(validLibraryLifecycle, "Invalid library lifecycle dates");
export type SavedSymbolVersion = z.infer<typeof savedSymbolVersionSchema>;
export function newSymbolDefinition(
  id: () => string,
): MilitarySymbolDefinition {
  return {
    schemaVersion: 1,
    definitionId: id(),
    code: {
      dialect: "NUMERIC",
      sidc: "130310000012110000000000000000",
      assertedStandard: "UNVERIFIED",
      sourceConvention: "NUMERIC_13",
    },
    amplifiers: {},
    appearance: {
      convention: "2525",
      colorMode: "Light",
      fill: true,
      frame: true,
      icon: true,
      infoFields: true,
      fillOpacity: 1,
      outlineWidth: 0,
      strokeWidth: 4,
    },
    compatibility: {
      schemaVersion: 1,
      stack: 0,
      generalStars: 0,
      reinforced: "",
      signature: "",
      specialHeadquarters: "",
      flagId: null,
      flagMode: "SMALL",
    },
    renderProfile: { id: "ordo-symbol", version: 1 },
    origin: { kind: "MANUAL" },
  };
}
export function newSavedSymbol(
  name: string,
  uid: () => string,
  now: string,
): SavedSymbolVersion {
  return {
    schemaVersion: 1,
    familyId: uid(),
    versionId: uid(),
    versionLabel: "1.0.0",
    contentVersion: 1,
    name,
    tags: [],
    status: "DRAFT",
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    retiredAt: null,
    parentVersionId: null,
    duplicatedFrom: null,
    definition: newSymbolDefinition(uid),
  };
}

export const renderManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    upstream: z
      .object({
        name: z.literal("milsymbol"),
        version: z.literal("3.0.4"),
        integrity: symbolLabel,
      })
      .strict(),
    compatibilityLayer: symbolLabel,
    metadata: z.object({ release: symbolLabel, hash: symbolDigest }).strict(),
    textMetrics: z.object({ id: symbolLabel, hash: symbolDigest }).strict(),
    resources: z.object({ id: symbolLabel, hash: symbolDigest }).strict(),
    renderProfile: renderProfileRefSchema,
    definitionHash: symbolDigest,
    inputHash: symbolDigest,
  })
  .strict();
export type RenderManifest = z.infer<typeof renderManifestSchema>;
