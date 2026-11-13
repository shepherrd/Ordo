import { BrowserWindow, session } from "electron";
import { applicationVersion } from "./app-version";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "../export/projection";
import { assertWhiteboardSvg } from "../validation/whiteboard-svg";
import type { PaperOptions } from "../domain/document-exports";
import type { DocumentRenderPort } from "../application/document-service";
import type { OfficeImage } from "../application/office-layout";

export class DocumentRenderer implements DocumentRenderPort {
  environment() {
    const hash = (v: string | Buffer) =>
        createHash("sha256").update(v).digest("hex"),
      fonts = join(process.env.WINDIR ?? "C:/Windows", "Fonts");
    return {
      appVersion: applicationVersion,
      electron: process.versions.electron!,
      chromium: process.versions.chrome!,
      fontFingerprint: hash(
        canonical(
          Object.fromEntries(
            ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"].map(
              (name) => [name, hash(readFileSync(join(fonts, name)))],
            ),
          ),
        ),
      ),
    };
  }
  protected async window(html: string) {
    if (Buffer.byteLength(html) > 32 * 1024 * 1024)
      throw Error("Printable document exceeds 32 MiB");
    const isolated = session.fromPartition(`ordo-document-${randomUUID()}`, {
      cache: false,
    });
    isolated.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((request, cb) =>
      cb({
        cancel:
          !request.url.startsWith("data:") && request.url !== "about:blank",
      }),
    );
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1100,
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await win.loadURL(
            "data:text/html;charset=utf-8," + encodeURIComponent(html),
          );
          await win.webContents.executeJavaScript(
            "(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));})()",
          );
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Error("Document preparation exceeded its 30-second limit"),
              ),
            30000,
          );
        }),
      ]);
      return win;
    } catch (e) {
      win.destroy();
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  async render(html: string, options: PaperOptions) {
    const win = await this.window(html);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const bytes = await Promise.race([
        win.webContents.printToPDF({
          pageSize: options.paper,
          landscape: options.orientation === "landscape",
          printBackground: true,
          preferCSSPageSize: false,
          margins: { top: 0.6, bottom: 0.65, left: 0.6, right: 0.6 },
          displayHeaderFooter: false,
          generateTaggedPDF: true,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("PDF generation exceeded its 30-second limit")),
            30000,
          );
        }),
      ]);
      if (bytes.byteLength > 128 * 1024 * 1024)
        throw Error("PDF exceeds 128 MiB");
      return {
        bytes,
        environment: this.environment(),
      };
    } finally {
      clearTimeout(timer);
      win.destroy();
    }
  }
  async print(html: string, options: PaperOptions) {
    const win = await this.window(html);
    try {
      return await new Promise<boolean>((resolve, reject) =>
        win.webContents.print(
          {
            silent: false,
            printBackground: true,
            pageSize: options.paper,
            landscape: options.orientation === "landscape",
            margins: {
              marginType: "custom",
              top: 58,
              bottom: 62,
              left: 58,
              right: 58,
            },
          },
          (success, reason) => {
            if (success || /cancel/i.test(reason ?? "")) resolve(success);
            else reject(Error(reason || "Print job failed"));
          },
        ),
      );
    } finally {
      win.destroy();
    }
  }
  async officeImage(data: string): Promise<OfficeImage> {
    if (
      !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(
        data,
      )
    )
      throw Error("Office graphics must be embedded images.");
    const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src data:;style-src 'unsafe-inline'"><style>html,body{margin:0;background:white}img{display:block}</style></head><body><img src="${data}"></body></html>`;
    const win = await this.window(html);
    try {
      return await win.webContents.executeJavaScript(
        "(()=>{const i=document.images[0];if(!i.naturalWidth||!i.naturalHeight)throw Error('Invalid image dimensions');const k=Math.min(i.src.startsWith('data:image/svg+xml;')?Infinity:1,1800/i.naturalWidth,1200/i.naturalHeight),c=document.createElement('canvas');c.width=Math.max(1,Math.round(i.naturalWidth*k));c.height=Math.max(1,Math.round(i.naturalHeight*k));c.getContext('2d').drawImage(i,0,0,c.width,c.height);return {data:c.toDataURL('image/png'),width:i.naturalWidth,height:i.naturalHeight}})()",
      );
    } finally {
      win.destroy();
    }
  }
  async renderWhiteboard(svg: string) {
    assertWhiteboardSvg(svg);
    const data =
      "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    const win = await this.window(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none';img-src data:"></head><body><img src="${data}"></body></html>`,
    );
    try {
      const png = await win.webContents.executeJavaScript(
        "(()=>{const i=document.images[0];if(!i.naturalWidth||!i.naturalHeight||i.naturalWidth>3200||i.naturalHeight>2400)throw Error('Invalid whiteboard dimensions');const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext('2d').drawImage(i,0,0);return c.toDataURL('image/png')})()",
      );
      const bytes = Buffer.from(png.split(",")[1], "base64");
      if (bytes.length > 10 * 1024 * 1024)
        throw Error(
          "Whiteboard PNG exceeds 10 MiB. Split the board or reduce its size.",
        );
      return { bytes, environment: this.environment() };
    } finally {
      win.destroy();
    }
  }
}
