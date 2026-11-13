import type { OfficeSlideLayout } from "../application/office-layout";
import { DocumentRenderer } from "./document-renderer";

// Kept for a later release; not imported by the desktop app.
export class DeferredBriefingRenderer extends DocumentRenderer {
  async renderBriefing(html: string) {
    const win = await this.window(html);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const overflow = (await win.webContents.executeJavaScript(
        "Array.from(document.querySelectorAll('.brief-slide')).flatMap((s,i)=>{const c=s.querySelector('.brief-content'), f=s.querySelector('footer');return c.scrollHeight>c.clientHeight+2 || c.getBoundingClientRect().bottom>f.getBoundingClientRect().top+2 || s.scrollHeight>s.clientHeight+2 ? [i+1] : []})",
      )) as number[];
      if (overflow.length)
        throw Error(
          "Content does not fit on slide " +
            overflow.join(", ") +
            ". Use fewer fields, split the content across slides, or shorten the text.",
        );
      const bytes = await Promise.race([
        win.webContents.printToPDF({
          pageSize: { width: 13.333333, height: 7.5 },
          preferCSSPageSize: true,
          printBackground: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          displayHeaderFooter: false,
          generateTaggedPDF: true,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error("Briefing PDF generation exceeded its 30-second limit"),
              ),
            30000,
          );
        }),
      ]);
      if (bytes.byteLength > 128 * 1024 * 1024)
        throw Error("Briefing PDF exceeds 128 MiB");
      return { bytes, environment: this.environment() };
    } finally {
      clearTimeout(timer);
      win.destroy();
    }
  }
  async officeSlides(html: string): Promise<OfficeSlideLayout[]> {
    const win = await this.window(html);
    try {
      return await win.webContents.executeJavaScript(`(()=>{
        const color=s=>{const v=s.match(/\\d+/g);return v?v.slice(0,3).map(n=>Number(n).toString(16).padStart(2,'0')).join(''):'182e28'};
        return [...document.querySelectorAll('.brief-slide')].map((slide,index)=>{
          const root=slide.getBoundingClientRect(),content=slide.querySelector('.brief-content'),footer=slide.querySelector('.brief-footer');
          if(content.scrollHeight>content.clientHeight+2||content.getBoundingClientRect().bottom>footer.getBoundingClientRect().top+2||slide.scrollHeight>slide.clientHeight+2)throw Error('Content does not fit on slide '+(index+1)+'. Split or shorten the content before exporting.');
          const box=e=>{const r=e.getBoundingClientRect();return {x:r.x-root.x,y:r.y-root.y,w:r.width,h:r.height}};
          return {texts:[...slide.querySelectorAll('h1,h2,.brief-body,dt,dd,.brief-footer span')].filter(e=>e.textContent).map(e=>{const s=getComputedStyle(e);return {...box(e),text:e.textContent,size:parseFloat(s.fontSize),bold:Number(s.fontWeight)>=600,color:color(s.color),align:s.textAlign==='right'?'right':s.textAlign==='center'?'center':'left',lineHeight:parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.2}}),cards:[...slide.querySelectorAll('article')].map(box),images:[...slide.querySelectorAll('img')].map(e=>{const r=box(e),k=Math.min(r.w/e.naturalWidth,r.h/e.naturalHeight);return {x:r.x+(r.w-e.naturalWidth*k)/2,y:r.y+(r.h-e.naturalHeight*k)/2,w:e.naturalWidth*k,h:e.naturalHeight*k,data:e.src,alt:e.alt}}),footerY:box(footer).y};
        })})()`);
    } finally {
      win.destroy();
    }
  }
}
