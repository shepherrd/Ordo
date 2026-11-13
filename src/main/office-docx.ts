import { parse, serializeOuter, type DefaultTreeAdapterMap } from "parse5";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  Footer,
  ExternalHyperlink,
  HeadingLevel,
  WidthType,
  BorderStyle,
  AlignmentType,
  PageNumber,
  LevelFormat,
  PageOrientation,
  type ParagraphChild,
  type IRunOptions,
  type INumberingOptions,
} from "docx";
import type { ExportRecord } from "../domain/model";
import type { PaperOptions } from "../domain/document-exports";
import type { OfficeImage } from "../application/office-layout";
type Node = DefaultTreeAdapterMap["node"];
const children = (n: Node): Node[] => ("childNodes" in n ? n.childNodes : []);
const tag = (n: Node) => ("tagName" in n ? n.tagName : "");
const attr = (n: Node, k: string) =>
  "attrs" in n ? (n.attrs.find((a) => a.name === k)?.value ?? "") : "";
const text = (n: Node): string =>
  "value" in n ? n.value : children(n).map(text).join("");
const find = (n: Node, test: (v: Node) => boolean): Node | undefined =>
  test(n)
    ? n
    : children(n)
        .map((c) => find(c, test))
        .find(Boolean);
const inlineTags = new Set([
  "#text",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "a",
  "br",
  "small",
  "code",
]);
const isInline = (n: Node) => n.nodeName === "#text" || inlineTags.has(tag(n));
const border = { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" };
const borders = {
  top: border,
  bottom: border,
  left: border,
  right: border,
  insideHorizontal: border,
  insideVertical: border,
};
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const none = {
  top: noBorder,
  bottom: noBorder,
  left: noBorder,
  right: noBorder,
  insideHorizontal: noBorder,
  insideVertical: noBorder,
};

export async function createOfficeDocx(
  source: ExportRecord,
  options: PaperOptions,
  at: string,
  rasterize: (data: string) => Promise<OfficeImage>,
) {
  const parsed = parse(source.html),
    body = find(parsed, (n) => tag(n) === "body")!;
  const landscape = options.orientation === "landscape",
    pageW = options.paper === "A4" ? 11906 : 12240,
    pageH = options.paper === "A4" ? 16838 : 15840;
  const width = (landscape ? pageH : pageW) - 1728,
    maxImage = width / 15;
  const numbering: INumberingOptions["config"][number][] = [],
    imageCache = new Map<string, OfficeImage>();
  const image = async (n: Node, limit = maxImage) => {
    const data =
      tag(n) === "svg"
        ? "data:image/svg+xml;base64," +
          Buffer.from(serializeOuter(n)).toString("base64")
        : attr(n, "src");
    if (!imageCache.has(data)) imageCache.set(data, await rasterize(data));
    const img = imageCache.get(data)!,
      k = Math.min(1, limit / img.width, 560 / img.height);
    return new ImageRun({
      type: "png",
      data: Buffer.from(img.data.split(",")[1], "base64"),
      transformation: {
        width: Math.round(img.width * k),
        height: Math.round(img.height * k),
      },
      altText: {
        title: attr(n, "alt") || attr(n, "aria-label") || "Graphic",
        description: "Retained graphic from Ordo",
        name: "Graphic",
      },
    });
  };
  const inline = async (
    nodes: Node[],
    style: IRunOptions = {},
  ): Promise<ParagraphChild[]> => {
    const result: ParagraphChild[] = [];
    for (const n of nodes) {
      const t = tag(n);
      if (n.nodeName === "#text") {
        const parts = text(n).replace(/\r\n?/g, "\n").split("\n");
        parts.forEach((part, i) =>
          result.push(
            new TextRun({ ...style, text: part, ...(i ? { break: 1 } : {}) }),
          ),
        );
      } else if (t === "br") result.push(new TextRun({ ...style, break: 1 }));
      else if (t === "img" || t === "svg") result.push(await image(n));
      else if (t === "a" && /^(https?:|mailto:)/i.test(attr(n, "href")))
        result.push(
          new ExternalHyperlink({
            link: attr(n, "href"),
            children: (await inline(children(n), {
              ...style,
              style: "Hyperlink",
            })) as TextRun[],
          }),
        );
      else
        result.push(
          ...(await inline(children(n), {
            ...style,
            ...(["strong", "b"].includes(t) ? { bold: true } : {}),
            ...(["em", "i"].includes(t) ? { italics: true } : {}),
            ...(t === "u" ? { underline: {} } : {}),
          })),
        );
    }
    return result;
  };
  type Block = Paragraph | Table;
  const blocks = async (
    nodes: Node[],
    depth = 0,
    listDepth = 0,
  ): Promise<Block[]> => {
    if (depth > 40)
      throw Error("Order nesting exceeds the Office export limit.");
    const result: Block[] = [],
      pending: Node[] = [];
    const flush = async () => {
      if (pending.some((n) => text(n).trim()))
        result.push(
          new Paragraph({
            children: await inline(pending.splice(0)),
            spacing: { after: 120 },
          }),
        );
      else pending.length = 0;
    };
    for (const n of nodes) {
      const t = tag(n);
      if (["head", "style", "script", "footer"].includes(t)) continue;
      if (isInline(n)) {
        pending.push(n);
        continue;
      }
      await flush();
      if (/^h[1-6]$/.test(t))
        result.push(
          new Paragraph({
            children: await inline(children(n)),
            heading: (
              [
                HeadingLevel.TITLE,
                HeadingLevel.HEADING_1,
                HeadingLevel.HEADING_2,
                HeadingLevel.HEADING_3,
                HeadingLevel.HEADING_4,
                HeadingLevel.HEADING_5,
              ] as const
            )[Number(t[1]) - 1],
            keepNext: true,
            spacing: { before: 240, after: 120 },
          }),
        );
      else if (t === "p" || t === "figcaption" || t === "dt" || t === "dd")
        result.push(
          new Paragraph({
            children: await inline(
              children(n),
              t === "dt" ? { bold: true } : {},
            ),
            indent: t === "dd" ? { left: 240 } : undefined,
            spacing: { after: 120 },
            keepNext: t === "dt",
          }),
        );
      else if (t === "img" || t === "svg")
        result.push(
          new Paragraph({
            children: [await image(n)],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          }),
        );
      else if (t === "table") {
        const rows: Node[] = [];
        const gather = (v: Node) => {
          if (tag(v) === "tr") rows.push(v);
          else if (["table", "thead", "tbody", "tfoot"].includes(tag(v)))
            children(v).forEach(gather);
        };
        gather(n);
        const cols = Math.max(
          1,
          ...rows.map((r) =>
            children(r)
              .filter((c) => ["td", "th"].includes(tag(c)))
              .reduce(
                (a, c) => a + Math.max(1, Number(attr(c, "colspan")) || 1),
                0,
              ),
          ),
        );
        if (cols > 64 || rows.length > 5001)
          throw Error("A table exceeds Office export limits.");
        const trs: TableRow[] = [];
        for (const [index, row] of rows.entries()) {
          const cells: TableCell[] = [];
          const head = children(row).some((c) => tag(c) === "th");
          for (const c of children(row).filter((c) =>
            ["td", "th"].includes(tag(c)),
          )) {
            const content = await blocks(children(c), depth + 1);
            cells.push(
              new TableCell({
                children: content.length ? content : [new Paragraph("")],
                columnSpan: Math.max(1, Number(attr(c, "colspan")) || 1),
                width: { size: Math.floor(width / cols), type: WidthType.DXA },
                margins: { top: 100, bottom: 100, left: 100, right: 100 },
                shading: {
                  fill: head ? "E5EBE8" : index % 2 ? "FFFFFF" : "F6F8F7",
                },
                borders,
              }),
            );
          }
          trs.push(
            new TableRow({
              children: cells,
              tableHeader: head,
              cantSplit: false,
            }),
          );
        }
        if (trs.length)
          result.push(
            new Table({
              rows: trs,
              width: { size: width, type: WidthType.DXA },
              columnWidths: Array.from({ length: cols }, () =>
                Math.floor(width / cols),
              ),
              borders,
            }),
          );
        result.push(new Paragraph({ spacing: { after: 120 } }));
      } else if (t === "ul" || t === "ol") {
        const reference = "list-" + numbering.length;
        numbering.push({
          reference,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: t === "ol" ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: t === "ol" ? `%${level + 1}.` : "•",
            start: Math.max(1, Number(attr(n, "start")) || 1),
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 360 * (level + 1), hanging: 180 } },
            },
          })),
        });
        for (const li of children(n).filter((c) => tag(c) === "li")) {
          const nested = children(li).filter((c) =>
            ["ol", "ul"].includes(tag(c)),
          );
          result.push(
            new Paragraph({
              children: await inline(
                children(li).filter((c) => !nested.includes(c)),
              ),
              numbering: { reference, level: Math.min(listDepth, 8) },
              spacing: { after: 80 },
            }),
          );
          result.push(...(await blocks(nested, depth + 1, listDepth + 1)));
        }
      } else if (t === "blockquote") {
        const paragraphs = children(n).filter((c) => tag(c) === "p");
        for (const paragraph of paragraphs.length ? paragraphs : [n])
          result.push(
            new Paragraph({
              children: await inline(children(paragraph), { italics: true }),
              indent: { left: 360, right: 360 },
              spacing: { after: 120 },
            }),
          );
      } else if (
        t === "header" &&
        attr(n, "class").includes("document-header")
      ) {
        const title = find(n, (c) => tag(c) === "h1"),
          identity = find(n, (c) =>
            attr(c, "class").includes("document-identity-lines"),
          ),
          classification = find(
            n,
            (c) => attr(c, "class") === "document-classification",
          ),
          logo = find(n, (c) => tag(c) === "img");
        if (title)
          result.push(
            new Paragraph({
              text: text(title),
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              keepNext: true,
              spacing: { after: 360 },
            }),
          );
        const cells: TableCell[] = [];
        if (logo)
          cells.push(
            new TableCell({
              children: [new Paragraph({ children: [await image(logo, 85)] })],
              width: { size: 1440, type: WidthType.DXA },
              borders: none,
            }),
          );
        cells.push(
          new TableCell({
            children: identity
              ? await blocks(children(identity), depth + 1)
              : [new Paragraph("")],
            width: {
              size: width - (logo ? 1440 : 0) - 2300,
              type: WidthType.DXA,
            },
            borders: none,
          }),
        );
        cells.push(
          new TableCell({
            children: [
              new Paragraph({
                text: classification ? text(classification) : "",
                alignment: AlignmentType.RIGHT,
              }),
            ],
            width: { size: 2300, type: WidthType.DXA },
            borders: none,
          }),
        );
        result.push(
          new Table({
            rows: [new TableRow({ children: cells })],
            width: { size: width, type: WidthType.DXA },
            borders: none,
          }),
          new Paragraph({ spacing: { after: 200 } }),
        );
      } else result.push(...(await blocks(children(n), depth + 1, listDepth)));
    }
    await flush();
    return result;
  };
  const content = await blocks(children(body)),
    layout =
      source.schemaVersion === 6 || source.schemaVersion === 7
        ? source.documentLayout
        : undefined,
    foot = layout?.footer;
  const footer = new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun(foot?.left ?? ""),
          new TextRun("\t" + (foot?.centre ?? "")),
          new TextRun("\t" + (foot?.right ?? "")),
          ...(foot?.pageNumbers
            ? [
                new TextRun({
                  children: [
                    "  ",
                    PageNumber.CURRENT,
                    " / ",
                    PageNumber.TOTAL_PAGES,
                  ],
                }),
              ]
            : []),
        ],
        tabStops: [
          { type: "center", position: Math.round(width / 2) },
          { type: "right", position: width },
        ],
        style: "Footer",
      }),
    ],
  });
  const doc = new Document({
    creator: "Ordo",
    title: text(find(parsed, (n) => tag(n) === "title") ?? body).slice(0, 260),
    description: `Independent order exported ${at}. Source export ${source.id}, revision ${source.sourceRevision}.`,
    numbering: { config: numbering },
    styles: {
      default: {
        document: {
          run: { font: "Arial", size: 22, color: "000000" },
          paragraph: { spacing: { after: 120, line: 276 } },
        },
      },
      paragraphStyles: [
        "Title",
        "Heading1",
        "Heading2",
        "Heading3",
        "Heading4",
        "Heading5",
      ].map((id, index) => ({
        id,
        name: id,
        basedOn: "Normal",
        next: "Normal",
        run: {
          font: "Arial",
          color: "000000",
          bold: true,
          size: [40, 30, 26, 24, 22, 22][index],
        },
        paragraph: { keepNext: true, spacing: { before: 240, after: 120 } },
      })),
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pageW,
              height: pageH,
              orientation: landscape
                ? PageOrientation.LANDSCAPE
                : PageOrientation.PORTRAIT,
            },
            margin: {
              top: 864,
              bottom: 936,
              left: 864,
              right: 864,
              footer: 360,
            },
          },
        },
        footers: { default: footer },
        children: content,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
