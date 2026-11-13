import type { Operation, ResolvedConfig } from "../domain/model";
import type { Whiteboard, WhiteboardItem } from "../domain/whiteboards";
import { resolvePlanningCard } from "../domain/planning-card-resolution";
import { escapeHtml as esc } from "./html";
import metrics from "./resources/whiteboard-arial-v1.json";
// A versioned copy keeps document layout independent of later symbol-renderer changes.
function textWidth(text: string, size: number, _padding = 0, bold = false) {
  const widths: Record<string, number> = bold
    ? metrics.bold.widths
    : metrics.regular.widths;
  return [...text].reduce(
    (sum, ch) => sum + (widths[ch] ?? metrics.fallback) * size,
    0,
  );
}
export type WhiteboardImage = { data: string; hash: string; label: string };
export type BoardText = { text: string; bold: boolean; size: number };
export type WhiteboardView = {
  board: Whiteboard;
  items: { item: WhiteboardItem; paragraphs: BoardText[]; issue?: string }[];
};
export function projectWhiteboard(
  op: Operation,
  config: ResolvedConfig,
  board: Whiteboard,
): WhiteboardView {
  const cards = new Map(op.planningCards?.definitions.map((c) => [c.id, c]));
  return {
    board,
    items: board.items.map((item) => {
      let paragraphs: BoardText[] = [];
      try {
        if (item.kind === "card") {
          const c = cards.get(item.cardId);
          if (!c)
            throw Error(
              "Planning card is unavailable. Choose another card or remove this item.",
            );
          const resolved = resolvePlanningCard(op, config, c);
          paragraphs = [
            { text: c.title, bold: true, size: 20 },
            ...resolved.values.flatMap((v) => [
              { text: v.label, bold: true, size: 15 },
              { text: v.value || "—", bold: false, size: 18 },
            ]),
          ];
        } else if ("text" in item)
          paragraphs = [{ text: item.text, bold: false, size: item.fontSize }];
        else paragraphs = [{ text: item.label, bold: true, size: 16 }];
        return { item, paragraphs };
      } catch (e) {
        return {
          item,
          paragraphs: [
            { text: "Unavailable planning card", bold: true, size: 18 },
          ],
          issue: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  };
}
/** Deterministic line geometry shared by canvas and saved SVG, with no foreignObject or external fonts. */
const lineCache = new WeakMap<
  BoardText[],
  Map<number, { lines: (BoardText & { y: number })[]; height: number }>
>();
export function boardTextLines(paragraphs: BoardText[], width: number) {
  const cache =
      lineCache.get(paragraphs) ??
      new Map<
        number,
        { lines: (BoardText & { y: number })[]; height: number }
      >(),
    found = cache.get(width);
  if (found) return found;
  const lines: (BoardText & { y: number })[] = [];
  let y = 0;
  for (const p of paragraphs) {
    for (const paragraph of p.text.split(/\r?\n/)) {
      let line = "";
      for (const word of paragraph.split(/(\s+)/).filter(Boolean)) {
        if (line && textWidth(line + word, p.size, 0, p.bold) > width) {
          y += p.size * 1.3;
          lines.push({ ...p, text: line.trimEnd(), y });
          line = "";
        }
        for (const ch of word) {
          if (line && textWidth(line + ch, p.size, 0, p.bold) > width) {
            y += p.size * 1.3;
            lines.push({ ...p, text: line.trimEnd(), y });
            line = "";
          }
          if (line || ch.trim()) line += ch;
        }
      }
      y += p.size * 1.3;
      lines.push({ ...p, text: line.trimEnd(), y });
    }
    y += 4;
  }
  const result = { lines, height: y };
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(width, result);
  lineCache.set(paragraphs, cache);
  return result;
}
export function connectorLine(a: WhiteboardItem, b: WhiteboardItem) {
  const ax = a.x + a.width / 2,
    ay = a.y + a.height / 2,
    bx = b.x + b.width / 2,
    by = b.y + b.height / 2,
    dx = bx - ax,
    dy = by - ay;
  const edge = (i: WhiteboardItem) =>
    Math.min(
      dx ? i.width / 2 / Math.abs(dx) : Infinity,
      dy ? i.height / 2 / Math.abs(dy) : Infinity,
      0.5,
    );
  const ka = edge(a),
    kb = edge(b);
  return {
    x1: ax + dx * ka,
    y1: ay + dy * ka,
    x2: bx - dx * kb,
    y2: by - dy * kb,
  };
}
export function renderWhiteboard(
  view: WhiteboardView,
  images: Map<string, WhiteboardImage>,
  preview = false,
) {
  const { board } = view,
    issues: string[] = [];
  const byId = new Map(board.items.map((i) => [i.id, i]));
  let connectorLabels = "";
  let body = `<rect width="${board.width}" height="${board.height}" fill="${board.background}"/>`;
  for (const c of board.connectors) {
    const a = byId.get(c.fromId),
      b = byId.get(c.toId);
    if (!a || !b) continue;
    const p = connectorLine(a, b),
      angle = Math.atan2(p.y2 - p.y1, p.x2 - p.x1);
    const arrow = (x: number, y: number, angle: number) =>
      `<path d="M ${x - 12 * Math.cos(angle - 0.45)} ${y - 12 * Math.sin(angle - 0.45)} L ${x} ${y} L ${x - 12 * Math.cos(angle + 0.45)} ${y - 12 * Math.sin(angle + 0.45)}" fill="none" stroke="${c.color}" stroke-width="2"/>`;
    body += `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${c.color}" stroke-width="2" ${c.style === "dashed" ? 'stroke-dasharray="8 6"' : ""}/>`;
    if (c.arrow !== "none") body += arrow(p.x2, p.y2, angle);
    if (c.arrow === "both") body += arrow(p.x1, p.y1, angle + Math.PI);
    if (c.label) {
      const width = Math.max(80, Math.min(280, Math.abs(p.x2 - p.x1) - 16)),
        lines = boardTextLines(
          [{ text: c.label, bold: false, size: 14 }],
          width,
        ),
        x = Math.max(
          width / 2 + 8,
          Math.min(board.width - width / 2 - 8, (p.x1 + p.x2) / 2),
        ),
        y = Math.max(
          4,
          Math.min(
            board.height - lines.height - 8,
            (p.y1 + p.y2) / 2 - lines.height - 8,
          ),
        );
      connectorLabels += `<g><rect x="${x - width / 2 - 3}" y="${y}" width="${width + 6}" height="${lines.height + 3}" rx="3" fill="${board.background}" fill-opacity="0.94"/>${lines.lines.map((l) => `<text x="${x}" y="${y + l.y}" font-size="14" text-anchor="middle" fill="${c.color}">${esc(l.text)}</text>`).join("")}</g>`;
    }
  }
  for (const value of view.items) {
    const i = value.item,
      graphic = i.kind === "symbol" || i.kind === "graphic",
      pad =
        i.kind === "shape" && i.shape !== "rectangle"
          ? Math.max(20, i.width * (i.shape === "diamond" ? 0.26 : 0.16))
          : 14;
    const lines = boardTextLines(
      value.paragraphs,
      Math.max(20, i.width - pad * 2),
    );
    const available = graphic
      ? Math.min(i.height * 0.35, 70)
      : i.kind === "shape" && i.shape !== "rectangle"
        ? Math.max(12, i.height * (i.shape === "diamond" ? 0.45 : 0.65) - 16)
        : i.height - 28;
    let issue = value.issue;
    if (lines.height > available)
      issue ??= "Text does not fit. Enlarge the item or shorten its content.";
    const img = images.get(i.id);
    if (graphic && !img) issue ??= "Graphic is unavailable or still loading.";
    if (issue)
      issues.push(
        `${"label" in i ? i.label || i.kind : i.kind === "card" ? value.paragraphs[0].text : i.kind}: ${issue}`,
      );
    const fill = "fill" in i ? i.fill : "#ffffff",
      ink = "ink" in i ? i.ink : "#203c32";
    let shape = "";
    if (i.kind === "shape" && i.shape === "ellipse")
      shape = `<ellipse cx="${i.width / 2}" cy="${i.height / 2}" rx="${i.width / 2 - 1}" ry="${i.height / 2 - 1}" fill="${fill}" stroke="${ink}"/>`;
    else if (i.kind === "shape" && i.shape === "diamond")
      shape = `<path d="M ${i.width / 2} 1 L ${i.width - 1} ${i.height / 2} L ${i.width / 2} ${i.height - 1} L 1 ${i.height / 2} Z" fill="${fill}" stroke="${ink}"/>`;
    else if (i.kind !== "text" && !graphic)
      shape = `<rect x="1" y="1" width="${i.width - 2}" height="${i.height - 2}" rx="${i.kind === "note" ? 2 : 8}" fill="${fill}" stroke="${i.kind === "note" ? "#b2a471" : ink}"/>`;
    const start = graphic
      ? i.height - Math.min(available, lines.height)
      : i.kind === "shape"
        ? Math.max(8, (i.height - lines.height) / 2)
        : 8;
    const texts = lines.lines
      .filter((l) => l.y <= available)
      .map(
        (l) =>
          `<text x="${graphic ? i.width / 2 : pad}" y="${start + l.y}" font-size="${l.size}" font-weight="${l.bold ? 700 : 400}" ${graphic ? 'text-anchor="middle"' : ""} fill="${ink}">${esc(l.text)}</text>`,
      )
      .join("");
    const image = img
      ? `<image x="8" y="8" width="${i.width - 16}" height="${Math.max(16, i.height - Math.min(available, lines.height) - 16)}" preserveAspectRatio="xMidYMid meet" href="${esc(img.data)}"/>`
      : "";
    body += `<g transform="translate(${i.x} ${i.y})">${shape}${image}${texts}${preview && issue ? `<rect x="1" y="1" width="${i.width - 2}" height="${i.height - 2}" fill="none" stroke="#c43b35" stroke-width="3" stroke-dasharray="7 4"/>` : ""}</g>`;
  }
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${board.width}" height="${board.height}" viewBox="0 0 ${board.width} ${board.height}" font-family="Arial,sans-serif"><title>${esc(board.name)}</title>${body}${connectorLabels}</svg>`,
    issues,
  };
}
