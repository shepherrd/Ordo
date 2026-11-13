import PptxGenJS from "pptxgenjs";
import type {
  OfficeSlideLayout,
  OfficeImage,
} from "../application/office-layout";
export async function createOfficePptx(
  name: string,
  slides: OfficeSlideLayout[],
  notes: string[],
  at: string,
  rasterize: (data: string) => Promise<OfficeImage>,
) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "ORDO", width: 1280 / 96, height: 720 / 96 });
  pptx.layout = "ORDO";
  pptx.author = "Ordo";
  pptx.subject = `Independent briefing exported ${at}`;
  pptx.title = name;
  pptx.company = "";
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  const imageCache = new Map<string, OfficeImage>();
  for (const [index, layout] of slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 1280 / 96,
      h: 12 / 96,
      line: { color: "315F50", transparency: 100 },
      fill: { color: "315F50" },
    });
    for (const box of layout.cards)
      slide.addShape(pptx.ShapeType.roundRect, {
        rectRadius: 8 / 96,
        x: box.x / 96,
        y: box.y / 96,
        w: box.w / 96,
        h: box.h / 96,
        line: { color: "C3D1CA", width: 0.75 },
        fill: { color: "FFFFFF" },
      });
    slide.addShape(pptx.ShapeType.line, {
      x: 64 / 96,
      y: layout.footerY / 96,
      w: 1152 / 96,
      h: 0,
      line: { color: "C3D1CA", width: 0.75 },
    });
    for (const t of layout.texts)
      slide.addText(t.text, {
        x: t.x / 96,
        y: t.y / 96,
        w: t.w / 96,
        h: (t.h + 4) / 96,
        fontFace: "Arial",
        fontSize: t.size * 0.75,
        bold: t.bold,
        color: t.color,
        align: t.align,
        margin: 0,
        breakLine: false,
        paraSpaceAfter: 0,
        lineSpacing: t.lineHeight * 0.75,
        valign: "top",
        fit: "shrink",
        wrap: true,
      });
    for (const image of layout.images) {
      if (!imageCache.has(image.data))
        imageCache.set(image.data, await rasterize(image.data));
      slide.addImage({
        data: imageCache.get(image.data)!.data,
        x: image.x / 96,
        y: image.y / 96,
        w: image.w / 96,
        h: image.h / 96,
        altText: image.alt,
      });
    }
    if (notes[index]) slide.addNotes(notes[index]);
  }
  const bytes = await pptx.write({
    outputType: "nodebuffer",
    compression: true,
  });
  return new Uint8Array(bytes as Buffer);
}
