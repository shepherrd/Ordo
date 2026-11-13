import type { SqliteRepository } from "../../src/persistence/repository";
import type { Runtime } from "../../src/application/ports";
import {
  alternativeIdentities,
  alternativeRecordSchema,
  initialAlternative,
  operationAssets,
} from "../../src/domain/alternative-plan";
import { createExportProfile } from "../../src/domain/factories";
import { canonical } from "../../src/export/projection";

/** Seed a workspace as written by the retired Alternative plans screen. */
export function seedLegacyAlternative(
  repo: SqliteRepository,
  rt: Runtime,
  operationId: string,
  revision: number,
  name: string,
) {
  const baseline = repo.getOperation(operationId, revision);
  const config = repo.getConfig(baseline);
  const identities = alternativeIdentities(baseline, config, () => rt.id());
  const record = alternativeRecordSchema.parse({
    schemaVersion: 1,
    operationId: identities.get(baseline.id),
    sourceOperationId: baseline.id,
    sourceRevision: revision,
    createdAt: rt.now(),
    actor: rt.actor,
    initialName: name,
    baseline,
    config,
    baselineHash: repo.hash(canonical({ baseline, config })),
    cardOrigins: repo.cardOrigins(baseline),
    identities: [...identities].map(([source, target]) => ({ source, target })),
  });
  const copy = initialAlternative(record);
  repo.transaction(() => {
    repo.sqlite.pragma("defer_foreign_keys = ON");
    const assets = new Map(operationAssets(copy).map((a) => [a.assetId, a]));
    for (const asset of operationAssets(baseline)) {
      repo.modular.insertAsset(
        assets.get(identities.get(asset.assetId)!)!,
        repo.modular.readAsset(asset.assetId).bytes,
      );
    }
    repo.saveOperation(copy, null, record.actor);
    repo.sqlite
      .prepare("INSERT INTO alternative_plans VALUES(?,?,?,?,?,?)")
      .run(
        copy.id,
        baseline.id,
        revision,
        record.baselineHash,
        JSON.stringify(record),
        repo.hash(canonical(record)),
      );
    for (const product of ["opord", "communications-card"] as const)
      repo.saveExportProfile(createExportProfile(copy, product, rt.id()));
  });
  return copy.id;
}
