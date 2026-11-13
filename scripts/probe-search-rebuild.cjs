// Rebuild only a disposable index in a copy of the closed fictional capacity fixture.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const Database = require("better-sqlite3");
(async () => {
  const source = path.resolve(process.argv[2]);
  assert(source.startsWith(path.resolve(".test-data") + path.sep));
  const folder = path.resolve(".test-data", "search-rebuild-" + randomUUID());
  const workspace = path.join(folder, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const database = path.join(workspace, "ordo.db");
  fs.copyFileSync(path.join(source, "workspace", "ordo.db"), database);
  const digest = (db) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          db.prepare("SELECT id,document FROM operations ORDER BY id").all(),
          db.prepare("SELECT id,document FROM catalog_items ORDER BY id").all(),
        ]),
      )
      .digest("hex");
  const db = new Database(database);
  db.pragma("foreign_keys = ON");
  const original = digest(db),
    entries = db.prepare("SELECT count(*) n FROM search_documents").get().n;
  db.prepare("DELETE FROM search_owners").run();
  assert.equal(
    db.prepare("SELECT count(*) n FROM search_documents").get().n,
    0,
  );
  db.close();
  const evidence = {
    executable: process.argv[3] ?? "development",
    entries,
    errors: [],
  };
  const env = { ...process.env, ORDO_DATA_DIR: workspace };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  let app;
  try {
    const started = Date.now();
    app = await electron.launch({
      env,
      timeout: 60000,
      ...(process.argv[3]
        ? { executablePath: path.resolve(process.argv[3]), args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    evidence.shellReadyMs = Date.now() - started;
    const initial = await page.evaluate(() =>
      window.ordo.search({ query: "", sequence: 1 }),
    );
    evidence.incompleteAtShellReady = !initial.complete;
    await page.keyboard.press("Control+k");
    const input = page.getByRole("textbox", { name: "Find in Ordo" });
    await input.waitFor();
    await page.evaluate(() => {
      window.__typingFrames = [];
      document.addEventListener("input", () => {
        const start = performance.now();
        requestAnimationFrame(() =>
          window.__typingFrames.push(performance.now() - start),
        );
      });
    });
    await input.pressSequentially("Readiness reception provision", {
      delay: 20,
    });
    assert.equal(await input.inputValue(), "Readiness reception provision");
    evidence.typingInputToFrameMs = await page.evaluate(
      () => window.__typingFrames,
    );
    assert(evidence.typingInputToFrameMs.length >= 20);
    await page.waitForFunction(
      async () =>
        (await window.ordo.search({ query: "", sequence: 2 })).complete,
      null,
      { timeout: 60000, polling: 250 },
    );
    evidence.rebuildCompleteMs = Date.now() - started;
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const proc = app.process();
    await app.close();
    app = null;
    evidence.exitCode = proc.exitCode;
    assert.equal(proc.exitCode, 0);
    const after = new Database(database, { readonly: true });
    assert.equal(digest(after), original);
    assert.equal(
      after.prepare("SELECT count(*) n FROM search_documents").get().n,
      entries,
    );
    after.close();
    evidence.canonicalSourcesUnchanged = true;
    assert.deepEqual(evidence.errors, []);
  } catch (error) {
    evidence.failure = String(error.stack ?? error);
    process.exitCode = 1;
    console.error(error);
  } finally {
    if (app) await app.close();
    fs.writeFileSync(
      path.join(folder, "result.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence));
    console.log(folder);
  }
})();
