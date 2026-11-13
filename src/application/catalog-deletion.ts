import { canonical } from "../export/projections/v1";
import type { CatalogKind } from "../domain/catalog";
import type { Repository } from "./ports";
import type { WorkingDraftRepository } from "./working-drafts";
import type { CatalogRepository } from "./catalog-ports";
import type {
  DeletionRepository,
  DeletionTarget,
  DeletionPreview,
} from "./deletion-service";

const kinds: Partial<Record<DeletionTarget["kind"], CatalogKind>> = {
  symbol: "SYMBOL",
  orbat: "ORBAT",
  "unit-profile": "ORGANIZATION",
  doctrine: "DOCTRINE",
};
/** Deleting a reusable record cannot rewrite a snapshot already consumed by an order. */
export class CatalogDeletion implements DeletionRepository {
  constructor(
    private repo: Repository & DeletionRepository & WorkingDraftRepository,
    private catalog: CatalogRepository,
  ) {}
  prepareDeletion(target: DeletionTarget): DeletionPreview {
    const kind = kinds[target.kind],
      entry = kind ? this.catalog.catalogFind(target.id) : null;
    if (!entry) {
      const preview = this.repo.prepareDeletion(target);
      if (target.kind === "asset")
        for (const k of ["DOCTRINE", "ORGANIZATION"] as const)
          for (const { item } of this.catalog.catalogList(k))
            if (canonical(item.content).includes(target.id))
              preview.blockers.push(`${item.name} uses this file.`);
      return { ...preview, fingerprint: this.repo.hash(canonical(preview)) };
    }
    if (entry.item.kind !== kind)
      throw Error("Deletion target belongs to another catalog.");
    const blockers: string[] = [];
    for (const { item } of this.catalog.catalogList("ORGANIZATION"))
      if (item.kind === "ORGANIZATION" && item.id !== target.id) {
        if (item.content.orbatWorkspace?.orbatId === target.id)
          blockers.push(
            `${item.name} uses this ORBAT. Unassign it in Organizations first.`,
          );
        if (
          item.content.standingSubordinates.some(
            (r) => r.unitProfileVersionId === target.id,
          )
        )
          blockers.push(
            `${item.name} includes this organization. Remove that relationship first.`,
          );
        if (item.content.defaultDoctrine?.doctrineVersionId === target.id)
          blockers.push(
            `${item.name} uses this doctrine as its default. Change that default first.`,
          );
        if (
          item.content.roleMappings.some(
            (m) => m.doctrineFamilyId === target.id,
          )
        )
          blockers.push(
            `${item.name} assigns staff through this doctrine. Remove those assignments first.`,
          );
      }
    const counts = [{ label: "Catalog item", count: 1 }];
    if (
      entry.item.kind === "ORGANIZATION" &&
      entry.item.content.orbatWorkspace?.profiles.length
    )
      counts.push({
        label: "Unit profiles and their personnel records",
        count: entry.item.content.orbatWorkspace.profiles.length,
      });
    const fingerprint = this.repo.hash(
      canonical({ target, token: entry.editToken, blockers, counts }),
    );
    return {
      target,
      name: entry.item.name,
      version: null,
      fingerprint,
      counts,
      blockers,
      retainedImportReceipt:
        (entry.item.kind === "SYMBOL" || entry.item.kind === "ORBAT") &&
        !!entry.item.content.exchangeOrigin,
      retainedSnapshots: true,
    };
  }
  permanentlyDelete(target: DeletionTarget, fingerprint: string) {
    this.repo.transaction(() => {
      const preview = this.prepareDeletion(target);
      if (preview.fingerprint !== fingerprint)
        throw Error("This item changed. Review deletion again.");
      if (preview.blockers.length) throw Error(preview.blockers.join("\n"));
      const entry = kinds[target.kind]
        ? this.catalog.catalogFind(target.id)
        : null;
      if (!entry)
        return this.repo.permanentlyDelete(
          target,
          this.repo.prepareDeletion(target).fingerprint,
        );
      this.catalog.catalogDelete(target.id, entry.editToken);
      const draft = this.repo.getWorkingDraft({
        kind: target.kind as "symbol" | "orbat" | "unit-profile" | "doctrine",
        id: target.id,
        scope: null,
      });
      if (draft) this.repo.removeWorkingDraft(draft, draft.sequence);
    });
  }
}
