import { z } from "zod";
import {
  operationSchema,
  resolvedConfigSchema,
  type Operation,
  type ResolvedConfig,
} from "./model";
import type { ManagedAsset, ModuleConfiguration } from "./modules";

const id = z.string().uuid();
export const alternativeRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    operationId: id,
    sourceOperationId: id,
    sourceRevision: z.number().int().positive(),
    createdAt: z.string().datetime(),
    actor: z.string().min(1).max(160),
    initialName: z.string().trim().min(1).max(160),
    baseline: operationSchema,
    config: resolvedConfigSchema,
    baselineHash: z.string().regex(/^[a-f0-9]{64}$/),
    cardOrigins: z.record(id, id).optional(),
    identities: z
      .array(z.object({ source: id, target: id }).strict())
      .max(100000),
  })
  .strict();
export type AlternativeRecord = z.infer<typeof alternativeRecordSchema>;
export type IdentityMap = Map<string, string>;

export function operationAssets(op: Operation): ManagedAsset[] {
  return [
    ...(op.modules?.assets ?? []),
    ...(op.metadata.documentLayout?.header.logo
      ? [op.metadata.documentLayout.header.logo]
      : []),
    ...(op.briefings?.decks.flatMap((d) =>
      d.slides.flatMap((s) =>
        s.graphic?.kind === "image" ? [s.graphic.asset] : [],
      ),
    ) ?? []),
  ];
}

/** Allocate only owned identities. Doctrine keys and immutable catalog pins stay pinned. */
export function alternativeIdentities(
  op: Operation,
  config: ResolvedConfig,
  uid: () => string,
): IdentityMap {
  const owned = new Set<string>([op.id, op.orderId, op.signal.id]);
  const addIds = (items: { id: string }[]) =>
    items.forEach((x) => owned.add(x.id));
  for (const items of [
    op.units,
    op.tasks,
    op.objectives,
    op.phases,
    op.events,
    op.attachments,
    op.signal.nets,
    op.signal.pacePlans,
  ])
    addIds(items);
  op.authoring?.fields.forEach((f) => addIds(f.entries ?? []));
  const contentIds = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(contentIds);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "references" || key === "source" || key === "document")
        continue;
      if (key === "id" && typeof child === "string") owned.add(child);
      else contentIds(child);
    }
  };
  op.attachments.forEach((a) => contentIds(a.content));
  const doctrineFields = new Set(
    config.doctrine.modules?.layouts.flatMap((l) =>
      l.definitions.flatMap((d) =>
        [
          ...(d.configuration.fields ?? []),
          ...(d.configuration.columns ?? []),
        ].map((f) => f.id),
      ),
    ) ?? [],
  );
  const fields = (c?: ModuleConfiguration) =>
    [...(c?.fields ?? []), ...(c?.columns ?? [])].forEach((f) => {
      if (!doctrineFields.has(f.id)) owned.add(f.id);
    });
  op.modules?.instances.forEach((m) => {
    owned.add(m.moduleInstanceId);
    if (m.localDefinition) {
      owned.add(m.localDefinition.moduleDefinitionId);
      fields(m.localDefinition.configuration);
    }
    fields(m.configurationOverride);
    fields(m.recoveryConfiguration);
    contentIds(m.content);
    if (m.content.type === "CHART" && m.content.source.mode === "DIRECT")
      addIds(m.content.source.points);
  });
  operationAssets(op).forEach((a) => owned.add(a.assetId));
  if (op.orbatLayout) owned.add(op.orbatLayout.layoutId);
  addIds(
    (op.timeline?.lanes ?? []).filter(
      (lane) => lane.id !== "key-dates" && lane.id !== "battle-rhythm",
    ),
  );
  addIds(op.planningCards?.definitions ?? []);
  op.briefings?.decks.forEach((d) => {
    owned.add(d.id);
    addIds(d.slides);
  });
  op.whiteboards?.boards.forEach((b) => {
    owned.add(b.id);
    addIds(b.items);
    addIds(b.connectors);
  });
  const map = new Map([...owned].map((source) => [source, uid()]));
  if (
    new Set(map.values()).size !== map.size ||
    [...map.values()].some((target) => owned.has(target))
  )
    throw Error("Alternative identities must be new and unique.");
  return map;
}

