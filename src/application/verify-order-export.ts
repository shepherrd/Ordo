import type { ExportRecord, Operation } from "../domain/model";
import { projectV5 } from "../export/projections/v5";
import { verifyOrderGraphics } from "./order-graphics";
export function verifyGraphicalExport(
  record: ExportRecord,
  source: Operation,
  hash: (text: string) => string,
): void {
  if (record.schemaVersion !== 3) {
    if (record.projectionVersion === 5)
      throw Error("Projection v5 requires retained graphics provenance");
    return;
  }
  verifyOrderGraphics(
    projectV5(source, record.profile, record.config).view,
    record.graphics,
    hash,
  );
  if (hash(record.html) !== record.htmlHash)
    throw Error("Retained HTML hash mismatch");
  for (const graphic of record.graphics)
    if (
      !record.html.includes(
        `<div class="task-organization-graphic">${graphic.svg}</div>`,
      )
    )
      throw Error("Retained HTML does not contain its exact graphic bytes");
}
