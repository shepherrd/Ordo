import { archivedId, isArchivedId } from "./archived-format";
import { z } from "zod";
import {
  symbolId as id,
  symbolDigest as digest,
  symbolLabel as label,
  renderProfileRefSchema,
  renderManifestSchema,
  savedSymbolVersionSchema,
  exactLibraryRefSchema,
} from "./symbology";
import { savedOrbatVersionSchema, m6Limits } from "./orbat";
import { conversionFieldSchema } from "./library-exchange";
export const graphicExportProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    version: z.number().int().positive(),
    name: label,
    product: z.enum(["SYMBOL", "ORBAT"]),
    format: z.enum(["SVG", "PNG", "JSON"]),
    jsonMode: z
      .union([z.enum(["DERIVED", "NATIVE_EXCHANGE"]), archivedId("graphic")])
      .optional(),
    scale: z.number().min(0.25).max(8),
    background: z.enum(["TRANSPARENT", "WHITE"]),
    size: z.number().min(10).max(500),
    foldPolicy: z.enum(["AS_SHOWN", "EXPANDED"]),
    ancestorPolicy: z.enum(["BOUNDARY", "INCLUDE_CONTEXT"]),
    selectedUnitIds: z.array(id).max(m6Limits.nodes).nullable(),
    renderProfile: renderProfileRefSchema,
  })
  .strict()
  .refine(
    (v) =>
      !isArchivedId("graphic", v.jsonMode) ||
      (v.format === "JSON" &&
        (v.selectedUnitIds === null || v.selectedUnitIds.length === 1)),
    "Archived export requires JSON with one optional subtree root",
  )
  .refine(
    (v) =>
      v.jsonMode !== "NATIVE_EXCHANGE" ||
      (v.format === "JSON" &&
        v.selectedUnitIds === null &&
        v.foldPolicy === "AS_SHOWN"),
    "Native exchange requires full JSON source with unchanged fold state",
  )
  .refine(
    (v) =>
      !v.selectedUnitIds ||
      new Set(v.selectedUnitIds).size === v.selectedUnitIds.length,
    "Duplicate export selection",
  );
export type GraphicExportProfile = z.infer<typeof graphicExportProfileSchema>;
export const graphicExportSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("SAVED_SYMBOL"),
      ref: exactLibraryRefSchema,
      contentVersion: z.number().int().positive(),
      snapshot: savedSymbolVersionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("SAVED_ORBAT"),
      ref: exactLibraryRefSchema,
      contentVersion: z.number().int().positive(),
      snapshot: savedOrbatVersionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("OPERATION"),
      operationId: id,
      revision: z.number().int().positive(),
      publicationId: id.nullable(),
      contentHash: digest,
    })
    .strict(),
]);
export const graphicExportRecordSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    dependencyVersion: z
      .union([z.literal("graphic-input-v2"), archivedId("adapter")])
      .optional(),
    compatibilityReport: z
      .object({
        adapter: archivedId("adapter"),
        fields: z.array(conversionFieldSchema).max(100000),
        canExport: z.literal(true),
        fingerprint: digest,
        nodes: z.number().int().min(1).max(m6Limits.nodes),
      })
      .strict()
      .optional(),
    renderedSvg: z
      .string()
      .max(16 * 1024 * 1024)
      .optional(),
    renderedSvgHash: digest.optional(),
    id,
    source: graphicExportSourceSchema,
    profile: graphicExportProfileSchema,
    profileHash: digest,
    generatedAt: z.string().datetime(),
    actor: label,
    projectionVersion: z.literal(5),
    layoutVersion: z
      .union([z.literal("ordo-layout-v1"), archivedId("layout")])
      .nullable(),
    renderManifests: z.array(renderManifestSchema).max(4000),
    dependencies: z
      .array(
        z
          .object({
            path: z.string().max(1000),
            canonicalValue: z.string().max(m6Limits.jsonBytes),
          })
          .strict(),
      )
      .max(40000),
    mimeType: z.enum(["image/svg+xml", "image/png", "application/json"]),
    byteLength: z
      .number()
      .int()
      .min(1)
      .max(128 * 1024 * 1024),
    contentHash: digest,
    raster: z
      .object({
        svgHash: digest,
        width: z.number().int().positive().max(m6Limits.rasterSide),
        height: z.number().int().positive().max(m6Limits.rasterSide),
        rasterizer: label,
        fontFingerprint: digest,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      (v.schemaVersion === 3) !== isArchivedId("graphic", v.profile.jsonMode) ||
      (v.schemaVersion === 3) !==
        isArchivedId("adapter", v.dependencyVersion) ||
      (v.schemaVersion === 3) !== (v.compatibilityReport !== undefined) ||
      (v.schemaVersion === 3 &&
        (v.renderedSvg !== undefined ||
          v.renderedSvgHash !== undefined ||
          v.renderManifests.length > 0 ||
          v.layoutVersion !== null ||
          v.raster !== null))
    )
      c.addIssue({
        code: "custom",
        message: "Archived graphic format mismatch",
      });
    if (
      (v.schemaVersion === 2) !==
        (v.dependencyVersion === "graphic-input-v2") ||
      (v.schemaVersion === 2 && v.profile.jsonMode === "NATIVE_EXCHANGE")
    )
      c.addIssue({
        code: "custom",
        message: "Graphic dependency version mismatch",
      });
    if (
      (v.schemaVersion === 2) !==
        (v.renderedSvg !== undefined && v.renderedSvgHash !== undefined) ||
      (v.schemaVersion === 1 &&
        (v.renderedSvg !== undefined || v.renderedSvgHash !== undefined))
    )
      c.addIssue({
        code: "custom",
        message: "Graphic retained SVG version mismatch",
      });
    if (
      v.schemaVersion === 1 &&
      (v.renderManifests.length > m6Limits.nodes ||
        v.dependencies.length > 20000)
    )
      c.addIssue({
        code: "custom",
        message: "Legacy graphic record limit exceeded",
      });
    if (
      v.mimeType !==
      { SVG: "image/svg+xml", PNG: "image/png", JSON: "application/json" }[
        v.profile.format
      ]
    )
      c.addIssue({ code: "custom", message: "Graphic output format mismatch" });
    if ((v.profile.format === "PNG") !== !!v.raster)
      c.addIssue({
        code: "custom",
        message: "Raster manifest required only for PNG",
      });
    if (v.raster && v.raster.width * v.raster.height > m6Limits.rasterPixels)
      c.addIssue({ code: "custom", message: "Raster exceeds pixel limit" });
    if (v.source.kind !== "OPERATION") {
      const s = v.source;
      if (
        s.ref.familyId !== s.snapshot.familyId ||
        s.ref.versionId !== s.snapshot.versionId ||
        s.contentVersion !== s.snapshot.contentVersion
      )
        c.addIssue({
          code: "custom",
          message: "Graphic source identity mismatch",
        });
    }
  });
export type GraphicExportRecord = z.infer<typeof graphicExportRecordSchema>;
