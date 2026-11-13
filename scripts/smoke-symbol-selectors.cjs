// Current selector regression: isolated fictional data, normal lifecycle, no flags.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "symbol-selectors-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const env = {
    ...process.env,
    ORDO_DATA_DIR: path.join(folder, "workspace"),
    ORDO_HEADLESS: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const checks = [],
    errors = [],
    events = [];
  let app, page, symbolId, finalSidc;
  const hashes = (dir) =>
    fs
      .readdirSync(dir, { recursive: true })
      .filter((p) => fs.statSync(path.join(dir, p)).isFile())
      .sort()
      .map((p) => ({
        path: path.join(dir, p),
        sha256: createHash("sha256")
          .update(fs.readFileSync(path.join(dir, p)))
          .digest("hex"),
      }));
  const buildFiles = hashes("out");
  const write = (failure) =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          version: require("../package.json").version,
          packaged: false,
          checks,
          errors,
          events,
          buildFiles,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const pass = (name) => {
    checks.push(name);
    write();
    console.log("PASS " + name);
  };
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const nav = async (name) => {
    await page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", {
        name: ["Military Symbols", "ORBATs"].includes(name)
          ? "Symbols & ORBATs"
          : name,
        exact: true,
      })
      .click();
    if (["Military Symbols", "ORBATs"].includes(name))
      await page
        .getByRole("tab", {
          name: name === "ORBATs" ? "ORBAT maps" : "Symbol editor",
          exact: true,
        })
        .click();
  };
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const launch = async () => {
    events.push({ at: new Date().toISOString(), stage: "launch" });
    write();
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
    await page.setViewportSize({ width: 1500, height: 900 });
    events.push({
      at: new Date().toISOString(),
      stage: "ready",
      pid: app.process().pid,
    });
  };
  const close = async () => {
    await clean();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((v) => v.pid),
      );
    events.push({ at: new Date().toISOString(), stage: "clean-close", pids });
    await app.close();
    app = null;
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
    events.push({ at: new Date().toISOString(), stage: "fully-exited" });
  };
  const sidc = () => field("SIDC").inputValue();
  const trigger = (title) =>
    page
      .getByRole("button", { name: new RegExp("^" + title + ":") })
      .filter({ visible: true });
  const open = async (title) => {
    assert(await trigger(title).isVisible());
    await trigger(title).click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await dialog.waitFor();
    // Never scroll to the selector: opening must bring it into view itself.
    const box = await dialog.boundingBox(),
      viewport = page.viewportSize();
    assert(
      box &&
        box.y >= 0 &&
        box.y + box.height <= viewport.height + 1 &&
        box.x >= 0 &&
        box.x + box.width <= viewport.width + 1,
      "Selector outside viewport",
    );
    assert(
      await dialog
        .getByLabel("Search choices")
        .evaluate((el) => el === document.activeElement),
      "Search must receive focus",
    );
    await dialog.locator('.catalog-results[aria-busy="false"]').waitFor();
    return dialog;
  };
  const choose = async (title, code) => {
    const dialog = await open(title);
    await dialog.getByLabel("Search choices").fill(code);
    await dialog.locator('.catalog-results[aria-busy="false"]').waitFor();
    await dialog.locator(`[data-component-code="${code}"]`).first().click();
    await dialog.waitFor({ state: "detached" });
    assert(
      await trigger(title).evaluate((el) => el === document.activeElement),
      "Choice must return focus",
    );
  };
  const screenshot = async (name) => {
    await page.evaluate(() => document.fonts.ready);
    const firstThumbnail = page
      .locator(".catalog-results button .symbol-thumbnail")
      .first();
    if (await firstThumbnail.count())
      await firstThumbnail.locator("svg").waitFor();
    await page.screenshot({ path: path.join(folder, name + ".png") });
  };
  try {
    await launch();
    await nav("Military Symbols");
    await button("New symbol").click();
    await field("New symbol name").fill("FICTIONAL SELECTOR REGRESSION");
    await button("Create symbol").click();
    await clean();
    symbolId = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: {
          search: "FICTIONAL SELECTOR REGRESSION",
          status: "",
          offset: 0,
          limit: 10,
        },
      })
    ).page.items[0].versionId;
    assert(symbolId, "Saved symbol identity must be present");
    await page.locator(".symbol-code-details > summary").click();
    const original = await sidc();
    let dialog = await open("Main icon");
    await screenshot("main-function-1500");
    await page.keyboard.press("Escape");
    assert.equal(await sidc(), original);
    assert(
      await trigger("Main icon").evaluate(
        (el) => el === document.activeElement,
      ),
    );
    pass(
      "selector-opens-within-viewport-and-escape-restores-focus-without-editing",
    );

    // Previously Main -> Sector 1 crashed because six-digit choices survived.
    await choose("Main icon", "121200");
    assert.equal((await sidc()).slice(10, 16), "121200");
    await choose("First icon modifier", "02");
    assert.equal((await sidc()).slice(16, 18), "02");
    await choose("Second icon modifier", "02");
    assert.equal((await sidc()).slice(18, 20), "02");
    await choose("Common modifier 1", "107");
    assert.equal((await sidc())[20] + (await sidc()).slice(16, 18), "107");
    await choose("Common modifier 2", "103");
    assert.equal((await sidc())[21] + (await sidc()).slice(18, 20), "103");
    await trigger("First icon modifier")
      .filter({ hasText: "Using common modifier 1" })
      .waitFor();
    pass(
      "all-five-selectors-apply-exact-codes-across-six-two-and-three-digit-transitions",
    );

    const before = await sidc();
    dialog = await open("Common modifier 1");
    await screenshot("common-modifier-1500");
    await dialog
      .getByRole("button", { name: "Clear selection", exact: true })
      .click();
    const cleared = await sidc();
    assert.equal(cleared.slice(16, 18), "00");
    assert.equal(cleared[20], "0");
    assert.equal(cleared.slice(18, 20), before.slice(18, 20));
    assert.equal(cleared[21], before[21]);
    await choose("Second icon modifier", "02");
    assert.equal((await sidc())[21], "0");
    await trigger("Common modifier 2")
      .filter({ hasText: "Not selected" })
      .waitFor();
    pass("clearing-and-switching-sector-common-modifiers-preserves-other-slot");

    for (const width of [1120, 1500]) {
      await page.setViewportSize({ width, height: 900 });
      for (const title of [
        "Second icon modifier",
        "Main icon",
        "Common modifier 1",
        "First icon modifier",
        "Common modifier 2",
        "Main icon",
      ]) {
        dialog = await open(title);
        assert((await dialog.locator(".catalog-results button").count()) > 0);
        await page.keyboard.press("Escape");
      }
      dialog = await open("First icon modifier");
      await screenshot("sector-1-" + width);
      await page.keyboard.press("Escape");
    }
    pass(
      "repeated-selector-switches-work-at-both-widths-without-renderer-errors",
    );

    dialog = await open("Main icon");
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await dialog.locator('.catalog-results[aria-busy="false"]').waitFor();
    assert(await dialog.getByText(/^51–100 of/).isVisible());
    await dialog.getByLabel("Search choices").fill("NOT_A_REAL_SYMBOL_9D15");
    await dialog
      .getByText("No matching choices. Try another name or code.")
      .waitFor();
    assert.equal(await dialog.locator(".catalog-results button").count(), 0);
    assert(
      await dialog
        .getByRole("button", { name: "Next", exact: true })
        .isDisabled(),
    );
    await dialog.getByLabel("Search choices").fill("Infantry");
    await dialog.locator('.catalog-results[aria-busy="false"]').waitFor();
    const rows = dialog.locator(".catalog-results button");
    await rows.first().focus();
    await rows.first().press("ArrowDown");
    assert(await rows.nth(1).evaluate((el) => el === document.activeElement));
    await rows.nth(1).press("Home");
    assert(await rows.first().evaluate((el) => el === document.activeElement));
    await dialog.getByLabel("Search choices").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    assert(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      "Focus escaped selector",
    );
    await page.keyboard.press("Escape");
    pass("search-empty-results-pagination-arrow-navigation-and-focus-trap");

    const current = await sidc();
    dialog = await open("Main icon");
    await dialog.getByLabel("Search all symbol sets").check();
    await dialog.getByLabel("Search choices").fill("Fighter");
    await dialog.locator('.catalog-results[aria-busy="false"]').waitFor();
    await dialog.locator(".catalog-results button").first().click();
    await page
      .getByRole("dialog", { name: "Change symbol set", exact: true })
      .waitFor();
    await button("Keep current set").click();
    assert.equal(await sidc(), current);
    dialog = await open("Main icon");
    await dialog.getByLabel("Search all symbol sets").check();
    await dialog.getByLabel("Search choices").fill("Fighter");
    await dialog.locator('.catalog-results[aria-busy="false"]').waitFor();
    await dialog.locator(".catalog-results button").first().click();
    await button("Change set and reset components").click();
    assert.notEqual((await sidc()).slice(4, 6), "10");
    await field("Symbol set").selectOption("10");
    await button("Change set and reset components").click();
    pass(
      "cross-set-main-selection-requires-explicit-confirmation-and-cancel-preserves-symbol",
    );

    await choose("Main icon", "121100");
    await choose("Common modifier 1", "107");
    await choose("Common modifier 2", "103");
    finalSidc = await sidc();
    await button("Save symbol").click();
    await clean();
    const saved = (
      await call("symbols", { type: "get", kind: "SYMBOL", id: symbolId })
    ).symbol;
    assert.equal(saved.definition.code.sidc, finalSidc);
    const rendered = await call("renderGraphic", randomUUID(), {
      kind: "SYMBOL",
      input: {
        definition: saved.definition,
        size: 120,
        context: "SYMBOL",
        labelSide: "RIGHT",
      },
    });
    await page.waitForFunction((svg) => {
      const expected = document.createElement("div");
      expected.innerHTML = svg;
      return (
        document.querySelector(
          '.workbench-current .graphic-canvas[aria-busy="false"] svg',
        )?.outerHTML === expected.querySelector("svg")?.outerHTML
      );
    }, rendered.result.svg);
    pass("saved-definition-and-live-graphic-match-all-applied-components");

    await nav("ORBATs");
    await button("New ORBAT").click();
    await field("New ORBAT name").fill("FICTIONAL SELECTOR TREE");
    await button("Create ORBAT").click();
    await button("Choose root symbol").click();
    const rootPicker = page.getByRole("dialog", {
      name: "Choose symbol",
      exact: true,
    });
    await rootPicker.locator(".symbol-browse-row").first().click();
    await rootPicker
      .getByRole("button", { name: "Use symbol", exact: true })
      .click();
    await button("Edit selected unit symbol").click();
    await choose("Main icon", "121100");
    await choose("First icon modifier", "02");
    await choose("Common modifier 2", "103");
    await button("Done").click();
    await button("Save ORBAT").click();
    await clean();
    pass("shared-selector-works-inside-saved-orbat-inspector");
    assert.deepEqual(errors, []);
    await close();
    await launch();
    assert.equal(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: symbolId }))
        .symbol.definition.code.sidc,
      finalSidc,
    );
    assert.deepEqual(errors, []);
    await close();
    pass("normal-offline-clean-exit-reopen-retains-selected-components");
    write();
    console.log(JSON.stringify({ folder, checks: checks.length }));
  } catch (e) {
    write(e);
    if (page) {
      try {
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
        await screenshot("failure");
      } catch {}
      // Only save this isolated fictional editor so normal failure cleanup can finish.
      try {
        const save = page
          .getByRole("button", { name: /^(Save symbol|Save ORBAT)$/ })
          .filter({ visible: true });
        if ((await save.count()) === 1 && (await save.isEnabled())) {
          await save.click();
          await clean();
        }
      } catch {}
    }
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
