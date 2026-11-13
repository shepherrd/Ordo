import type { ExportRecord } from "../domain/model";
import type { PaperOptions } from "../domain/document-exports";
import { escapeHtml } from "./html";

// A separately versioned print adaptation. Never edits retained HTML or any
// historical projection/renderer, and never projects from live planning data.
export function printHtmlV1(
  source: ExportRecord,
  options: PaperOptions,
): string {
  const height = options.orientation === "landscape" ? "6in" : "8.7in";
  const css = `<style id="ordo-print-v1">
    @page{size:${options.paper} ${options.orientation};margin:0.6in 0.6in 0.65in;@bottom-center{content:"Ordo - " counter(page) " / " counter(pages);font:8px Arial;color:#53605a}}
    html,body{background:#fff!important;color:#172322;max-width:none!important;margin:0!important;padding:0!important;font-family:Arial,sans-serif!important;font-size:11pt!important;line-height:1.45!important}
    *{box-sizing:border-box}h1{font-size:20pt!important}h2{font-size:14pt!important;margin:16pt 0 6pt!important}h3{font-size:12pt!important}
    header{padding-bottom:10pt!important}p{margin:6pt 0}
    h1,h2,h3,h4,thead{break-after:avoid}p{orphans:3;widows:3;overflow-wrap:anywhere}
    table{width:100%!important;max-width:100%;table-layout:fixed;border-collapse:collapse;font-size:9pt!important}
    thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid}td,th{overflow-wrap:anywhere;word-break:normal;padding:5pt!important}
    img{max-width:100%!important;max-height:${height};object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere}
    .task-organization-graphic{overflow:visible!important;break-inside:avoid;max-width:100%}
    .task-organization-graphic>svg{display:block;width:100%;height:auto;max-width:100%;max-height:${height}}
    section{overflow:visible!important;break-inside:auto}figure{max-width:100%;margin:12pt 0;break-inside:avoid}
    footer,.ordo-print-provenance{font-size:8pt!important;overflow-wrap:anywhere}footer{margin-top:10pt!important;padding-top:6pt!important;break-inside:avoid;break-before:avoid}a{color:inherit;text-decoration:none}
    body.quick-reference{font-size:9pt!important;line-height:1.3!important}body.quick-reference h1{font-size:17pt!important}body.quick-reference h2{font-size:11pt!important;margin:8pt 0 4pt!important}body.quick-reference td,body.quick-reference th{padding:3pt!important}
  </style>`;
  const provenance = `<p class="ordo-print-provenance">Retained export ${escapeHtml(source.id)} · operation ${escapeHtml(source.operationId)} · revision ${source.sourceRevision} · ${source.sourcePublicationId ? "publication " + escapeHtml(source.sourcePublicationId) : "saved planning state"} · profile ${escapeHtml(source.profile.id)} v${source.profile.version} · projection v${source.projectionVersion} · ${escapeHtml(source.rendererVersion)} · print adaptation ordo-print-v1</p>`;
  if (
    !source.html.includes("<head>") ||
    !source.html.includes("</head>") ||
    !source.html.includes("</body>")
  )
    throw Error("Retained HTML is not a complete document");
  return (
    source.html
      .replace(
        "<head>",
        `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'">`,
      )
      // v5 retained HTML contains this generated separator. Correct only that
      // presentation suffix here; keep the historical source bytes untouched.
      .replaceAll(" � unit table</h2>", " - unit table</h2>")
      .replace("</head>", `${css}</head>`)
      .replace("</body>", `${provenance}</body>`)
  );
}
