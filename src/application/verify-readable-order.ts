import type { ExportRecord, Operation } from "../domain/model";
import { verifyNarrativeExport } from "./verify-narrative-export";

/** html-v5 changes implicit-reference presentation, with the same integrity rules. */
export function verifyReadableOrder(
  record: ExportRecord,
  source: Operation,
  hash: (text: string) => string,
): void {
  return verifyNarrativeExport(
    record.schemaVersion === 5
      ? { ...record, schemaVersion: 4, rendererVersion: "html-v4" }
      : record,
    source,
    hash,
  );
}
