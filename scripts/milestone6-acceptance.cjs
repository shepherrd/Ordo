// Test orchestration only: no application behavior or release promotion.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const workflows = [
  ["smoke", 13],
  ["smoke-milestone2", 20],
  ["smoke-milestone3", 50],
  ["smoke-milestone4", 64],
  ["smoke-milestone5", 77],
  ["smoke-milestone6", 13],
  ["smoke-milestone6-interactions", 7],
  ["smoke-milestone6-import-ui", 5],
  ["smoke-milestone6-catalog-ui", 6],
  ["smoke-builtin-symbol-catalog", 9],
  ["smoke-symbol-edit-protection", 8],
  ["smoke-milestone6-independence", 3],
  ["smoke-operation-navigation", 6],
  ["smoke-open-operations", 7],
  ["smoke-workspace-safety", 15],
  ["smoke-essentials", 20],
  ["smoke-deletion", 21],
  ["smoke-milestone6-visuals", 20],
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hash = (file) => digest(fs.readFileSync(file));
const treeEntries = (folder) => {
  const visit = (directory) =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      assert(
        !entry.isSymbolicLink(),
        "Acceptance fingerprint must not follow symlinks",
      );
      const file = path.join(directory, entry.name);
      return entry.isDirectory()
        ? visit(file)
        : [[path.relative(folder, file).replaceAll("\\", "/"), hash(file)]];
    });
  return visit(folder).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
};
const treeHash = (folder) => digest(JSON.stringify(treeEntries(folder)));
const currentBuild = () => ({
  compiledTreeSha256: treeHash("out"),
  sourceTreeSha256: treeHash("src"),
  packageSha256: hash("package.json"),
  packageLockSha256: hash("package-lock.json"),
  harnessTreeSha256: treeHash("scripts"),
  fixtureTreeSha256: treeHash("tests/fixtures"),
});
const verifyWorkflow = (evidence, packaged, minimumChecks) => {
  assert.equal(evidence.packaged, packaged);
  assert(!evidence.failure && !evidence.error, "Workflow contains a failure");
  assert.equal((evidence.errors || []).length, 0);
  assert.equal((evidence.rendererErrors || []).length, 0);
  assert(evidence.success !== false && evidence.ok !== false);
  assert(
    evidence.checks.length >= minimumChecks,
    "Partial smoke progress is not acceptance",
  );
  assert(
    evidence.checks.every(
      (c) =>
        typeof c === "string" || c.result === undefined || c.result === "PASS",
    ),
  );
};
const verifyDevelopment = (
  previous,
  build,
  readEvidence,
  expectedVersion = "0.5.0",
) => {
  assert(
    ["0.5.0", "0.6.0", "0.6.1", "0.6.2", "0.6.3", "0.6.4", "0.6.5"].includes(
      expectedVersion,
    ),
    "Unsupported M6 acceptance version",
  );
  assert.equal(
    previous.schemaVersion,
    3,
    "A fresh complete schema-3 development run is required",
  );
  assert.equal(previous.status, "PASSED_STAGED_WORKFLOWS");
  assert.equal(previous.packaged, false);
  assert.equal(previous.version, expectedVersion);
  assert.equal(previous.freshSequence, true);
  assert(!previous.previousAttempt, "Spliced acceptance is not allowed");
  assert.deepEqual(
    previous.build,
    build,
    "Development acceptance is from a different compiled build or harness",
  );
  assert.equal(previous.runs.length, workflows.length);
  previous.runs.forEach((run, i) => {
    assert.equal(run.script, workflows[i][0]);
    assert.equal(run.result, "PASS");
    assert.equal(run.exitCode, 0);
    const bytes = readEvidence(run.path);
    assert.equal(
      digest(bytes),
      run.sha256,
      "Retained workflow evidence was changed",
    );
    const evidence = JSON.parse(bytes.toString("utf8"));
    verifyWorkflow(evidence, false, workflows[i][1]);
    assert.equal(run.checks, evidence.checks.length);
  });
};
const compiledArchiveEntries = (archive) => {
  const asar = require("@electron/asar");
  asar.uncache(archive);
  return asar
    .listPackage(archive)
    .map((p) => p.replaceAll("\\", "/").replace(/^\//, ""))
    .filter(
      (p) =>
        p.startsWith("out/") &&
        !asar.statFile(archive, path.normalize(p), false).files,
    )
    .map((p) => {
      assert(
        !asar.statFile(archive, path.normalize(p), false).link,
        "Compiled assets must not be links",
      );
      return [
        p.slice(4),
        digest(asar.extractFile(archive, path.normalize(p), false)),
      ];
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
};
const packageIdentity = (executable, expectedVersion = "0.5.0") => {
  assert(
    ["0.5.0", "0.6.0", "0.6.1", "0.6.2", "0.6.3", "0.6.4", "0.6.5"].includes(
      expectedVersion,
    ),
    "Unsupported M6 acceptance version",
  );
  const asar = require("@electron/asar");
  const folder = path.dirname(executable),
    archive = path.join(folder, "resources/app.asar");
  asar.uncache(archive);
  assert.equal(
    JSON.parse(asar.extractFile(archive, "package.json").toString("utf8"))
      .version,
    expectedVersion,
  );
  const packagedCompiled = compiledArchiveEntries(archive);
  assert.deepEqual(
    packagedCompiled,
    treeEntries("out"),
    "Packaged compiled assets differ from the complete development build",
  );
  // Include native modules, Electron resources and notices, not only app.asar.
  for (const item of require("../package.json").build.extraResources)
    assert.equal(
      hash(item.from),
      hash(path.join(folder, "resources", item.to)),
      "Packaged notices differ from source",
    );
  return {
    executable: path.resolve(executable),
    executableSha256: hash(executable),
    asarSha256: hash(archive),
    packageTreeSha256: treeHash(folder),
  };
};
module.exports = {
  workflows,
  digest,
  hash,
  treeEntries,
  treeHash,
  currentBuild,
  verifyWorkflow,
  verifyDevelopment,
  packageIdentity,
  compiledArchiveEntries,
};
