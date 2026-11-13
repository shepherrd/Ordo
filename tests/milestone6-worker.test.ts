import { afterEach, expect, it } from "vitest";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SymbolRenderHost } from "../src/main/symbol-render-host";
import { newSymbolDefinition } from "../src/domain/symbology";
import type { GraphicRenderRequest } from "../src/application/render-contracts";
const hosts: SymbolRenderHost[] = [];
const host = (
  timeout = 3000,
  path = resolve("tests/fixtures/render-worker-behavior.cjs"),
) => {
  const h = new SymbolRenderHost(path, timeout);
  hosts.push(h);
  return h;
};
const request = (size = 100): GraphicRenderRequest => ({
  kind: "SYMBOL",
  input: {
    definition: newSymbolDefinition(randomUUID),
    size,
    context: "SYMBOL",
    labelSide: "RIGHT",
  },
});
afterEach(() => {
  hosts.forEach((h) => h.close());
  hosts.length = 0;
});
it("aborts active work, replaces its worker, and completes the next request", async () => {
  const h = host(),
    abort = new AbortController();
  const abandoned = h
      .render(request(999), abort.signal)
      .catch((e) => e.message),
    next = h.render(request(110));
  abort.abort();
  expect(await abandoned).toMatch(/cancelled/);
  expect((await next).result.svg).toContain("110");
});
it("cancels queued work without cancelling the active request", async () => {
  const h = host(),
    abort = new AbortController(),
    active = h.render(request(997));
  const queued = h.render(request(111), abort.signal).catch((e) => e.message);
  abort.abort();
  expect(await queued).toMatch(/cancelled/);
  expect((await active).result.svg).toContain("997");
});
it("bounds the queue and closes all accepted requests", async () => {
  const h = host(),
    pending = [h.render(request(999)).catch((e) => e.message)];
  for (let i = 0; i < 8; i++)
    pending.push(h.render(request(110 + i)).catch((e) => e.message));
  await expect(h.render(request(150))).rejects.toThrow(/queue is full/);
  h.close();
  expect(await Promise.all(pending)).toEqual(
    Array(9).fill("Renderer has closed"),
  );
  await expect(h.render(request())).rejects.toThrow(/closed/);
});
it("recovers after a timeout and an unexpected worker exit", async () => {
  const h = host(1000);
  await expect(h.render(request(999))).rejects.toThrow(/time limit/);
  expect((await h.render(request(100))).result.svg).toContain("100");
  await expect(h.render(request(998))).rejects.toThrow(/exited/);
  expect((await h.render(request(101))).result.svg).toContain("101");
});
it("rejects malformed requests and synchronous worker construction failures without leaving a stuck job", async () => {
  const h = host(1000, "not-an-absolute-worker-path");
  await expect(h.render(request())).rejects.toThrow();
  await expect(h.render(request(101))).rejects.toThrow();
  await expect(h.render(request(1001))).rejects.toThrow();
});
