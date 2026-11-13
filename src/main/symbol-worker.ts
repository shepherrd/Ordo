import { parentPort } from "node:worker_threads";
import { createHash } from "node:crypto";
import { renderSymbol } from "../rendering/symbol-renderer";
import { renderOrbat } from "../rendering/orbat-renderer";
import { graphicRenderRequestSchema } from "../rendering/render-request";
import { canonical } from "../export/projection";
import type { GraphicRenderResult } from "../application/render-contracts";
import resourceManifest from "../rendering/resources/resource-manifest.json";
import metrics from "../rendering/resources/arial-metrics-v1.json";
import paths from "../rendering/resources/symbol-marking-paths-v1.json";
const identity = canonical({
  engine: "milsymbol@3.0.4",
  compatibility: "ordo-symbol-layout-v1",
  layout: "ordo-layout-v1",
  resourceManifest,
  metrics,
  paths,
});
const cache = new Map<string, { result: GraphicRenderResult; bytes: number }>();
let usedBytes = 0;
parentPort!.on("message", (message: { id: string; request: unknown }) => {
  try {
    const serialized = JSON.stringify(message.request);
    if (Buffer.byteLength(serialized) > 10 * 1024 * 1024)
      throw Error("Render request exceeds 10 MiB");
    const request = graphicRenderRequestSchema.parse(message.request),
      key = createHash("sha256")
        .update(identity)
        .update(canonical(request))
        .digest("hex");
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
      cache.set(key, entry);
    } else {
      const result: GraphicRenderResult =
        request.kind === "SYMBOL"
          ? { kind: "SYMBOL", result: renderSymbol(request.input) }
          : { kind: "ORBAT", result: renderOrbat(request.input) };
      entry = { result, bytes: Buffer.byteLength(JSON.stringify(result)) };
      while (cache.size >= 100 || usedBytes + entry.bytes > 24 * 1024 * 1024) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        usedBytes -= cache.get(oldest)!.bytes;
        cache.delete(oldest);
      }
      if (entry.bytes <= 24 * 1024 * 1024) {
        cache.set(key, entry);
        usedBytes += entry.bytes;
      }
    }
    parentPort!.postMessage({ id: message.id, result: entry.result });
  } catch (error) {
    parentPort!.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : "Symbol rendering failed",
    });
  }
});
