// Built Node render-worker evidence only; not dashboard, Electron, or packaged acceptance.
const { Worker } = require("node:worker_threads"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
const workerPath = path.resolve("out/main/symbol-worker.js");
const fixture = JSON.parse(
  fs.readFileSync(".test-data/m6-visual/ordo-composition-results.json", "utf8"),
).find((c) => c.id === "expanded-flags").input;
const uid = (i) => `96000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
async function measure(count) {
  const input = {
    symbolSize: 30,
    layout: { ...fixture.layout, hints: [], siblingOrder: [] },
    nodes: [],
  };
  for (let i = 0; i < count; i++) {
    const symbol = structuredClone(
      fixture.nodes[i % fixture.nodes.length].symbol || fixture.nodes[0].symbol,
    );
    symbol.definitionId = uid(i);
    symbol.amplifiers = {
      uniqueDesignation: `FICTIONAL ${i + 1} / ${i % 11 === 0 ? "LONG UNIT DESIGNATION" : "UNIT"}`,
      additionalInformation: i % 13 === 0 ? "Supporting text" : "",
    };
    symbol.compatibility.flagId =
      i % 20 === 0 ? ["US", "GB", "NATO"][Math.floor(i / 20) % 3] : null;
    input.nodes.push({
      id: uid(i),
      parentId: i ? uid(Math.floor((i - 1) / 8)) : null,
      name: "",
      annotation: "",
      symbol,
      boundary: false,
    });
  }
  const request = { kind: "ORBAT", input };
  const worker = new Worker(workerPath, {
    resourceLimits: {
      maxOldGenerationSizeMb: 384,
      maxYoungGenerationSizeMb: 64,
    },
  });
  const once = () =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID(),
        start = performance.now();
      let maxRss = process.memoryUsage().rss;
      const sampler = setInterval(
        () => (maxRss = Math.max(maxRss, process.memoryUsage().rss)),
        50,
      );
      const timer = setTimeout(
        () => done(Error("Production 20-second render limit exceeded")),
        20000,
      );
      const onMessage = (m) => {
        if (m.id === id) done(m.error ? Error(m.error) : null, m.result);
      };
      const onError = (e) => done(e);
      const done = (error, result) => {
        clearTimeout(timer);
        clearInterval(sampler);
        worker.off("message", onMessage);
        worker.off("error", onError);
        if (error) reject(error);
        else
          resolve({
            elapsedMs: Math.round(performance.now() - start),
            maxRss,
            result,
          });
      };
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.postMessage({ id, request });
    });
  try {
    const cold = await once(),
      warm = await once();
    assert.equal(cold.result.kind, "ORBAT");
    assert.equal(cold.result.result.svgHash, warm.result.result.svgHash);
    const result = cold.result.result;
    assert.equal(result.layout.nodes.filter((n) => !n.synthetic).length, count);
    assert.equal(result.renderManifests.length, count);
    assert.equal(result.svgHash, hash(result.svg));
    const byteLength = Buffer.byteLength(result.svg);
    assert.ok(byteLength <= 16 * 1024 * 1024);
    return {
      count,
      requestBytes: Buffer.byteLength(JSON.stringify(request)),
      svgBytes: byteLength,
      svgHash: result.svgHash,
      canonicalNodes: count,
      syntheticNodes: result.layout.nodes.filter((n) => n.synthetic).length,
      renderManifests: result.renderManifests.length,
      coldMs: cold.elapsedMs,
      warmMs: warm.elapsedMs,
      maxObservedProcessRssBytes: Math.max(cold.maxRss, warm.maxRss),
      warmBytesExact: true,
    };
  } finally {
    await worker.terminate();
  }
}
(async () => {
  const cases = [];
  for (const n of [20, 200, 2000]) {
    const result = await measure(n);
    cases.push(result);
    console.log(JSON.stringify(result));
  }
  fs.writeFileSync(
    "docs/milestone6-composition-performance.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        status: "STAGED_BACKEND_EVIDENCE",
        node: process.version,
        workerHash: hash(fs.readFileSync(workerPath)),
        limits: {
          nodes: 2000,
          workerOldGenerationMiB: 384,
          timeoutMs: 20000,
          svgMiB: 16,
        },
        cases,
        limitations: [
          "Fresh worker per size; second request measures the bounded whole-request cache.",
          "Process RSS includes parent and worker; this is not a precise worker heap measurement.",
          "No dashboard startup, UI responsiveness, Electron lifecycle, or packaged workflow acceptance is claimed.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
