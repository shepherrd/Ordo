import { useEffect } from "react";
import type { RefObject } from "react";
import type { DiagramRequest } from "../../application/orbat-projection";
import type { GraphicRenderResult } from "../../application/render-contracts";
import { useWorkspaceApi } from "./WorkspaceContext";

export type OrbatPlacement = {
  nodeId: string;
  /** Presentation-only movement can reuse the current rendered symbol. */
  offset?: { x: number; y: number };
  /** Structural moves use the same renderer and layout as the final diagram. */
  diagram?: DiagramRequest;
};

/** Ephemeral editor overlay; never changes a stored graphic or its manifest. */
export function useOrbatPlacementPreview(
  graphic: RefObject<HTMLDivElement | null>,
  result: GraphicRenderResult | null,
  placement: OrbatPlacement | undefined,
  active: boolean,
  expanded: boolean,
) {
  const desktop = useWorkspaceApi();
  const key = JSON.stringify(placement ?? null);
  useEffect(() => {
    if (!active || result?.kind !== "ORBAT") return;
    const p: OrbatPlacement | null = JSON.parse(key);
    const svg = graphic.current?.querySelector("svg");
    if (!p || !svg) return;
    let disposed = false;
    let overlay: SVGGElement | null = null;
    const obscured: SVGElement[] = [];
    const source = [
      ...svg.querySelectorAll<SVGElement>("[data-unit-id]"),
    ].filter((el) => el.dataset.unitId === p.nodeId);
    source.forEach((el) => el.classList.add("orbat-drag-source"));
    const requestId = crypto.randomUUID();
    const foldedRequestId = crypto.randomUUID();
    let foldedRequestSent = false;
    const paint = async (rendered: GraphicRenderResult) => {
      if (disposed || rendered.kind !== "ORBAT") return;
      const layout = rendered.result.layout;
      let position = layout.nodes.find((n) => n.id === p.nodeId);
      let folded = false;
      // A drop into a folded branch stays folded. Show its destination at the
      // branch's fold marker instead of implying that a hidden unit is visible.
      if (!position && p.diagram) {
        const parents = new Map(p.diagram.nodes.map((n) => [n.id, n.parentId]));
        let parent = parents.get(p.nodeId);
        while (parent && !position) {
          position = layout.nodes.find((n) => n.id === `fold-${parent}`);
          parent = parents.get(parent);
        }
        folded = !!position;
      }
      if (!position) return;
      let artwork: GraphicRenderResult = rendered;
      let original = result.result.layout.nodes.find(
        (n) => n.id === p.nodeId,
      )?.box;
      // A new child has no existing SVG to clone at a fold marker. Render just
      // that projected unit for its artwork, while retaining the folded layout.
      if (folded && !source.length && p.diagram) {
        const node = p.diagram.nodes.find((n) => n.id === p.nodeId);
        if (!node) return;
        foldedRequestSent = true;
        artwork = await desktop.renderGraphic(foldedRequestId, {
          kind: "ORBAT",
          input: {
            ...p.diagram,
            nodes: [{ ...node, parentId: null }],
            layout: {
              ...p.diagram.layout,
              commandLevels: 1,
              hints: [],
              siblingOrder: [node.id],
            },
          },
        });
        if (disposed || artwork.kind !== "ORBAT") return;
        original = artwork.result.layout.nodes.find(
          (n) => n.id === p.nodeId,
        )?.box;
      }
      const parsed =
        p.diagram && (!folded || !source.length)
          ? new DOMParser().parseFromString(artwork.result.svg, "image/svg+xml")
          : null;
      const symbol =
        folded && source.length
          ? source[0]
          : parsed
            ? [...parsed.querySelectorAll("[data-unit-id]")].find(
                (el) => el.getAttribute("data-unit-id") === p.nodeId,
              )
            : source[0];
      if (!symbol) return;
      const ns = "http://www.w3.org/2000/svg";
      overlay = document.createElementNS(ns, "g");
      overlay.classList.add("orbat-placement-preview");
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("data-placement-unit", p.nodeId);
      const dx = p.offset?.x ?? 0,
        dy = p.offset?.y ?? 0;
      overlay.setAttribute("transform", `translate(${dx} ${dy})`);
      const box = position.box;
      const card = document.createElementNS(ns, "rect");
      const width =
        folded && original
          ? original.right - original.left
          : box.right - box.left;
      const height =
        folded && original
          ? original.bottom - original.top
          : box.bottom - box.top;
      for (const [k, v] of Object.entries({
        x: box.left - 5,
        y: box.top - 5,
        width: width + 10,
        height: height + 10,
        rx: 4,
      }))
        card.setAttribute(k, String(v));
      card.classList.add("orbat-placement-card");
      overlay.append(card);
      const copy = symbol.cloneNode(true) as SVGElement;
      // Copies must not introduce selectable units or duplicate SVG resource IDs.
      const elements = [copy, ...copy.querySelectorAll("*")];
      const ids = new Map(
        elements
          .filter((el) => el.id)
          .map((el) => [el.id, `placement-${requestId}-${el.id}`]),
      );
      for (const el of elements) {
        for (const attr of ["data-unit-id", "role", "tabindex", "aria-pressed"])
          el.removeAttribute(attr);
        for (const attr of [...el.attributes]) {
          let value = attr.value;
          for (const [id, replacement] of ids) {
            value = value.replaceAll(`url(#${id})`, `url(#${replacement})`);
            if (
              (attr.name === "href" || attr.name === "xlink:href") &&
              value === `#${id}`
            )
              value = `#${replacement}`;
          }
          el.setAttribute(attr.name, value);
        }
        if (ids.has(el.id)) el.id = ids.get(el.id)!;
      }
      copy.classList.remove("orbat-drag-source");
      if (folded && original)
        copy.setAttribute(
          "transform",
          `translate(${box.left - original.left} ${box.top - original.top})`,
        );
      overlay.append(copy);
      if (folded) {
        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", String(box.left));
        text.setAttribute("y", String(box.top + height + 18));
        text.textContent = "Inside folded unit";
        overlay.append(text);
      }
      svg.append(overlay);
      // The destination can occupy another unit's current slot before layout
      // reflows. Fade that old content so two labels do not compete in the card.
      for (const el of svg.querySelectorAll<SVGGraphicsElement>(
        "[data-unit-id]",
      )) {
        if (el.dataset.unitId === p.nodeId) continue;
        const b = el.getBBox();
        if (
          b.x < box.left + dx + width &&
          b.x + b.width > box.left + dx &&
          b.y < box.top + dy + height &&
          b.y + b.height > box.top + dy
        ) {
          el.classList.add("orbat-drop-obscured");
          obscured.push(el);
        }
      }
    };
    let sent = false;
    const timer = p.diagram
      ? setTimeout(() => {
          sent = true;
          void desktop
            .renderGraphic(requestId, { kind: "ORBAT", input: p.diagram! })
            .then(paint)
            .catch(() => {
              /* The normal preview reports rendering failures after commit. */
            });
        }, 60)
      : undefined;
    if (!p.diagram) void paint(result);
    return () => {
      disposed = true;
      clearTimeout(timer);
      overlay?.remove();
      source.forEach((el) => el.classList.remove("orbat-drag-source"));
      obscured.forEach((el) => el.classList.remove("orbat-drop-obscured"));
      if (sent) void desktop.cancelGraphic(requestId).catch(() => {});
      if (foldedRequestSent)
        void desktop.cancelGraphic(foldedRequestId).catch(() => {});
    };
  }, [key, result, active, expanded, desktop, graphic]);
}
