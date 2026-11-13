import type { ExportRecord, Operation } from "../domain/model";
import { verifyGraphicalExport } from "./verify-order-export";
import { validateNarratives } from "../domain/narrative";
export function verifyNarrativeExport(
  record: ExportRecord,
  source: Operation,
  hash: (text: string) => string,
): void {
  if (record.schemaVersion !== 4)
    return verifyGraphicalExport(record, source, hash);
  validateNarratives(source);
  validateNarratives(record.config);
  if (hash(record.html) !== record.htmlHash)
    throw Error("Retained rich-text HTML hash mismatch");
  if (record.projectionVersion === 5)
    verifyGraphicalExport(
      {
        ...record,
        schemaVersion: 3,
        rendererVersion: "html-v3",
        projectionVersion: 5,
      },
      source,
      hash,
    );
  else if (record.graphics.length) throw Error("Unexpected retained graphics");
}
