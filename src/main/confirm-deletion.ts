import { dialog, type BrowserWindow } from "electron";
import type {
  DeletionService,
  DeletionResult,
} from "../application/deletion-service";

export async function confirmDeletion(
  service: DeletionService,
  win: BrowserWindow,
  input: unknown,
): Promise<DeletionResult> {
  const preview = service.preview(input);
  const item = `“${preview.name}”${preview.version ? ` (${preview.version})` : ""}`;
  if (preview.blockers.length) {
    const shown = preview.blockers.slice(0, 8);
    await dialog.showMessageBox(win, {
      type: "warning",
      title: "Item is still in use",
      message: `${item} cannot be deleted.`,
      detail: `It is protected by these references or requirements:\n\n${shown.join("\n")}${preview.blockers.length > shown.length ? "\nAdditional references also remain." : ""}\n\nNo records have been removed.`,
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return { deleted: false, target: preview.target, reason: "referenced" };
  }
  const decision = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Permanent deletion",
    message: `Are you sure you want to permanently delete ${item}?`,
    detail: `This removal is permanent and cannot be undone in Ordo.\n\nWill be removed:\n${preview.counts.map((c) => `${c.label}: ${c.count}`).join("\n")}${preview.target.kind === "operation" ? "\n\nAll operation revisions, approvals, published orders, reviews, retained exports, and recovery copies will be removed." : ""}${preview.retainedSnapshots ? "\n\nExisting operations and exports retain their independent copies. This item will no longer appear in the catalog." : ""}${preview.retainedImportReceipt ? "\n\nThe original import receipt remains as source evidence." : ""}\n\nExisting backups and exported files outside this workspace will not be deleted.`,
    buttons: ["Cancel", "Delete permanently"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (decision.response !== 1)
    return { deleted: false, target: preview.target, reason: "canceled" };
  return service.commit({
    target: preview.target,
    fingerprint: preview.fingerprint,
    confirmed: true,
  });
}
