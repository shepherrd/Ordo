// Runs retained desktop workflows unchanged, sequentially, against one build.
// Does not promote a release, change Windows services or supply diagnostic flags.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const {
  workflows,
  hash,
  currentBuild,
  verifyWorkflow,
  verifyDevelopment,
  packageIdentity,
} = require("./milestone6-acceptance.cjs");
const scripts = workflows.map(([script]) => script);
(async () => {
  const packaged = process.argv.includes("--packaged");
  assert(
    !process.argv.includes("--resume"),
    "Closure requires a fresh full sequence; earlier successes cannot be spliced in",
  );
  const version = require("../package.json").version;
  assert(
    ["0.5.0", "0.6.0", "0.6.1", "0.6.2", "0.6.3", "0.6.4", "0.6.5"].includes(
      version,
    ),
    "Unsupported M6 acceptance version",
  );
  if (packaged)
    assert(
      process.env.ORDO_PACKAGED_PATH,
      "Explicit isolated package path required",
    );
  const build = currentBuild();
  let developmentRun, releaseCandidate;
  if (packaged) {
    const index = process.argv.indexOf("--development-evidence");
    assert(
      index !== -1 && process.argv[index + 1],
      "A fresh complete development manifest is required before packaged workflows",
    );
    const file = path.resolve(process.argv[index + 1]);
    const previous = JSON.parse(fs.readFileSync(file, "utf8"));
    verifyDevelopment(previous, build, (p) => fs.readFileSync(p), version);
    developmentRun = { path: file, sha256: hash(file) };
    releaseCandidate = packageIdentity(process.env.ORDO_PACKAGED_PATH, version);
  }
  const folder = path.resolve(
    ".test-data",
    `m6-regressions-${packaged ? "packaged" : "development"}-${randomUUID()}`,
  );
  fs.mkdirSync(folder, { recursive: true });
  const result = {
    schemaVersion: 3,
    status: "RUNNING",
    packaged,
    version,
    milestoneStatus: "IN PROGRESS",
    freshSequence: true,
    build,
    ...(packaged ? { developmentRun, releaseCandidate } : {}),
    runs: [],
  };
  const record = () =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(result, null, 2),
    );
  record();
  console.log(`Evidence: ${folder}`);
  try {
    for (const name of scripts) {
      assert.deepEqual(
        currentBuild(),
        build,
        "Compiled build/source/harness changed during acceptance",
      );
      const before = new Set(fs.readdirSync(".test-data"));
      console.log(`RUN ${name} (${packaged ? "packaged" : "development"})`);
      const log = fs.createWriteStream(path.join(folder, `${name}.log`));
      const code = await new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            path.resolve("scripts", `${name}.cjs`),
            ...(packaged ? ["--packaged"] : []),
          ],
          {
            env: process.env,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        child.stdout.on("data", (chunk) => log.write(chunk));
        child.stderr.on("data", (chunk) => log.write(chunk));
        child.on("error", reject);
        child.on("close", (code) => log.end(() => resolve(code)));
      });
      const candidates = fs
        .readdirSync(".test-data")
        .filter(
          (p) =>
            !before.has(p) &&
            fs.existsSync(path.join(".test-data", p, "acceptance.json")),
        );
      if (code !== 0 || candidates.length !== 1) {
        result.status = "FAILED";
        result.runs.push({
          script: name,
          exitCode: code,
          evidenceCandidates: candidates,
        });
        record();
        console.error(
          fs
            .readFileSync(path.join(folder, `${name}.log`), "utf8")
            .slice(-8000),
        );
        throw Error(
          `${name} failed; retained log: ${path.join(folder, `${name}.log`)}`,
        );
      }
      const file = path.join(".test-data", candidates[0], "acceptance.json");
      const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
      verifyWorkflow(
        evidence,
        packaged,
        workflows.find(([s]) => s === name)[1],
      );
      assert.deepEqual(
        currentBuild(),
        build,
        "Compiled build/source/harness changed during acceptance",
      );
      if (packaged)
        assert.deepEqual(
          packageIdentity(process.env.ORDO_PACKAGED_PATH, version),
          releaseCandidate,
          "Release candidate changed during acceptance",
        );
      result.runs.push({
        script: name,
        result: "PASS",
        exitCode: code,
        checks: evidence.checks.length,
        path: file.replaceAll("\\", "/"),
        sha256: hash(file),
      });
      record();
      console.log(`PASS ${name}: ${evidence.checks.length} checks`);
    }
    result.status = "PASSED_STAGED_WORKFLOWS";
    record();
    console.log(
      `PASS all ${result.runs.length} workflows; M6 remains IN PROGRESS`,
    );
  } catch (error) {
    result.status = "FAILED";
    result.failure = String(error);
    record();
    throw error;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
