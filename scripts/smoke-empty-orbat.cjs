// Empty-map creation and first-root regression. Fictional data only.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "empty-orbat-" + uid());
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

  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const empty = () => page.getByRole("region", { name: "Empty ORBAT canvas" });
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const ready = () =>
    page
      .locator(
        '.orbat-canvas-workspace .graphic-canvas[aria-busy="false"] > div > svg',
      )
      .waitFor();
  const get = (id) =>
    call("symbols", { type: "get", kind: "ORBAT", id }).then((r) => r.orbat);
  const create = async (name) => {
    await button("New ORBAT").click();
    await field("New ORBAT name").fill(name);
    await button("Create ORBAT").click();
    // The previous empty canvas can remain visible while creation is pending.
    // Wait for the new map itself before retaining its identifier.
    await page.waitForFunction(
      (name) =>
        document.querySelector('select[aria-label="ORBAT map"]')
          ?.selectedOptions[0]?.textContent === name,
      name,
    );
    await clean();
    await empty().waitFor();
    return field("ORBAT map").inputValue();
  };
  const showMap = async (id) => {
    await nav();
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    await field("ORBAT map").selectOption(id);
  };
  const drop = async (text) =>
    empty().evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData("application/x-ordo-symbol", text);
      el.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    }, text);
  try {
    await launch();
    await page.setViewportSize({ width: 1500, height: 960 });
    let symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional 38th Division",
      })
    ).symbol;
    symbol.definition.code.sidc = "130310002112110200000000000000";
    symbol = (
      await call("symbols", {
        type: "save-symbol",
        value: symbol,
        expected: symbol.contentVersion,
      })
    ).symbol;
    await nav();
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    const id = await create("Fictional empty map");
    const initial = await get(id);
    assert.deepEqual(initial.nodes, []);
    assert.equal(
      await page.locator(".orbat-canvas-workspace [data-unit-id]").count(),
      0,
    );
    assert.equal(await field("ORBAT unit display name").count(), 0);
    assert(await button("Export").isDisabled());
    await page.locator(".workbench-symbol-card svg").waitFor();
    const canvasBox = await empty().boundingBox(),
      compositionBox = await page
        .locator(".orbat-composition:visible")
        .boundingBox();
    assert(
      canvasBox.width >= compositionBox.width - 4,
      "Empty canvas must use the diagram area",
    );
    await page.screenshot({ path: path.join(folder, "empty-1500.png") });
    await page.setViewportSize({ width: 1120, height: 900 });
    await page.screenshot({ path: path.join(folder, "empty-1120.png") });
    await field("ORBAT name").fill("Fictional saved empty map");
    await button("Save ORBAT").click();
    await clean();
    assert.deepEqual((await get(id)).nodes, []);
    const spare = await create("Fictional keyboard root map");
    assert.notEqual(spare, id);
    assert.deepEqual((await get(spare)).nodes, []);
    await field("ORBAT map").selectOption(id);
    await empty().waitFor();
    pass(
      "New maps are truly empty; names can be saved and maps switched without creating a placeholder unit",
    );
    await close();
    await launch();
    await showMap(id);
    await empty().waitFor();
    assert.deepEqual((await get(id)).nodes, []);
    pass("A saved empty ORBAT survives normal clean exit and reopen");
    await drop('{"kind":"CATALOG","id":"invalid"}');
    await clean();
    await page.getByRole("alert").filter({ visible: true }).waitFor();
    assert.deepEqual((await get(id)).nodes, []);
    await page.setViewportSize({ width: 1500, height: 960 });
    await page
      .locator(
        '.workbench-symbol-card[data-symbol-id="' + symbol.versionId + '"]',
      )
      .dragTo(empty());
    await field("ORBAT unit display name").waitFor();
    assert.equal(
      await field("ORBAT unit display name").inputValue(),
      symbol.name,
    );
    await ready();
    assert.equal(
      await page.locator(".orbat-canvas-workspace [data-unit-id]").count(),
      1,
    );
    await button("Undo ORBAT edit").click();
    await empty().waitFor();
    assert.equal(
      await page.locator(".orbat-canvas-workspace [data-unit-id]").count(),
      0,
    );
    await button("Redo ORBAT edit").click();
    await ready();
    await button("Save ORBAT").click();
    await clean();
    const rooted = await get(id),
      root = rooted.nodes[0];
    assert.equal(rooted.nodes.length, 1);
    assert.equal(root.nodeId, rooted.rootNodeId);
    assert.equal(root.parentNodeId, null);
    assert.deepEqual(root.unit.symbol.definition, symbol.definition);
    assert.equal(root.unit.identity.fullDesignation, symbol.name);
    assert.notEqual(root.unit.symbol.source.versionId, symbol.versionId);
    assert.deepEqual(
      await call("symbols", { type: "symbol-pin", id: symbol.versionId }).then(
        (r) => r.pin.definition,
      ),
      root.unit.symbol.definition,
    );
    await page.screenshot({ path: path.join(folder, "dragged-root-1500.png") });
    pass(
      "Invalid drops leave the map empty; dragging a real library symbol creates exactly one root, with working undo/redo and an exact independent symbol snapshot",
    );
    await page.locator(".orbat-inspector > summary").click();
    await button("Add subordinate unit").click();
    await field("ORBAT unit display name").fill("Fictional Company");
    await button("Save ORBAT").click();
    await clean();
    const withChild = await get(id);
    assert.equal(withChild.nodes.length, 2);
    assert.equal(withChild.nodes[1].parentNodeId, root.nodeId);
    await field("ORBAT map").selectOption(spare);
    await empty().waitFor();
    await button("Choose root symbol").click();
    const picker = page.getByRole("dialog", {
      name: "Choose symbol",
      exact: true,
    });
    await picker
      .getByRole("button", { name: symbol.name, exact: true })
      .click();
    await picker
      .getByRole("button", { name: "Use symbol", exact: true })
      .click();
    await ready();
    assert.equal(
      await field("ORBAT unit display name").inputValue(),
      symbol.name,
    );
    await button("Save ORBAT").click();
    await clean();
    assert.deepEqual((await get(spare)).nodes[0].unit.symbol, root.unit.symbol);
    pass(
      "Root symbol can also be chosen without dragging; normal subordinate authoring works after the first unit is added",
    );
    const modified = structuredClone(symbol);
    modified.definition.appearance.fillColor = "#ffaa00";
    await call("symbols", {
      type: "save-symbol",
      value: modified,
      expected: symbol.contentVersion,
    });
    assert.deepEqual(
      (await get(id)).nodes[0].unit.symbol.definition,
      symbol.definition,
    );
    await close();
    await launch();
    await showMap(id);
    await ready();
    assert.deepEqual((await get(id)).nodes, withChild.nodes);
    assert.equal(
      await page.locator(".orbat-canvas-workspace [data-unit-id]").count(),
      2,
    );
    await close();
    assert.deepEqual(errors, []);
    pass(
      "Root and hierarchy persist across another normal offline reopen; later library symbol edits do not alter the ORBAT copy",
    );
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
