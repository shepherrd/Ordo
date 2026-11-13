import type { ExportRecord } from "../domain/model";
import type { PaperOptions } from "../domain/document-exports";
import { printHtmlV1 } from "./print-v1";

// CSS strings never contain literal '<', quotes, slashes, or control characters.
const cssText = (s: string) =>
  '"' +
  Array.from(s)
    .map((c) => `\\${c.codePointAt(0)!.toString(16)} `)
    .join("") +
  '"';
export function printDocumentHtml(
  source: ExportRecord,
  options: PaperOptions,
): string {
  if (source.schemaVersion !== 6) return printHtmlV1(source, options);
  const f = source.documentLayout.footer;
  const right =
    cssText(f.right) +
    (f.pageNumbers
      ? `${f.right ? ' " · "' : ""} "Page " counter(page) " / " counter(pages)`
      : "");
  const css = `<style id="ordo-print-v2">
@page{@bottom-left{content:${cssText(f.left)};font:9pt "Times New Roman";color:#000;white-space:pre-wrap;overflow-wrap:anywhere;width:33%}
@bottom-center{content:${cssText(f.centre)};font:9pt "Times New Roman";color:#000;white-space:pre-wrap;overflow-wrap:anywhere;width:33%}
@bottom-right{content:${right};font:9pt "Times New Roman";color:#000;white-space:pre-wrap;overflow-wrap:anywhere;width:33%}}
.document-footer{display:none}.document-header h1{font-size:22pt!important;margin:0 0 22pt!important}.document-heading-row{font-size:12pt}.document-logo{width:68pt!important;height:68pt;flex-basis:68pt}
</style>`;
  return printHtmlV1(source, options)
    .replace(/<p class="ordo-print-provenance">[^<]*<\/p>/, "")
    .replace("</head>", `${css}</head>`);
}
