const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "symbol-drop-copy-" + uid());
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
  };
  const dragSaved = async (symbolId, targetId, edge = false) => {
    await ready();
    await canvas()
      .locator(".graphic-canvas")
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await node(targetId).scrollIntoViewIfNeeded();
    const source = page.locator(
      `.workbench-symbol-card[data-symbol-id="${symbolId}"]`,
    );
    await source.scrollIntoViewIfNeeded();
    const a = await source.boundingBox(),
      b = await node(targetId).boundingBox();
    assert(a && b);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, {
      steps: 2,
    });
    await page.mouse.move(
      b.x + b.width / 2,
      b.y + b.height * (edge ? 0.12 : 0.5),
      { steps: 4 },
    );
    // Chromium requires a second move to deliver native dragover.
    await page.mouse.move(
      b.x + b.width / 2 + 1,
      b.y + b.height * (edge ? 0.12 : 0.5),
    );
  };
  const cancel = async () => {
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await overlay().waitFor({ state: "detached" });
  };
  const cardBox = () =>
    overlay()
      .locator(".orbat-placement-card")
      .evaluate((el) => ({
        x: +el.getAttribute("x") + 5,
        y: +el.getAttribute("y") + 5,
        width: +el.getAttribute("width") - 10,
        height: +el.getAttribute("height") - 10,
      }));
  const actualBox = (id) =>
    node(id)
      .locator("svg")
      .first()
      .evaluate((el) => ({
        x: +el.getAttribute("x"),
        y: +el.getAttribute("y"),
        width: +el.getAttribute("width"),
        height: +el.getAttribute("height"),
      }));
  try {
    await launch();
    await page.setViewportSize({ width: 1500, height: 960 });
    let symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional supply unit",
      })
    ).symbol;
    symbol.definition.renderProfile.version = 2;
    symbol.definition.amplifiers.uniqueDesignation = "Fictional supply unit";
    symbol.definition.compatibility.signature = "!";
    symbol = (
      await call("symbols", {
        type: "save-symbol",
        value: symbol,
        expected: symbol.contentVersion,
      })
    ).symbol;
    let map = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional placement and copy",
      })
    ).orbat;
    const root = fixtureOrbatUnit(map.rootNodeId, "Fictional command"),
      child = fixtureOrbatUnit(uid(), "Fictional existing child");
    root.unit.symbol = {
      definition: structuredClone(symbol.definition),
      source: null,
    };
    root.unit.symbol.definition.renderProfile.version = 1;
    child.parentNodeId = root.nodeId;
    child.unit.symbol = structuredClone(root.unit.symbol);
    map.nodes = [root, child];
    map = (
      await call("symbols", {
        type: "save-orbat",
        value: map,
        expected: map.contentVersion,
      })
    ).orbat;
    await show(map.versionId);
    await page.evaluate(() => {
      window.dragPayloadReads = [];
      document.addEventListener("dragover", (event) => {
        if (event.dataTransfer?.types.includes("application/x-ordo-symbol"))
          window.dragPayloadReads.push(
            event.dataTransfer.getData("application/x-ordo-symbol").length,
          );
      });
    });
    await dragSaved(symbol.versionId, root.nodeId);
    await overlay().waitFor();
    assert(
      (await page.evaluate(() => window.dragPayloadReads)).includes(0),
      "Must exercise native protected DataTransfer",
    );
    assert.equal(await overlay().locator("[data-unit-id]").count(), 0);
    assert((await overlay().textContent()).includes("Fictional"));
    assert.deepEqual((await get(map.versionId)).nodes, map.nodes);
    assert(await button("Save ORBAT").isDisabled());
    await page.screenshot({
      path: path.join(folder, "native-subordinate-preview.png"),
    });
    await cancel();
    assert(await button("Save ORBAT").isDisabled());
    pass(
      "Native protected-data drag shows the real symbol ghost without editing the map; Escape clears it",
    );

    await dragSaved(symbol.versionId, root.nodeId, true);
    await page.getByRole("alert").filter({ hasText: "one root" }).waitFor();
    assert.equal(await overlay().count(), 0);
    await cancel();
    await dragSaved(symbol.versionId, root.nodeId);
    await overlay().waitFor();
    const previewId = await overlay().getAttribute("data-placement-unit"),
      box = await cardBox();
    await page.mouse.up();
    await overlay().waitFor({ state: "detached" });
    await node(previewId).waitFor();
    await ready();
    const actual = await actualBox(previewId);
    for (const key of Object.keys(box))
      assert(
        Math.abs(box[key] - actual[key]) < 0.1,
        `${key} placement differs: ${box[key]} vs ${actual[key]}`,
      );
    measurements.push({ preview: box, actual });
    await button("Undo ORBAT edit").click();
    await node(previewId).waitFor({ state: "detached" });
    await button("Redo ORBAT edit").click();
    await save();
    map = await get(map.versionId);
    assert.equal(map.nodes.length, 3);
    assert.deepEqual(map.nodes.slice(0, 2), [root, child]);
    assert.equal(
      map.nodes.find((n) => n.nodeId === previewId).parentNodeId,
      root.nodeId,
    );
    assert.equal(
      map.nodes.find((n) => n.nodeId === previewId).unit.symbol.definition
        .renderProfile.version,
      2,
    );
    pass(
      "Drop matches the ghost geometry and identity, preserves mixed profiles and existing units, and supports undo/redo; invalid root-edge drop has no ghost",
    );

    await page.locator(".orbat-inspector > summary").click();
    await field("Selected ORBAT unit").selectOption(root.nodeId);
    await field("Fold descendants").check();
    await save();
    await dragSaved(symbol.versionId, root.nodeId);
    await overlay().getByText("Inside folded unit", { exact: true }).waitFor();
    assert(await overlay().locator("svg").count());
    await page.screenshot({
      path: path.join(folder, "folded-symbol-preview.png"),
    });
    await cancel();
    await field("Fold descendants").uncheck();
    await field("ORBAT layout mode").selectOption("SIMPLE");
    await save();
    await dragSaved(symbol.versionId, child.nodeId, true);
    await overlay().waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: "Insert before Fictional existing child" })
      .waitFor();
    await page.screenshot({
      path: path.join(folder, "simple-sibling-preview.png"),
    });
    await cancel();
    pass(
      "Folded destinations show the new symbol at the fold marker; SIMPLE sibling previews cancel without adding units",
    );

    await field("Selected ORBAT unit").selectOption(previewId);
    await field("ORBAT unit display name").fill("Fictional copied unit");
    await field("ORBAT annotation").fill("Independent copy note");
    await save();
    const beforeCopy = await get(map.versionId);
    const catalog = () =>
      call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: { search: "", status: "", offset: 0, limit: 30 },
      }).then((r) => r.page);
    await current()
      .getByRole("button", { name: "Save to symbols", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Save unit symbol",
      exact: true,
    });
    await dialog.getByLabel("Symbol name", { exact: true }).fill("   ");
    assert(
      await dialog
        .getByRole("button", { name: "Save symbol copy", exact: true })
        .isDisabled(),
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await catalog()).total, 1);
    await current()
      .getByRole("button", { name: "Save to symbols", exact: true })
      .click();
    await dialog
      .getByLabel("Symbol name", { exact: true })
      .fill("Fictional library copy");
    await page.screenshot({ path: path.join(folder, "save-unit-symbol.png") });
    await dialog
      .getByRole("button", { name: "Save symbol copy", exact: true })
      .click();
    await dialog.waitFor({ state: "detached" });
    await page
      .locator(".workbench-symbol-card")
      .filter({ hasText: "Fictional library copy" })
      .waitFor();
    assert.equal((await catalog()).total, 2);
    const copyId = (await catalog()).items.find(
      (i) => i.name === "Fictional library copy",
    ).versionId;
    const copy = (
      await call("symbols", { type: "get", kind: "SYMBOL", id: copyId })
    ).symbol;
    assert.notEqual(
      copy.definition.definitionId,
      symbol.definition.definitionId,
    );
    assert.deepEqual(
      { ...copy.definition, definitionId: symbol.definition.definitionId },
      {
        ...symbol.definition,
        amplifiers: {
          ...symbol.definition.amplifiers,
          uniqueDesignation: "Fictional copied unit",
          additionalInformation: "Independent copy note",
        },
      },
    );
    assert.deepEqual(await get(map.versionId), beforeCopy);
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: symbol.versionId,
        })
      ).symbol,
      symbol,
    );
    assert(await button("Save ORBAT").isDisabled());
    pass(
      "Save to symbols creates one independent named copy with current labels, annotation and profile; cancel creates nothing and the source map and symbol remain unchanged",
    );
    copy.definition.amplifiers.uniqueDesignation = "Later library edit";
    await call("symbols", {
      type: "save-symbol",
      value: copy,
      expected: copy.contentVersion,
    });
    assert.deepEqual(await get(map.versionId), beforeCopy);
    await close();
    await launch();
    assert.deepEqual(await get(map.versionId), beforeCopy);
    assert.equal((await catalog()).total, 2);
    assert.equal(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: copyId }))
        .symbol.definition.amplifiers.uniqueDesignation,
      "Later library edit",
    );
    assert.deepEqual(errors, []);
    await close();
    pass(
      "Independent symbol copy and ORBAT survive normal offline close/reopen; later library edits do not modify the unit",
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