const singleReferences = new Set([
  "id",
  "operationId",
  "orderId",
  "parentId",
  "parentUnitId",
  "unitId",
  "objectiveId",
  "phaseId",
  "eventId",
  "relativeToEventId",
  "referenceEventId",
  "recipientUnitId",
  "productId",
  "productInstanceId",
  "moduleInstanceId",
  "moduleDefinitionId",
  "moduleId",
  "assetId",
  "layoutId",
  "laneId",
  "nodeId",
  "cardId",
  "entityId",
  "entryId",
  "attachmentId",
  "sectionId",
  "fieldId",
  "categoryColumnId",
  "fromId",
  "toId",
]);
const multipleReferences = new Set([
  "unitIds",
  "participantUnitIds",
  "phaseIds",
  "cardIds",
  "siblingOrder",
  "valueColumnIds",
  "defaultAssetIds",
  "audienceUnitIds",
  "netIds",
  "attachmentIds",
]);
const pinned = new Set([
  "doctrineRef",
  "organizationRef",
  "echelonRef",
  "operationOrganizationBinding",
  "sourceUnitProfile",
  "sourceOrbat",
  "symbol",
  "pin",
  "origin",
]);

/** Remap typed references, never prose, URLs, symbols, or catalog/source provenance. */
export function remapPlan(
  op: Operation,
  config: ResolvedConfig,
  map: IdentityMap,
): Operation {
  const ref = (v: string) => map.get(v) ?? v;
  const walk = (v: unknown, key = ""): unknown => {
    if (pinned.has(key)) return structuredClone(v);
    if (typeof v === "string")
      return singleReferences.has(key)
        ? ref(v)
        : key === "storageReference" && v.startsWith("asset:")
          ? `asset:${ref(v.slice(6))}`
          : v;
    if (Array.isArray(v))
      return v.map((x) =>
        multipleReferences.has(key) && typeof x === "string" ? ref(x) : walk(x),
      );
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.entries(v).map(([k, child]) => [
        key === "cells" || key === "values" ? ref(k) : k,
        walk(child, k),
      ]),
    );
  };
  const next = walk(op) as Operation;
  for (const [index, before] of (op.modules?.instances ?? []).entries()) {
    const after = next.modules!.instances[index];
    const definition =
      before.localDefinition ??
      config.doctrine.modules?.layouts
        .flatMap((l) => l.definitions)
        .find((d) => d.moduleDefinitionId === before.moduleDefinitionId);
    const configuration =
      before.configurationOverride ??
      definition?.configuration ??
      before.recoveryConfiguration;
    const references = new Set(
      [...(configuration?.fields ?? []), ...(configuration?.columns ?? [])]
        .filter(
          (f) => f.type.endsWith("_REFERENCE") && f.type !== "STAFF_REFERENCE",
        )
        .map((f) => ref(f.id)),
    );
    const values =
      after.content.type === "KEY_VALUE"
        ? [after.content.values]
        : after.content.type === "TABLE" || after.content.type === "MATRIX"
          ? after.content.rows.map((r) => r.cells)
          : [];
    for (const cells of values)
      for (const key of references)
        if (typeof cells[key] === "string") cells[key] = ref(cells[key]);
  }
  // Staff section/position identities belong to the pinned organization.
  next.staffPositionOverrides = op.staffPositionOverrides?.map((p) => ({
    ...p,
    productId: ref(p.productId),
  }));
  if (!op.staffPositionOverrides) delete next.staffPositionOverrides;
  return operationSchema.parse(next);
}

export function initialAlternative(record: AlternativeRecord): Operation {
  const next = remapPlan(
    record.baseline,
    record.config,
    new Map(record.identities.map((i) => [i.source, i.target])),
  );
  next.name = record.initialName;
  next.revision = 1;
  next.createdAt = next.updatedAt = record.createdAt;
  next.metadata.statusId = record.config.doctrine.editingStatus;
  next.planningProgress?.products.forEach((p) => {
    p.readyAt = null;
    delete p.reopenedReason;
  });
  return next;
}
