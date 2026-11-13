import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  GraphicRenderPort,
  GraphicRenderRequest,
  GraphicRenderResult,
} from "../application/render-contracts";
import { graphicRenderRequestSchema } from "../rendering/render-request";
interface Pending {
  id: string;
  request: GraphicRenderRequest;
  resolve: (r: GraphicRenderResult) => void;
  reject: (e: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
  timer?: ReturnType<typeof setTimeout>;
}
/** Created on demand. The dashboard loads neither this worker nor symbol resources. */
export class SymbolRenderHost implements GraphicRenderPort {
  private worker: Worker | null = null;
  private queue: Pending[] = [];
  private active: Pending | null = null;
  private closed = false;
  constructor(
    private path = join(__dirname, "symbol-worker.js"),
    private timeoutMs = 20000,
  ) {}
  render(
    input: GraphicRenderRequest,
    signal?: AbortSignal,
  ): Promise<GraphicRenderResult> {
    if (this.closed) return Promise.reject(Error("Renderer has closed"));
    if (signal?.aborted) return Promise.reject(Error("Rendering cancelled"));
    if (Buffer.byteLength(JSON.stringify(input)) > 10 * 1024 * 1024)
      return Promise.reject(Error("Render request exceeds 10 MiB"));
    const parsed = graphicRenderRequestSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(parsed.error);
    const request = parsed.data;
    if (this.queue.length >= 8)
      return Promise.reject(Error("Renderer queue is full"));
    return new Promise((resolve, reject) => {
      const item: Pending = {
        id: randomUUID(),
        request,
        resolve,
        reject,
        signal,
        abort: () => {
          if (this.active === item) {
            this.stopWorker();
            this.finish(Error("Rendering cancelled"));
          } else {
            this.queue = this.queue.filter((p) => p !== item);
            item.signal?.removeEventListener("abort", item.abort);
            reject(Error("Rendering cancelled"));
          }
        },
      };
      signal?.addEventListener("abort", item.abort, { once: true });
      this.queue.push(item);
      this.next();
    });
  }
  private next() {
    if (this.active || this.closed) return;
    const item = this.queue.shift();
    if (!item) return;
    this.active = item;
    try {
      if (!this.worker) {
        const worker = new Worker(this.path, {
          resourceLimits: {
            maxOldGenerationSizeMb: 384,
            maxYoungGenerationSizeMb: 64,
          },
        });
        this.worker = worker;
        worker.on(
          "message",
          (m: { id: string; result?: GraphicRenderResult; error?: string }) => {
            if (this.worker === worker && this.active?.id === m.id)
              this.finish(m.error ? Error(m.error) : null, m.result);
          },
        );
        worker.on("error", (e) => {
          if (this.worker === worker) {
            this.stopWorker();
            this.finish(e instanceof Error ? e : Error(String(e)));
          }
        });
        worker.on("exit", (code) => {
          if (this.worker === worker) {
            this.worker = null;
            if (this.active)
              this.finish(Error("Renderer exited (" + code + ")"));
          }
        });
      }
      item.timer = setTimeout(() => {
        this.stopWorker();
        this.finish(Error("Rendering exceeded its time limit"));
      }, this.timeoutMs);
      this.worker.postMessage({ id: item.id, request: item.request });
    } catch (error) {
      this.stopWorker();
      this.finish(error instanceof Error ? error : Error(String(error)));
    }
  }
  private finish(error: Error | null, result?: GraphicRenderResult) {
    const item = this.active;
    if (!item) return;
    clearTimeout(item.timer);
    item.signal?.removeEventListener("abort", item.abort);
    this.active = null;
    if (error) item.reject(error);
    else if (result) item.resolve(result);
    else item.reject(Error("Renderer returned no result"));
    this.next();
  }
  private stopWorker() {
    const worker = this.worker;
    this.worker = null;
    if (worker) void worker.terminate();
  }
  close() {
    this.closed = true;
    this.stopWorker();
    if (this.active) this.finish(Error("Renderer has closed"));
    for (const item of this.queue) {
      item.signal?.removeEventListener("abort", item.abort);
      item.reject(Error("Renderer has closed"));
    }
    this.queue = [];
  }
}
