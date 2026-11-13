// Run every delivery against one immutable compiled candidate and isolated workspaces.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const executable = process.argv[2];
const folder = path.resolve(
  ".test-data",
  `connected-qualification-${randomUUID()}`,
);
fs.mkdirSync(folder, { recursive: true });
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const build = () =>
  fs
    .readdirSync("out", { recursive: true })
    .filter((p) => fs.statSync(path.join("out", p)).isFile())
    .sort()
    .map((p) => ({ path: p, sha256: hash(path.join("out", p)) }));
const evidence = {
  at: new Date().toISOString(),
  executable: executable ?? "development",
  buildFiles: build(),
  runs: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(folder, "result.json"),
    JSON.stringify(evidence, null, 2),
  );
try {
  for (const delivery of [
    "connected-planning",
    "timeline-progress",
    "office",
    "whiteboards",
    "connected-polish",
  ]) {
    const script = `scripts/smoke-${delivery}.cjs`;
    const run = spawnSync(
      process.execPath,
      [script, ...(executable ? [executable] : [])],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 300000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    fs.writeFileSync(
      path.join(folder, delivery + ".log"),
      (run.stdout ?? "") + (run.stderr ?? ""),
    );
    const location = run.stdout?.trim().split(/\r?\n/).at(-1);
    const resultPath = location && path.join(location, "result.json");
    const result =
      resultPath && fs.existsSync(resultPath)
        ? JSON.parse(fs.readFileSync(resultPath))
        : null;
    evidence.runs.push({
      delivery,
      scriptHash: hash(script),
      exitCode: run.status,
      error: run.error?.message,
      result: resultPath,
      checks: result?.checks,
      errors: result?.errors,
      lifecycle: result?.lifecycle ?? result?.events,
    });
    save();
    assert.equal(run.status, 0, `${delivery} failed; see ${folder}`);
    assert(result && !result.failure, `${delivery} has no successful evidence`);
    assert.deepEqual(result.errors, []);
    const exits = (result.lifecycle ?? result.events).filter((e) =>
      ["exit", "exited"].includes(e.stage),
    );
    assert(exits.length > 0);
    assert(exits.every((e) => e.exitCode === 0));
    assert.deepEqual(
      build(),
      evidence.buildFiles,
      "Build changed during qualification",
    );
    console.log(`PASS ${delivery}: ${result.checks.length} checks`);
  }
  evidence.passed = true;
} catch (error) {
  evidence.failure = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  save();
  console.log(folder);
}
