import type { DocumentLayout } from "../../domain/document-layout";
import { useWorkspaceApi } from "./WorkspaceContext";
import { useEffect, useState } from "react";
import type { GraphicalView } from "../../export/projections/v5";
import type { RenderTemplate } from "../../domain/model";
import { renderDocumentHtml } from "../../export/document-layout-html";
import { cardDocumentCss } from "../../export/planning-cards";
import { newDocumentLayout } from "../../domain/document-layout";
import { assertGeneratedSvg } from "../../validation/generated-svg";

export type GraphicalPreviewProps = {
  view: GraphicalView;
  layout?: DocumentLayout;
  provenance: string;
  template?: RenderTemplate;
  assets: Record<string, string>;
};
export function GraphicalProductPreview(props: GraphicalPreviewProps) {
  const desktop = useWorkspaceApi();
  const key = JSON.stringify(props);
  const [result, setResult] = useState({ key: "", html: "", error: "" });
  useEffect(() => {
    let canceled = false;
    const ids = new Set<string>();
    const run = async () => {
      const { view, provenance, template, assets, layout } = JSON.parse(
        key,
      ) as GraphicalPreviewProps;
      const graphics: { blockId: string; svg: string }[] = [];
      for (const request of view.sections.flatMap((s) =>
        s.graphic ? [s.graphic] : [],
      )) {
        if (canceled) return;
        const id = crypto.randomUUID();
        ids.add(id);
        const value = await desktop.renderGraphic(id, {
          kind: "ORBAT",
          input: request.input,
        });
        ids.delete(id);
        if (canceled) return;
        if (value.kind !== "ORBAT") throw Error("Unexpected graphic result");
        assertGeneratedSvg(value.result.svg);
        const digest = [
          ...new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(value.result.svg),
            ),
          ),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (digest !== value.result.svgHash)
          throw Error("Graphic bytes failed verification");
        graphics.push({ blockId: request.blockId, svg: value.result.svg });
      }
      if (!canceled)
        setResult({
          key,
          html: renderDocumentHtml(
            view,
            provenance,
            template,
            assets,
            graphics,
            layout ??
              (view.sections.some((s) =>
                s.moduleHtml?.includes("order-planning-card"),
              )
                ? newDocumentLayout()
                : undefined),
          ).replace("</head>", cardDocumentCss + "</head>"),
          error: "",
        });
    };
    const timer = setTimeout(
      () =>
        void run().catch((e) => {
          if (!canceled) setResult({ key, html: "", error: String(e) });
        }),
      180,
    );
    return () => {
      canceled = true;
      clearTimeout(timer);
      for (const id of ids) void desktop.cancelGraphic(id).catch(() => {});
    };
  }, [key]);
  if (result.key !== key)
    return <p role="status">Rendering graphical product…</p>;
  if (result.error)
    return (
      <p className="notice error" role="alert">
        {result.error}
      </p>
    );
  return (
    <iframe
      className="document-frame"
      title="Graphical product preview"
      sandbox=""
      srcDoc={result.html}
    />
  );
}
