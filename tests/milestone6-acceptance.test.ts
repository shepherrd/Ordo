import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const {
  workflows,
  digest,
  verifyDevelopment,
  verifyWorkflow,
  compiledArchiveEntries,
  treeEntries,
} = createRequire(import.meta.url)("../scripts/milestone6-acceptance.cjs");
const fixture = () => {
  const build = {
    compiledTreeSha256: "compiled",
    sourceTreeSha256: "source",
    packageSha256: "package",
    packageLockSha256: "lock",
    harnessTreeSha256: "harness",
    fixtureTreeSha256: "fixtures",
  };
  const files = new Map<string, Buffer>();
  const runs = (workflows as [string, number][]).map(([script, count]) => {
    const path = `${script}/acceptance.json`;
    const bytes = Buffer.from(
      JSON.stringify({
        packaged: false,
        checks: Array.from({ length: count }, (_, i) => `check ${i}`),
        errors: [],
      }),
    );

    files.set(path, bytes);
    return {
      script,
      path,
      result: "PASS",
      exitCode: 0,
      checks: count,
      sha256: digest(bytes),
    };
  });
  const manifest = {
    schemaVersion: 3,
    status: "PASSED_STAGED_WORKFLOWS",
    packaged: false,
    version: "0.5.0",
    freshSequence: true,
    build,
    runs,
  };
  return { build, manifest, files, read: (p: string) => files.get(p)! };
};

it("fingerprints every nested compiled asset in a Windows ASAR without ignoring renderer files", async () => {
  const { createPackage } = createRequire(import.meta.url)("@electron/asar");
  mkdirSync(".test-data", { recursive: true });
  const folder = mkdtempSync(".test-data/m6-archive-fingerprint-");
  const source = join(folder, "source"),
    out = join(source, "out");
  for (const [file, contents] of [
    ["main/chunks/worker.js", "worker"],
    ["preload/index.js", "preload"],
    ["renderer/assets/layout.css", "profile-2"],
    ["renderer/index.html", "navigation"],
  ]) {
    const parts = file.split("/");
    const name = parts.pop()!;
    const directory = join(out, ...parts);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, name), contents);
  }
  const archive = join(folder, "app.asar");
  await createPackage(source, archive);
  expect(compiledArchiveEntries(archive)).toEqual(treeEntries(out));
  writeFileSync(join(out, "renderer/assets/layout.css"), "changed");
  expect(compiledArchiveEntries(archive)).not.toEqual(treeEntries(out));
});

it("accepts a complete fresh ordered development sequence with intact evidence", () => {
  const f = fixture();
  expect(() => verifyDevelopment(f.manifest, f.build, f.read)).not.toThrow();
});

it("requires an exact release version and fresh matching fingerprints for final M6 acceptance", () => {
  const f = fixture();
  const final = { ...f.manifest, version: "0.6.0" };
  expect(() =>
    verifyDevelopment(final, f.build, f.read, "0.6.0"),
  ).not.toThrow();
  expect(() =>
    verifyDevelopment(f.manifest, f.build, f.read, "0.6.0"),
  ).toThrow();
  expect(() => verifyDevelopment(final, f.build, f.read, "0.5.0")).toThrow();
  expect(() => verifyDevelopment(final, f.build, f.read, "0.7.0")).toThrow();
  expect(() =>
    verifyDevelopment(
      final,
      { ...f.build, packageSha256: "changed" },
      f.read,
      "0.6.0",
    ),
  ).toThrow(/different compiled build or harness/);
});

it("rejects legacy, spliced, failed and incomplete acceptance manifests", () => {
  const f = fixture();
  for (const patch of [
    { schemaVersion: 1 },
    { schemaVersion: 2 },
    { status: "FAILED" },
    { freshSequence: false },
    { previousAttempt: { path: "earlier" } },
    { runs: f.manifest.runs.slice(1) },
    { packaged: true },
    { version: "0.6.0" },
  ])
    expect(() =>
      verifyDevelopment({ ...f.manifest, ...patch }, f.build, f.read),
    ).toThrow();
});

it.each(["0.6.1", "0.6.2", "0.6.3", "0.6.4", "0.6.5"])(
  "requires fresh %s evidence instead of reusing a previous qualified build",
  (version) => {
    const f = fixture();
    const current = { ...f.manifest, version };
    expect(() =>
      verifyDevelopment(current, f.build, f.read, version),
    ).not.toThrow();
    expect(() =>
      verifyDevelopment(
        { ...current, version: "0.6.0" },
        f.build,
        f.read,
        version,
      ),
    ).toThrow();
    expect(() =>
      verifyDevelopment(
        current,
        { ...f.build, harnessTreeSha256: "changed" },
        f.read,
        version,
      ),
    ).toThrow(/different compiled build or harness/);
  },
);

it("rejects changed build, renderer assets, harness or fixture identities", () => {
  const f = fixture();
  for (const key of Object.keys(f.build)) {
    expect(() =>
      verifyDevelopment(f.manifest, { ...f.build, [key]: "changed" }, f.read),
    ).toThrow(/different compiled build or harness/);
  }
});

it("rejects changed evidence, reordered workflows and partial smoke counts", () => {
  const f = fixture();
  f.files.set(f.manifest.runs[0].path, Buffer.from("{}"));
  expect(() => verifyDevelopment(f.manifest, f.build, f.read)).toThrow(
    /evidence was changed/,
  );
  const ordered = fixture();
  ordered.manifest.runs.reverse();
  expect(() =>
    verifyDevelopment(ordered.manifest, ordered.build, ordered.read),
  ).toThrow();
  const partial = fixture();
  const run = partial.manifest.runs[1];
  const bytes = Buffer.from(
    JSON.stringify({
      packaged: false,
      checks: Array(15).fill("partial"),
      errors: [],
    }),
  );
  partial.files.set(run.path, bytes);
  run.sha256 = digest(bytes);
  run.checks = 15;
  expect(() =>
    verifyDevelopment(partial.manifest, partial.build, partial.read),
  ).toThrow(/Partial smoke progress/);
});

it("rejects a workflow failure even when its recorded check count is complete", () => {
  for (const patch of [
    { failure: "restart hang" },
    { errors: ["renderer failure"] },
    { success: false },
    { ok: false },
    { packaged: true },
  ]) {
    expect(() =>
      verifyWorkflow(
        { packaged: false, checks: Array(20).fill("step"), ...patch },
        false,
        20,
      ),
    ).toThrow();
  }
});
