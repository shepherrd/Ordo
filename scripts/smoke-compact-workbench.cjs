const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const baseline = process.argv.includes("--baseline");
  const folder = path.resolve(".test-data", "compact-workbench-" + uid());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  // Keep host desktop pointer movements from interrupting synthetic held drags.
  // The existing test option only hides the normal BrowserWindow; no flags.
  env.ORDO_HEADLESS = "1";
  const checks = [],
    measurements = [],
    errors = [],
    events = [];
  const buildFiles = fs
    .readdirSync("out", { recursive: true })
    .filter((p) => fs.statSync(path.join("out", p)).isFile())
    .sort()
    .map((p) => ({
      path: p,
      sha256: createHash("sha256")
        .update(fs.readFileSync(path.join("out", p)))
        .digest("hex"),
    }));
  let app, page;
  const write = (failure) =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          version: require("../package.json").version,
          packaged: false,
          purpose: baseline
            ? "before-layout comparison"
            : "compact-workbench verification",
          windowMode: "HIDDEN",
          checks,
          measurements,
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
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const nav = () =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Symbols & ORBATs", exact: true })
      .click();
  const current = () => page.locator(".workbench-current");
  const launch = async () => {
    events.push({ stage: "launch", at: new Date().toISOString() });
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(25000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (/same key|unique.*key/i.test(message.text()))
        errors.push(message.text());
    });
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    events.push({
      stage: "ready",
      at: new Date().toISOString(),
      pid: app.process().pid,
    });
  };
  const close = async () => {
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
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
    events.push({ stage: "fully-exited", at: new Date().toISOString(), pids });
  };

  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });

  const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");
  const canvas = () =>
    page.locator(
      '.orbat-canvas-workspace:visible [aria-label="Interactive ORBAT diagram"]',
    );
  const ready = () =>
    canvas()
      .locator('.graphic-canvas[aria-busy="false"] > div > svg')
      .waitFor();
  const node = (id) =>
    canvas()
      .locator('[data-unit-id="' + id + '"]')
      .first();
  const overlay = () => canvas().locator(".orbat-placement-preview");
  const get = (id) =>
    call("symbols", { type: "get", kind: "ORBAT", id }).then((r) => r.orbat);
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const save = async () => {
    await button("Save ORBAT").click();
    await clean();
    await ready();
  };
  const show = async (id) => {
    await nav();
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    await field("ORBAT map").selectOption(id);
    await ready();
    const inspector = page.locator(".orbat-inspector");
    if (!(await inspector.evaluate((el) => el.open))) {
      await inspector.locator(":scope > summary").click();
    }
  };
  const measure = async (view, width, height) => {
    await page.setViewportSize({ width, height });
    await page
      .locator(".workspace:visible")
      .evaluate((el) => el.scrollTo(0, 0));
    await current().locator('.graphic-canvas[aria-busy="false"] svg').waitFor();
    // Thumbnails render lazily after list scroll/resize; capture settled cards.
    await page.waitForFunction(() => {
      const list = document
        .querySelector(".workbench-symbol-list")
        .getBoundingClientRect();
      const visible = [
        ...document.querySelectorAll(
          ".workbench-symbol-list .saved-symbol-thumbnail",
        ),
      ].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > list.top + 1 && r.top < list.bottom - 1;
      });
      return (
        visible.length > 0 && visible.every((el) => el.querySelector("svg"))
      );
    });
    const metric = await page.evaluate(
      ({ view, width, height }) => {
        const bounds = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r && { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const workspace = document.querySelector(".workspace.global-workspace");
        const list = document.querySelector(".workbench-symbol-list");
        return {
          view,
          width,
          height,
          horizontalOverflow: workspace.scrollWidth - workspace.clientWidth,
          rail: bounds(".workbench-rail"),
          preview: bounds(".workbench-current .graphic-canvas"),
          list: bounds(".workbench-symbol-list"),
          listScroll: list.scrollHeight > list.clientHeight,
          map:
            view === "orbat"
              ? bounds("#orbat-workbench-panel .graphic-canvas")
              : null,
          controls: view === "symbol" ? bounds(".symbol-controls") : null,
        };
      },
      { view, width, height },
    );
    measurements.push(metric);
    assert(metric.horizontalOverflow <= 1, JSON.stringify(metric));
    if (!baseline)
      assert(
        metric.list.height >= 90,
        "Saved symbols must retain usable independent scrolling",
      );
    assert(metric.listScroll);
    await page.screenshot({ path: path.join(folder, `${view}-${width}.png`) });
    write();
  };
  try {
    await launch();
    await page.setViewportSize({ width: 1500, height: 960 });
    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional 38th Mobile Infantry Division",
      })
    ).symbol;
    symbol.definition.amplifiers.uniqueDesignation =
      "38th Mobile Infantry Division";
    symbol.definition.code.sidc = "130310000012110000000000000000";
    await call("symbols", {
      type: "save-symbol",
      value: symbol,
      expected: symbol.contentVersion,
    });
    for (let i = 1; i <= 12; i++)
      await call("symbols", {
        type: "new-symbol-from-definition",
        name: `Fictional ${i} Relief Company`,
        definition: symbol.definition,
      });
    let map = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional compact workspace",
      })
    ).orbat;
    map.nodes = [
      "Fictional command",
      "Fictional logistics",
      "Fictional medical",
      "Fictional liaison",
    ].map((name, i) => {
      const unit = fixtureOrbatUnit(i ? uid() : map.rootNodeId, name);
      unit.parentNodeId = i ? map.rootNodeId : null;
      unit.unit.symbol = {
        definition: structuredClone(symbol.definition),
        source: null,
      };
      return unit;
    });
    map = (
      await call("symbols", {
        type: "save-orbat",
        value: map,
        expected: map.contentVersion,
      })
    ).orbat;
    await show(map.versionId);
    await page.locator(".orbat-inspector > summary").click();
    for (const [w, h] of [
      [1500, 960],
      [1280, 800],
      [1000, 760],
    ])
      await measure("orbat", w, h);
    assert.deepEqual(await get(map.versionId), map);
    pass(
      "ORBAT workspace fits three desktop widths with an independently scrolling saved-symbol list and unchanged source data",
    );
    if (!baseline) {
      await page.setViewportSize({ width: 1500, height: 960 });
      await ready();
      assert.equal(await field("ORBAT command levels").count(), 1);
      assert.equal(await page.locator(".orbat-command-levels").count(), 0);
      assert.equal(
        await field("ORBAT command levels").getAttribute("min"),
        "1",
      );
      assert.equal(
        await field("ORBAT command levels").getAttribute("max"),
        "64",
      );
      for (const level of ["1", "64"]) {
        await field("ORBAT command levels").fill(level);
        await ready();
        await button("Undo ORBAT edit").click();
        assert.equal(
          await field("ORBAT command levels").inputValue(),
          String(map.layout.commandLevels),
        );
      }
      await clean();
      pass(
        "One command-level control retains the full 1–64 range and undo behavior",
      );
      const view = canvas().locator(".graphic-preview");
      for (const name of [
        "Reset zoom",
        "Pan canvas",
        "Expand diagram",
        "Show selected unit",
      ]) {
        assert.equal(
          await view
            .getByRole("button", { name, exact: true })
            .getAttribute("title"),
          name,
        );
      }
      await view.getByRole("button", { name: "Zoom in", exact: true }).click();
      await view
        .getByRole("button", { name: "Reset zoom", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#orbat-workbench-panel .graphic-canvas > div")
            ?.style.getPropertyValue("--graphic-zoom") === "1",
      );
      await view
        .getByRole("button", { name: "Pan canvas", exact: true })
        .click();
      assert.equal(
        await view.locator(".graphic-canvas").getAttribute("data-pan"),
        "true",
      );
      await node(map.rootNodeId).focus();
      await page.keyboard.press("Escape");
      assert.equal(
        await view.locator(".graphic-canvas").getAttribute("data-pan"),
        null,
      );
      await view
        .getByRole("button", { name: "Expand diagram", exact: true })
        .click();
      const expanded = page.getByRole("dialog", {
        name: "Graphic preview",
        exact: true,
      });
      await expanded.waitFor();
      await expanded
        .getByRole("button", { name: "Show selected unit", exact: true })
        .click();
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.getAttribute("data-unit-id"),
        ),
        map.rootNodeId,
      );
      await expanded
        .getByRole("button", { name: "Compact diagram", exact: true })
        .click();
      await expanded.waitFor({ state: "detached" });
      await field("ORBAT name").fill("Fictional renamed map");
      await button("Undo ORBAT edit").focus();
      await page.keyboard.press("Enter");
      assert.equal(await field("ORBAT name").inputValue(), map.name);
      await button("Redo ORBAT edit").focus();
      await page.keyboard.press("Space");
      assert.equal(
        await field("ORBAT name").inputValue(),
        "Fictional renamed map",
      );
      await button("Discard ORBAT edits").click();
      await clean();
      assert.deepEqual(await get(map.versionId), map);
      pass(
        "Compact toolbar icons retain labels, tooltips, zoom/pan/expand/focus actions and keyboard undo/redo; rename and discard leave source data unchanged",
      );
    }
    await page.locator(`[data-symbol-id="${symbol.versionId}"]`).click();
    for (const [w, h] of [
      [1500, 960],
      [1280, 800],
      [1000, 760],
    ])
      await measure("symbol", w, h);
    pass(
      "Symbol workspace fits three desktop widths, retaining one live preview and the saved-symbol library",
    );
    await close();
    assert.deepEqual(errors, []);
    pass("Normal offline launch and clean exit without renderer errors");
  } catch (e) {
    write(e);
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
    throw e;
  } finally {
    if (app) await app.close();
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
