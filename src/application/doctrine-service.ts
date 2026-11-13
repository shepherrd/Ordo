import { z } from "zod";
import {
  doctrineVersionSchema,
  createDoctrineDraft,
  assertPublishableDoctrine,
  syncDoctrineIndex,
} from "../domain/doctrine-builder";
import type { Repository, Runtime } from "./ports";
export const doctrineCommands = [
  z
    .object({
      type: z.literal("doctrine-create"),
      sourceId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(160),
      versionLabel: z.string().regex(/^\d+\.\d+\.\d+$/),
      newFamily: z.boolean(),
      empty: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("doctrine-save"),
      doctrine: doctrineVersionSchema,
      expectedContentVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("doctrine-publish"),
      id: z.string().uuid(),
      expectedContentVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ type: z.literal("doctrine-retire"), id: z.string().uuid() })
    .strict(),
] as const;
export const doctrineCommandSchema = z.discriminatedUnion(
  "type",
  doctrineCommands,
);
export function executeDoctrine(
  repo: Repository,
  runtime: Runtime,
  input: unknown,
): string {
  const command = doctrineCommandSchema.parse(input);
  return repo.transaction(() => {
    if (command.type === "doctrine-create") {
      const source = repo
        .listDoctrines()
        .find((v) => v.doctrineVersionId === command.sourceId);
      if (!source) throw Error("Source doctrine not found");
      if (
        !command.newFamily &&
        (source.status === "DRAFT" || source.sourceKind === "BUNDLED")
      )
        throw Error(
          "Duplicate bundled doctrine; create new versions from published custom doctrine",
        );
      const family = command.newFamily ? runtime.id() : source.doctrineFamilyId;
      if (
        repo
          .listDoctrines()
          .some(
            (v) =>
              v.doctrineFamilyId === family &&
              v.versionLabel === command.versionLabel,
          )
      )
        throw Error("Version label is already used in this family");
      const number =
        Math.max(
          0,
          ...repo
            .listDoctrines()
            .filter((v) => v.doctrineFamilyId === family)
            .map((v) => v.config.doctrine.version),
        ) + 1;
      const v = createDoctrineDraft(
        source,
        family,
        runtime.id(),
        number,
        command.name,
        command.versionLabel,
        runtime.now(),
        command.newFamily,
      );
      const layouts = structuredClone(v.config.doctrine.modules!.layouts);
      if (source.config.doctrine.modules?.assets.length)
        v.config.doctrine.modules!.layouts = [];
      for (const l of v.config.doctrine.modules!.layouts)
        for (const d of l.definitions) delete d.configuration.defaultAssetIds;
      if (command.empty) {
        v.config.doctrine.modules!.layouts = [];
        if (v.config.doctrine.catalog) {
          v.config.doctrine.catalog.nodes = [];
          v.config.doctrine.catalog.baseFields = [];
        }
        v.config.doctrine.annexCatalog = [];
      }
      syncDoctrineIndex(v);
      repo.saveDoctrine(v, null);
      if (!command.empty && source.config.doctrine.modules?.assets.length) {
        v.config.doctrine.modules!.layouts = layouts;
        repo.copyDoctrineAssets(source, v, () => runtime.id(), runtime.now());
        v.contentVersion++;
        repo.saveDoctrine(v, v.contentVersion - 1);
      }
      return v.doctrineVersionId;
    }
    const id =
      command.type === "doctrine-save"
        ? command.doctrine.doctrineVersionId
        : command.id;
    const current = repo
      .listDoctrines()
      .find((v) => v.doctrineVersionId === id);
    if (!current) throw Error("Doctrine version not found");
    if (command.type === "doctrine-retire") {
      repo.retireDoctrine(id, runtime.now());
      return id;
    }
    if (current.status !== "DRAFT" || current.sourceKind === "BUNDLED")
      throw Error(
        "Published or bundled doctrine is immutable; create a new version",
      );
    if (current.contentVersion !== command.expectedContentVersion)
      throw Error("Doctrine draft changed; reload before editing");
    const v = structuredClone(
      command.type === "doctrine-save" ? command.doctrine : current,
    );
    if (
      command.type === "doctrine-save" &&
      (v.status !== "DRAFT" || v.publishedAt || v.retiredAt)
    )
      throw Error("Use explicit doctrine publication");
    syncDoctrineIndex(v);
    repo.verifyAssetReferences(v.config.doctrine.modules?.assets ?? []);
    if (command.type === "doctrine-publish") {
      assertPublishableDoctrine(v);
      v.status = "PUBLISHED";
      v.publishedAt = runtime.now();
    }
    v.updatedAt = runtime.now();
    v.contentVersion = current.contentVersion + 1;
    repo.saveDoctrine(v, current.contentVersion);
    return id;
  });
}
