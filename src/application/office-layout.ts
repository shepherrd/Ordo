/** Dimensions describe the source image's layout size; PNG data may be rasterized at higher resolution. */
export type OfficeImage = { data: string; width: number; height: number };
export type SlideBox = { x: number; y: number; w: number; h: number };
export type OfficeSlideLayout = {
  texts: (SlideBox & {
    text: string;
    size: number;
    bold: boolean;
    color: string;
    align: "left" | "center" | "right";
    lineHeight: number;
  })[];
  cards: SlideBox[];
  images: (SlideBox & { data: string; alt: string })[];
  footerY: number;
};
