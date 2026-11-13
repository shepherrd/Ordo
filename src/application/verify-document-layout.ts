import { archivedOrderOperation } from "./recorded-graphic-layout";
import type { ExportRecord, Operation } from "../domain/model";
import { canonical, exportStaleness } from "../export/projection";
import { verifyReadableOrder } from "./verify-readable-order";
import {
  verifyPlanningExport,
  planningExportStaleness,
} from "./verify-planning-export";

export function verifyDocumentLayout(
  record: ExportRecord,
  source: Operation,
  hash: (text: string) => string,
): void {
  if (record.schemaVersion === 7)
    return verifyPlanningExport(record, source, hash);
  if (record.schemaVersion !== 6)
    return verifyReadableOrder(record, source, hash);
  if (
    canonical(record.documentLayout) !==
    canonical(source.metadata.documentLayout)
  )
    throw Error("Document header/footer does not match its source revision");
  const { documentLayout: _layout, ...rest } = record;
  verifyReadableOrder(
    { ...rest, schemaVersion: 5, rendererVersion: "html-v5" },
    source,
    hash,
  );
}

/** The original projector continues to own its operational dependencies. */
export function documentStaleness(record: ExportRecord, current: Operation) {
  current = archivedOrderOperation(record, current);
  if (record.schemaVersion === 7)
    return planningExportStaleness(record, current);
  const state = exportStaleness(record, current);
  if (record.schemaVersion !== 6 || state.compatibility !== "supported")
    return state;
  const layout = current.metadata.documentLayout;
  const changedPaths = [...state.changedPaths];
  for (const group of ["header", "footer"] as const) {
    for (const field of Object.keys(record.documentLayout[group])) {
      const before = record.documentLayout[group] as Record<string, unknown>;
      const after = layout?.[group] as Record<string, unknown> | undefined;
      if (canonical(before[field]) !== canonical(after?.[field]))
        changedPaths.push(`document/${group}/${field}`);
    }
  }
  return { ...state, outdated: changedPaths.length > 0, changedPaths };
}
