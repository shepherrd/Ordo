const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "orbat-selection-preview-" + uid());
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
  const inspect = async (unit, label) => {
    await current()
      .getByRole("heading", {
        name: unit.unit.identity.fullDesignation,
        exact: true,
      })
      .waitFor();
    if (unit.unit.symbol) {
      await current()
        .locator('.graphic-canvas[aria-busy="false"] svg')
        .last()
        .waitFor();
    } else {
      await current()
        .getByText("No symbol selected.", { exact: true })
        .waitFor();
    }
    const result = {
      label,
      nodeId: unit.nodeId,
      previews: await current().locator(".graphic-preview").count(),
      canvases: await current().locator(".graphic-canvas").count(),
      saveButtons: await current()
        .getByRole("button", { name: "Save to symbols", exact: true })
        .count(),
    };
    measurements.push(result);
    write();
    assert.equal(
      result.previews,
      unit.unit.symbol ? 1 : 0,
      label + ": current selection must replace the previous preview",
    );
    assert.equal(
      result.canvases,
      unit.unit.symbol ? 1 : 0,
      label + ": only the current canvas may remain",
    );
    assert.equal(result.saveButtons, 1);
    if (unit.unit.symbol) {
      await page.waitForFunction((name) => {
        const preview = document.querySelector(
          ".workbench-current .graphic-canvas[aria-busy='false'] svg",
        );
        return preview?.textContent
          .replace(/\s/g, "")
          .includes(name.replace(/\s/g, ""));
      }, unit.unit.identity.fullDesignation);
    } else {
      assert(
        await current()
          .getByRole("button", { name: "Save to symbols", exact: true })
          .isDisabled(),
      );
    }
    await clean();
    assert(await button("Save ORBAT").isDisabled());
  };
  try {
    await launch();
    await page.setViewportSize({ width: 1500, height: 960 });
    const source = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional selection source",
      })
    ).symbol;
    let map = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional selection regression",
      })
    ).orbat;
    const units = [
      "Fictional command",
      "Fictional relief company",
      "Fictional air support",
      "Fictional liaison",
    ].map((name, index) => {
      const unit = fixtureOrbatUnit(index ? uid() : map.rootNodeId, name);
      unit.parentNodeId = index ? map.rootNodeId : null;
      if (index < 3) {
        unit.unit.symbol = {
          definition: structuredClone(source.definition),
          source: null,
        };
        unit.unit.symbol.definition.renderProfile.version = index === 2 ? 2 : 1;
        unit.unit.symbol.definition.amplifiers.uniqueDesignation = name;
      }
      return unit;
    });
    map.nodes = units;
    map = (
      await call("symbols", {
        type: "save-orbat",
        value: map,
        expected: map.contentVersion,
      })
    ).orbat;
    await show(map.versionId);
    for (const index of [0, 1, 2, 0, 2, 1]) {
      await field("Selected ORBAT unit").selectOption(units[index].nodeId);
      await inspect(units[index], "Dropdown " + index);
    }
    assert.deepEqual(await get(map.versionId), map);
    pass(
      "Repeated dropdown selections replace the preview and leave the saved ORBAT unchanged",
    );

    for (const index of [2, 0, 1, 2]) {
      await node(units[index].nodeId).click();
      await inspect(units[index], "Canvas " + index);
    }
    // Switch repeatedly without waiting for asynchronous symbol rendering.
    for (const index of [0, 2, 1, 0, 1, 2]) {
      await field("Selected ORBAT unit").selectOption(units[index].nodeId);
    }
    await inspect(units[2], "Rapid selection final target");
    await page.screenshot({
      path: path.join(folder, "single-selected-preview.png"),
    });
    assert.deepEqual(await get(map.versionId), map);
    pass(
      "Canvas clicks and rapid selection changes retain exactly one preview of the latest unit",
    );

    await field("Selected ORBAT unit").selectOption(units[3].nodeId);
    await inspect(units[3], "Unit without a symbol");
    await field("Selected ORBAT unit").selectOption(units[0].nodeId);
    await inspect(units[0], "Return to symbol unit");
    await page.getByRole("tab", { name: "Symbol editor", exact: true }).click();
    assert.equal(await current().locator(".workbench-unit-preview").count(), 0);
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    await inspect(units[0], "Return from symbol editor");
    await page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Dashboard", exact: true })
      .click();
    await nav();
    await inspect(units[0], "Return from dashboard");
    pass(
      "Symbolless units clear the canvas; changing editor or navigation does not retain stale previews",
    );

    await field("Selected ORBAT unit").selectOption(units[2].nodeId);
    await inspect(units[2], "Copy current unit");
    await current()
      .getByRole("button", { name: "Save to symbols", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Save unit symbol",
      exact: true,
    });
    assert.equal(
      await dialog.getByLabel("Symbol name", { exact: true }).inputValue(),
      units[2].unit.identity.fullDesignation,
    );
    await dialog
      .getByRole("button", { name: "Save symbol copy", exact: true })
      .click();
    await dialog.waitFor({ state: "detached" });
    await page
      .locator(".workbench-symbol-card")
      .filter({ hasText: units[2].unit.identity.fullDesignation })
      .waitFor();
    const catalog = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: { search: "", status: "", offset: 0, limit: 30 },
      })
    ).page;
    assert.equal(catalog.total, 2);
    const copiedId = catalog.items.find(
      (s) => s.name === units[2].unit.identity.fullDesignation,
    ).versionId;
    const copied = (
      await call("symbols", { type: "get", kind: "SYMBOL", id: copiedId })
    ).symbol;
    assert.deepEqual(
      {
        ...copied.definition,
        definitionId: units[2].unit.symbol.definition.definitionId,
      },
      units[2].unit.symbol.definition,
    );
    await inspect(units[2], "After saving a copy");
    await field("Selected ORBAT unit").selectOption(units[1].nodeId);
    await inspect(units[1], "Selection after saving a copy");
    assert.equal(
      await current().getByRole("status").count(),
      0,
      "Old copy confirmation must not follow the new selection",
    );
    assert.deepEqual(await get(map.versionId), map);
    pass(
      "Save to symbols copies only the current selection with its exact render profile, without changing the ORBAT",
    );

    await close();
    await launch();
    await page.setViewportSize({ width: 1500, height: 960 });
    await show(map.versionId);
    await field("Selected ORBAT unit").selectOption(units[1].nodeId);
    await inspect(units[1], "Reopened workspace");
    assert.deepEqual(await get(map.versionId), map);
    assert.deepEqual(errors, []);
    await close();
    pass(
      "Normal offline clean exit and reopen preserve the ORBAT and a single selected preview",
    );
  } catch (e) {
    write(e);
    if (page) {
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
      fs.writeFileSync(
        path.join(folder, "failure-dom.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
    }
    throw e;
  } finally {
    if (app) await app.close();
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
