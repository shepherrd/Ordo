import { BrowserWindow, session } from "electron";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RasterPort, RasterResult } from "../application/render-contracts";
import { assertGeneratedSvg } from "../rendering/svg-safety";
import { rasterDimensions } from "../rendering/raster-limits";
import { canonical } from "../export/projection";
export class GraphicRasterizer implements RasterPort {
  private busy = false;
  async rasterize(
    svg: string,
    scale: number,
    background: "WHITE" | "TRANSPARENT",
    signal?: AbortSignal,
  ): Promise<RasterResult> {
    if (this.busy) throw Error("A raster export is already in progress");
    if (signal?.aborted) throw Error("Raster export cancelled");
    assertGeneratedSvg(svg);
    const { width, height } = rasterDimensions(svg, scale);
    const hash = (b: string | Buffer) =>
      createHash("sha256").update(b).digest("hex");
    const fontDir = join(process.env.WINDIR ?? "C:/Windows", "Fonts");
    const fontFingerprint = hash(
      canonical({
        regular: hash(readFileSync(join(fontDir, "arial.ttf"))),
        bold: hash(readFileSync(join(fontDir, "arialbd.ttf"))),
        platform: process.platform,
        chromium: process.versions.chrome,
      }),
    );
    this.busy = true;
    let win: BrowserWindow | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      rejectAbort: ((e: Error) => void) | undefined;
    const abort = () => {
      win?.destroy();
      rejectAbort?.(Error("Raster export cancelled"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const isolated = session.fromPartition("ordo-raster-" + randomUUID(), {
        cache: false,
      });
      isolated.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.webRequest.onBeforeRequest((r, cb) =>
        cb({ cancel: !r.url.startsWith("data:") && r.url !== "about:blank" }),
      );
      win = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
          session: isolated,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      const closed = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject;
        timer = setTimeout(() => {
          win?.destroy();
          reject(Error("Raster export exceeded its time limit"));
        }, 20000);
      });
      const work = async () => {
        await win!.loadURL(
          "data:text/html," +
            encodeURIComponent(
              "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'\"><title>Ordo graphic renderer</title>",
            ),
        );
        const imageUrl =
          "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
        // Values are data literals inside a fixed script. No user-controlled script is accepted.
        return (await win!.webContents.executeJavaScript(
          `(async()=>{const image=new Image();image.src=${JSON.stringify(imageUrl)};await image.decode();await document.fonts.ready;const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};const context=canvas.getContext('2d');${background === "WHITE" ? "context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);" : ""}context.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');})()`,
        )) as string;
      };
      const png = await Promise.race([work(), closed]);
      if (!png.startsWith("data:image/png;base64,"))
        throw Error("Raster export returned invalid output");
      const bytes = Buffer.from(
        png.slice("data:image/png;base64,".length),
        "base64",
      );
      if (bytes.length > 128 * 1024 * 1024)
        throw Error("Raster output exceeds byte budget");
      return {
        bytes,
        svgHash: hash(svg),
        width,
        height,
        rasterizer:
          "electron-" +
          process.versions.electron +
          "-chromium-" +
          process.versions.chrome,
        fontFingerprint,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (win && !win.isDestroyed()) win.destroy();
      this.busy = false;
    }
  }
}
