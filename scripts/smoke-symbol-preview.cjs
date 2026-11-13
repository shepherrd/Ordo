// Regression for the compact preview's scrollbar / auto-fit resize loop.
// Fictional data only. The division SIDC reproduces the reported 38th MID shape.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "symbol-preview-" + uid());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
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
  const fitCheck = async (name) => {
    await current()
      .locator('.graphic-canvas[aria-busy="false"] > div > svg')
      .waitFor();
    const samples = await current()
      .locator(".graphic-canvas")
      .evaluate(async (canvas) => {
        const values = [];
        for (let i = 0; i < 60; i++) {
          await new Promise(requestAnimationFrame);
          const svg = canvas.querySelector("svg"),
            frame = canvas.getBoundingClientRect(),
            graphic = svg.getBoundingClientRect(),
            css = getComputedStyle(canvas);
          const left = frame.left + parseFloat(css.paddingLeft),
            top = frame.top + parseFloat(css.paddingTop);
          const right =
              frame.left + canvas.clientWidth - parseFloat(css.paddingRight),
            bottom =
              frame.top + canvas.clientHeight - parseFloat(css.paddingBottom);
          values.push({
            zoom: Number(
              canvas.firstElementChild.style.getPropertyValue("--graphic-zoom"),
            ),
            height: frame.height,
            clipped:
              graphic.left < left - 1 ||
              graphic.top < top - 1 ||
              graphic.right > right + 1 ||
              graphic.bottom > bottom + 1,
            centered:
              Math.abs(graphic.left + graphic.right - (left + right)) < 2 &&
              Math.abs(graphic.top + graphic.bottom - (top + bottom)) < 2,
            scroll: [canvas.scrollWidth, canvas.scrollHeight],
            client: [canvas.clientWidth, canvas.clientHeight],
          });
        }
        return values;
      });
    measurements.push({ name, samples });
    const settled = samples.slice(10);
    assert.equal(
      new Set(settled.map((s) => s.zoom.toFixed(6))).size,
      1,
      name + ": fit keeps oscillating",
    );
    assert.equal(
      new Set(settled.map((s) => s.height)).size,
      1,
      name + ": viewport height keeps changing",
    );
    for (const s of settled) {
      assert(!s.clipped, name + ": fitted graphic is clipped");
      assert(s.centered, name + ": fitted graphic is not centered");
      assert(
        s.scroll[0] <= s.client[0] + 1 && s.scroll[1] <= s.client[1] + 1,
        name + ": fit retains scroll overflow",
      );
    }
  };
  const selectSymbol = async (symbol) => {
    await page
      .locator(`.workbench-symbol-card[data-symbol-id="${symbol.versionId}"]`)
      .click();
    await page
      .getByRole("heading", { name: symbol.name, exact: true })
      .waitFor();
  };
  const toolbarCheck = async (name) => {
    const workspace = page.locator(".global-workspace");
    const actions = page.getByRole("toolbar", {
      name: /^(Symbol|ORBAT) workspace actions$/,
    });
    await workspace.evaluate((el) => {
      el.scrollTop = 0;
    });
    const initial = await actions.boundingBox();
    // Put the command row at the top of the viewport, where the old sticky
    // tabs covered it after scrolling or switching back from another page.
    await workspace.evaluate((el, top) => {
      el.scrollTop = Math.max(0, top - el.getBoundingClientRect().top - 4);
    }, initial.y);
    const geometry = await actions.evaluate((actions) => {
      const tabs = document
        .querySelector(".workbench-tabs")
        .getBoundingClientRect();
      const bar = actions.getBoundingClientRect();
      return { tabsBottom: tabs.bottom, actionsTop: bar.top };
    });
    measurements.push({ name, geometry });
    assert(
      geometry.actionsTop >= geometry.tabsBottom,
      name + ": workspace tabs cover file actions",
    );
    for (const action of await actions.getByRole("button").all()) {
      if (await action.isEnabled()) await action.click({ trial: true });
    }
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      name + ": page overflow",
    );
    await page.screenshot({ path: path.join(folder, name + ".png") });
    await workspace.evaluate((el) => {
      el.scrollTop = 0;
    });
  };
  try {
    await launch();
    let division = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL DIVISION FIT",
      })
    ).symbol;
    division.definition.code.sidc = "130310002112110200000000000000";
    division = (
      await call("symbols", {
        type: "save-symbol",
        value: division,
        expected: division.contentVersion,
      })
    ).symbol;
    let labels = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL LONG LABEL FIT",
      })
    ).symbol;
    labels.definition.code.sidc = division.definition.code.sidc;
    labels.definition.amplifiers = {
      uniqueDesignation:
        "Fictional Mobile Infantry Division and Attached Support Elements",
      higherFormation: "Fictional Regional Command",
      additionalInformation: "Training reference only — long information text",
    };
    labels.definition.compatibility.signature = "FICTIONAL";
    labels.definition.compatibility.stack = 3;
    labels.definition.renderProfile.version = 2;
    labels = (
      await call("symbols", {
        type: "save-symbol",
        value: labels,
        expected: labels.contentVersion,
      })
    ).symbol;
    const sourceHash = (
      await call("renderGraphic", uid(), {
        kind: "SYMBOL",
        input: {
          definition: division.definition,
          size: 120,
          context: "SYMBOL",
          labelSide: "RIGHT",
        },
      })
    ).result.svgHash;
    await nav();
    await toolbarCheck("empty-editor");
    await selectSymbol(division);
    for (const width of [1500, 1120, 850, 1440, 1500]) {
      await page.setViewportSize({ width, height: 960 });
      await toolbarCheck("symbol-toolbar-" + width);
      await fitCheck("division-" + width);
    }
    await page.screenshot({ path: path.join(folder, "division-fit.png") });
    pass(
      "Division preview remains centered, fully contained and stable across repeated window resizing",
    );
    assert.equal(await current().locator(".graphic-preview button").count(), 0);
    await selectSymbol(labels);
    assert.equal(await current().locator(".graphic-preview button").count(), 0);
    await fitCheck("long-labels-and-stack");
    await page.screenshot({ path: path.join(folder, "labels-fit.png") });
    pass(
      "Preview always fits without manual controls; choosing another symbol automatically contains long labels and stacking",
    );
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    await toolbarCheck("empty-orbat-toolbar");
    await page.getByRole("tab", { name: "Symbol editor", exact: true }).click();
    await fitCheck("symbol-after-tab-switch");
    let orbat = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "FICTIONAL PREVIEW MAP",
      })
    ).orbat;
    orbat.nodes = [
      require("./fixture-orbat-unit.cjs").fixtureOrbatUnit(
        orbat.rootNodeId,
        "Fictional root",
      ),
    ];
    orbat.nodes[0].symbolOverride = {
      definition: division.definition,
      source: null,
    };
    const child = structuredClone(orbat.nodes[0]);
    child.nodeId = uid();
    child.parentNodeId = orbat.rootNodeId;
    child.nameOverride = "Fictional long-label subordinate unit";
    child.symbolOverride = { definition: labels.definition, source: null };
    orbat.nodes.push(child);
    orbat = (
      await call("symbols", {
        type: "save-orbat",
        value: orbat,
        expected: orbat.contentVersion,
      })
    ).orbat;
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    await page
      .getByLabel("ORBAT map", { exact: true })
      .selectOption(orbat.versionId);
    await current()
      .locator(`[data-preview-unit-id="${orbat.rootNodeId}"]`)
      .waitFor();
    await fitCheck("orbat-root");
    assert.equal(await current().locator(".graphic-preview button").count(), 0);
    await page
      .locator(`.orbat-canvas-workspace [data-unit-id="${child.nodeId}"]`)
      .click();
    await current()
      .locator(`[data-preview-unit-id="${child.nodeId}"]`)
      .waitFor();
    await fitCheck("orbat-selected-child");
    await toolbarCheck("selected-orbat-toolbar");
    await page.screenshot({ path: path.join(folder, "selected-unit-fit.png") });
    pass(
      "Switching views and selecting ORBAT units keeps the same stable preview fitting",
    );
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: division.versionId,
        })
      ).symbol,
      division,
    );
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: labels.versionId,
        })
      ).symbol,
      labels,
    );
    assert.equal(
      (
        await call("renderGraphic", uid(), {
          kind: "SYMBOL",
          input: {
            definition: division.definition,
            size: 120,
            context: "SYMBOL",
            labelSide: "RIGHT",
          },
        })
      ).result.svgHash,
      sourceHash,
    );
    pass(
      "Preview fitting does not change saved definitions, explicit render profiles or generated SVG bytes",
    );
    const settings = () =>
      page
        .getByRole("navigation", { name: "Global navigation" })
        .getByRole("button", { name: "Settings", exact: true })
        .click();
    await settings();
    const themes = await page
      .getByLabel("Color theme", { exact: true })
      .locator("option")
      .evaluateAll((items) => items.map((o) => o.value));
    for (const theme of themes) {
      await page.getByLabel("Color theme", { exact: true }).selectOption(theme);
      await nav();
      await page
        .getByRole("tab", { name: "Symbol editor", exact: true })
        .click();
      await toolbarCheck("toolbar-" + theme);
      await settings();
    }
    pass(
      "Symbol and ORBAT file actions stay unobstructed after scrolling, resizing and changing themes",
    );
    await close();
    await launch();
    await nav();
    await selectSymbol(division);
    await fitCheck("reopened-division");
    await close();
    assert.deepEqual(errors, []);
    pass("Normal offline clean exit and reopen retain a stable fitted preview");
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
