import type { ExportRecord } from "../domain/model";
import type { PaperOptions } from "../domain/document-exports";
import { printDocumentHtml } from "./print-v2";
import { newDocumentLayout } from "../domain/document-layout";
/** Card layout is already frozen in HTML. Adapt only the print framing. */
export function printConnectedHtml(
  source: ExportRecord,
  options: PaperOptions,
) {
  if (source.schemaVersion !== 7) return printDocumentHtml(source, options);
  return printDocumentHtml(
    {
      ...source,
      schemaVersion: 6,
      rendererVersion: "html-v6",
      projectionVersion: source.graphics.length ? 5 : 4,
      documentLayout: source.documentLayout ?? newDocumentLayout(),
    },
    options,
  ).replace('id="ordo-print-v2"', 'id="ordo-print-v3"');
}
