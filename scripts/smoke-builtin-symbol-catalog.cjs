// Fictional isolated workspace; normal launch/exit/reopen without startup flags.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "builtin-symbol-catalog-" + uid());
  const data = path.join(folder, "workspace");
  fs.mkdirSync(data, { recursive: true });
  const packaged = process.argv.includes("--packaged"),
    env = { ...process.env, ORDO_DATA_DIR: data, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  const checks = [],
    errors = [],
    events = [];
  const write = (failure) =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          packaged,
          checks,
          errors,
          events,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const report = (step) => {
    checks.push(step);
    write();
    console.log("PASS " + step);
  };
  process.on("uncaughtExceptionMonitor", (error) => write(error));
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const launch = async () => {
    events.push({ at: new Date().toISOString(), stage: "launch" });
    write();
    app = await electron.launch({
      env,
      timeout: 60000,
      ...(packaged
        ? { executablePath: process.env.ORDO_PACKAGED_PATH, args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
    events.push({
      at: new Date().toISOString(),
      stage: "shell-ready",
      pid: app.process().pid,
    });
  };
  const close = async () => {
    await clean();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    events.push({ at: new Date().toISOString(), stage: "normal-close", pids });
    await app.close();
    assert.equal(proc.exitCode, 0);
    for (const pid of pids) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
        alive = false;
      }
      assert(!alive, "Lingering process " + pid);
    }
    app = null;
    events.push({ at: new Date().toISOString(), stage: "fully-exited" });
  };
  const capture = async (file) => {
    await page.evaluate(() => document.fonts.ready);
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    });
    await page.waitForTimeout(350);
    let timer;
    try {
      const bytes = await Promise.race([
        app.evaluate(async ({ BrowserWindow }) =>
          (
            await BrowserWindow.getAllWindows()[0].webContents.capturePage(
              undefined,
              { stayHidden: true, stayAwake: true },
            )
          ).toPNG(),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Capture exceeded 20 seconds")),
            20000,
          );
        }),
      ]);
      fs.writeFileSync(path.join(folder, file), Buffer.from(bytes));
    } finally {
      clearTimeout(timer);
    }
  };
  const entries = () => page.locator(".builtin-symbol-card");
  const selected = () =>
    page.getByRole("region", { name: "Selected catalog symbol" });
  const ready = () =>
    selected().locator('.graphic-canvas[aria-busy="false"] svg').waitFor();
  const countSaved = async () =>
    (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: { search: "", status: "", offset: 0, limit: 100 },
      })
    ).page.total;
  try {
    await launch();
    await nav("Military Symbols");
    await button("Browse built-in catalog").click();
    await entries().first().waitFor();
    const numeric = (
      await call("symbolCatalog", {
        type: "builtin-browse",
        collection: "NUMERIC",
        group: "",
        search: "",
        offset: 0,
        limit: 100,
      })
    ).builtin;
    assert(numeric.catalogTotal > 2000);
    assert.equal(numeric.groups.length, 21);
    assert.equal(await countSaved(), 0);
    report("numeric-catalog-visible-without-creating-saved-items");
    await button("Next catalog page").click();
    await page.getByText("25–48", { exact: true }).waitFor();
    await button("Previous catalog page").click();
    await field("Search built-in symbols").fill("no such symbol 8365284");
    await page
      .getByText("No entries match. Clear the search or choose another group.")
      .waitFor();
    await field("Search built-in symbols").fill("infantry");
    await field("Search built-in symbols").fill("signal");
    await entries().first().waitFor();
    assert((await entries().allTextContents()).every((s) => /signal/i.test(s)));
    report("pagination-empty-search-and-latest-query");
    await field("Search built-in symbols").fill("");
    await field("Catalog collection").selectOption("LEGACY");
    await page
      .getByText("862 matching entries · 862 in this collection", {
        exact: true,
      })
      .waitFor();
    assert.equal(await field("Catalog group").locator("option").count(), 9);
    await field("Catalog group").selectOption("SOFUNT");
    await page
      .getByText("29 matching entries · 862 in this collection", {
        exact: true,
      })
      .waitFor();
    await entries().first().click();
    await ready();
    await selected().locator("summary").click();
    assert(
      (await selected().innerText()).includes("ordo-legacy-sof-selector-v1"),
    );
    await selected().locator("summary").click();
    await page
      .locator("#builtin-symbol-browser")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await capture("military-symbols-catalog.png");
    report("all-eight-legacy-groups-and-original-sof-preview");
    const source = (
      await call("symbolCatalog", {
        type: "builtin-browse",
        collection: "LEGACY",
        group: "SOFUNT",
        search: "",
        offset: 0,
        limit: 1,
      })
    ).builtin.entries[0];
    await button("Create editable symbol copy").click();
    await field("Saved Symbol name").waitFor();
    assert.equal(await field("SIDC").inputValue(), source.definition.code.sidc);
    assert.equal(await countSaved(), 1);
    const savedId = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: { search: "", status: "", offset: 0, limit: 100 },
      })
    ).page.items[0].versionId;
    const saved = (
      await call("symbols", { type: "get", kind: "SYMBOL", id: savedId })
    ).symbol;
    assert.equal(saved.status, "DRAFT");
    assert.notEqual(
      saved.definition.definitionId,
      source.definition.definitionId,
    );
    assert.deepEqual(saved.definition.origin, source.definition.origin);
    assert.deepEqual(saved.definition.renderProfile, {
      id: "ordo-symbol",
      version: 1,
    });
    report("explicit-independent-saved-draft-with-exact-origin-and-code");
    await field("Legacy function").fill("UCI---");
    await button("Browse built-in catalog").click();
    await ready();
    assert(await button("Create editable symbol copy").isDisabled());
    await button("Close built-in catalog").click();
    await button("Discard Legacy function edit").click();
    await clean();
    report("unapplied-legacy-field-is-protected-before-creating-a-copy");
    await field("Saved Symbol name").fill("Unsaved fictional edit");
    await button("Browse built-in catalog").click();
    await ready();
    assert(await button("Create editable symbol copy").isDisabled());
    await page
      .getByText(
        "Save or discard your current symbol edits and finish pending work before creating another copy.",
      )
      .waitFor();
    await button("Close built-in catalog").click();
    await button("Discard symbol edits").click();
    await clean();
    assert.equal(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: savedId }))
        .symbol.name,
      saved.name,
    );
    report("catalog-browsing-preserves-unsaved-editor-and-blocks-replacement");
    await button("Browse built-in catalog").click();
    await field("Catalog collection").selectOption("FM");
    await page
      .getByText("453 matching entries · 453 in this collection", {
        exact: true,
      })
      .waitFor();
    const dictionary = require("../src/rendering/resources/fm-dictionary-v1.json");
    const unavailable = dictionary.entries.find(
      (e) => e.availability === "UNAVAILABLE",
    );
    await field("Search built-in symbols").fill(unavailable.term);
    const unavailableCard = entries()
      .filter({
        has: page.locator(".catalog-availability", { hasText: "UNAVAILABLE" }),
      })
      .first();
    await unavailableCard.click();
    assert(await button("Create editable symbol copy").isDisabled());
    await selected().locator("summary").click();
    assert(
      (await selected().innerText()).includes(
        unavailable.citation.provenanceClass,
      ),
    );
    assert.equal(await countSaved(), 1);
    report("fm-unavailable-mappings-remain-visible-with-citations");
    await field("Search built-in symbols").fill("");
    await field("Catalog collection").selectOption("NUMERIC");
    await field("Catalog group")
      .locator('option[value="common"]')
      .waitFor({ state: "attached" });
    await field("Catalog group").selectOption("common");
    await entries().first().click();
    await ready();
    assert((await selected().innerText()).includes("Component example"));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 780),
    );
    await page
      .locator("#builtin-symbol-browser")
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await capture("military-symbols-catalog-narrow.png");
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await button("Close built-in catalog").click();
    await nav("Library");
    assert.equal(
      await page
        .getByRole("heading", { name: "Built-in catalog", exact: true })
        .filter({ visible: true })
        .count(),
      0,
    );
    await page
      .getByRole("heading", { name: "Managed Assets", exact: true })
      .waitFor();
    report(
      "numeric-modifier-preview-narrow-layout-and-correct-navigation-home",
    );
    assert.deepEqual(errors, []);
    await close();
    await launch();
    assert.deepEqual(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: savedId }))
        .symbol,
      saved,
    );
    await close();
    report("normal-clean-exit-and-reopen-preserve-exact-saved-copy");
    write();
    console.log(
      JSON.stringify({
        folder,
        checks: checks.length,
        numericEntries: numeric.catalogTotal,
      }),
    );
  } catch (e) {
    write(e);
    if (page)
      try {
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    if (page)
      try {
        const discard = button("Discard symbol edits");
        if ((await discard.isVisible()) && (await discard.isEnabled()))
          await discard.click();
      } catch {}
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
