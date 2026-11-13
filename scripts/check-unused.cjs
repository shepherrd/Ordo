// Check maintained code without rewriting retained historical implementations.
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const frozen = JSON.parse(
  readFileSync(
    path.join(root, "tests/fixtures/deletion-frozen-implementations.json"),
    "utf8",
  ),
);
const compiler = path.join(
  path.dirname(require.resolve("typescript/package.json")),
  "bin/tsc",
);
const result = spawnSync(
  process.execPath,
  [
    compiler,
    "--noEmit",
    "--noUnusedLocals",
    "--noUnusedParameters",
    "--pretty",
    "false",
  ],
  {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  },
);
if (result.error) throw result.error;
const lines = `${result.stdout ?? ""}${result.stderr ?? ""}`
  .split(/\r?\n/)
  .filter((line) => line.trim());
let retained = 0;
const failures = [];
for (const line of lines) {
  const diagnostic = /^(.*?)\(\d+,\d+\): error TS(6133|6192|6196):/.exec(line);
  const file = diagnostic?.[1].replaceAll("\\", "/");
  if (!file || !frozen[file]) {
    failures.push(line);
    continue;
  }
  const hash = createHash("sha256")
    .update(readFileSync(path.join(root, file)))
    .digest("hex");
  if (hash !== frozen[file])
    failures.push(`Frozen source changed: ${file}\n${line}`);
  else retained++;
}
if (failures.length || result.signal || (result.status !== 0 && !retained)) {
  console.error(
    failures.join("\n") ||
      `Unused-code check failed (${result.signal ?? result.status}).`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Unused-code check passed. ${retained} existing diagnostics are confined to hash-verified frozen historical files.`,
  );
}
