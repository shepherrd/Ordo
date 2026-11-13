const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "orbat-drag-" + uid());
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
  const dragTo = async (id, target, position = "CHILD") => {
    await ready();
    await canvas()
      .locator(".graphic-canvas")
      .evaluate((el) => el.scrollIntoView({ block: "center" }));
    await node(id).scrollIntoViewIfNeeded();
    const a = await node(id).boundingBox();
    assert(a);
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.waitForFunction(
      (id) =>
        document.querySelector('select[aria-label="Selected ORBAT unit"]')
          ?.value === id,
      id,
      { polling: 50 },
    );
    const b = await node(target).boundingBox();
    assert(b);
    const x = b.x + b.width / 2,
      y =
        b.y +
        b.height *
          (position === "BEFORE" ? 0.12 : position === "AFTER" ? 0.88 : 0.5);
    await page.mouse.move(x, y, { steps: 3 });
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
    node(id).evaluate((el) => {
      const symbol = el.querySelector("svg");
      const b = symbol
        ? {
            x: symbol.x.baseVal.value,
            y: symbol.y.baseVal.value,
            width: symbol.width.baseVal.value,
            height: symbol.height.baseVal.value,
          }
        : el.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
  const near = (a, b) => {
    for (const k of Object.keys(a))
      assert(
        Math.abs(a[k] - b[k]) < 0.15,
        k + ": preview " + a[k] + ", final " + b[k],
      );
  };
  const release = async () => {
    await page.mouse.up();
    await overlay().waitFor({ state: "detached" });
    await ready();
  };
  const cancel = async () => {
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await overlay().waitFor({ state: "detached" });
  };
  try {
    await launch();
    await page.setViewportSize({ width: 1500, height: 1000 });
    let symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL INFANTRY",
      })
    ).symbol;
    symbol.definition.code.sidc = "130310001412110000000000000000";
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
        name: "FICTIONAL DRAG WORKSPACE",
      })
    ).orbat;
    const root = map.rootNodeId,
      a = uid(),
      b = uid(),
      ac = uid(),
      bc = uid(),
      c = uid();
    map.nodes = [
      [root, null, "Fictional division"],
      [a, root, "Alpha company"],
      [b, root, "Bravo company"],
      [ac, a, "Alpha platoon"],
      [bc, b, "Bravo platoon"],
      [c, root, "Charlie company"],
    ].map(([id, parent, name]) => {
      const n = fixtureOrbatUnit(id, name);
      n.parentNodeId = parent;
      n.unit.symbol = {
        definition: structuredClone(symbol.definition),
        source: null,
      };
      n.unit.symbol.definition.amplifiers.uniqueDesignation = name;
      if (id === c) n.unit.symbol.definition.renderProfile.version = 2;
      return n;
    });
    map.layout.commandLevels = 1;
    map = (
      await call("symbols", {
        type: "save-orbat",
        value: map,
        expected: map.contentVersion,
      })
    ).orbat;
    await show(map.versionId);
    await node(a).click();
    assert.equal(
      await field("ORBAT unit display name").inputValue(),
      "Alpha company",
    );
    assert(await button("Save ORBAT").isDisabled());
    // Selection mode must never arm a drag, preview a move or change the tree.
    await dragTo(a, b);
    assert.equal(await canvas().getAttribute("data-dragging"), null);
    assert.equal(await overlay().count(), 0);
    await page.mouse.up();
    assert(await button("Save ORBAT").isDisabled());
    assert.deepEqual(await get(map.versionId), map);
    assert.equal(
      await page.getByText("Drag & drop help", { exact: true }).count(),
      0,
    );
    pass(
      "Select unit permits selection but prevents unit dragging and leaves hierarchy and layout unchanged",
    );
    await button("Change parent").click();
    await dragTo(a, b);
    await overlay().waitFor();
    assert.equal(await overlay().getAttribute("data-placement-unit"), a);
    assert.equal(await overlay().locator("[data-unit-id]").count(), 0);
    assert(
      (await overlay().evaluate((el) => +getComputedStyle(el).opacity)) < 1,
    );
    assert.deepEqual((await get(map.versionId)).nodes, map.nodes);
    await page.screenshot({
      path: path.join(folder, "saved-parent-preview.png"),
    });
    await cancel();
    assert(await button("Save ORBAT").isDisabled());
    pass(
      "Change parent previews the real symbol while dragging; Escape cancels without mutating the saved map",
    );
    const originalBox = await actualBox(a);
    await dragTo(a, b);
    await overlay().waitFor();
    const expected = await cardBox();
    await release();
    near(expected, await actualBox(a));
    measurements.push({
      kind: "structural-placement",
      preview: expected,
      actual: await actualBox(a),
    });
    await button("Undo ORBAT edit").click();
    await ready();
    near(originalBox, await actualBox(a));
    await button("Redo ORBAT edit").click();
    await ready();
    near(expected, await actualBox(a));
    await save();
    let moved = await get(map.versionId);
    assert.equal(moved.nodes.find((n) => n.nodeId === a).parentNodeId, b);
    assert.equal(moved.nodes.find((n) => n.nodeId === ac).parentNodeId, a);
    assert.deepEqual(
      moved.nodes.map((n) => n.nodeId),
      map.nodes.map((n) => n.nodeId),
    );
    for (const n of moved.nodes)
      assert.deepEqual(
        n.unit,
        map.nodes.find((o) => o.nodeId === n.nodeId).unit,
      );
    pass(
      "Drop matches preview coordinates, preserves both subtrees and exact symbols, and supports one-step undo/redo",
    );
    for (const [source, target] of [
      [root, b],
      [b, ac],
      [a, a],
    ]) {
      await dragTo(source, target);
      if (source === target) {
        const r = await node(source).boundingBox();
        await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.5, {
          steps: 3,
        });
      }
      await page
        .getByRole("alert")
        .filter({ hasText: /root|itself|descendants/ })
        .first()
        .waitFor();
      assert.equal(await overlay().count(), 0);
      await page.mouse.up();
      assert(await button("Save ORBAT").isDisabled());
    }
    pass(
      "Declared-root, self and descendant drops are rejected without data loss",
    );
    await field("ORBAT layout mode").selectOption("SIMPLE");
    await save();
    const beforeOrder = (await get(map.versionId)).nodes;
    await dragTo(a, bc, "BEFORE");
    await overlay().waitFor();
    const reordered = await cardBox();
    await page.screenshot({
      path: path.join(folder, "simple-reorder-preview.png"),
    });
    await release();
    await save();
    near(reordered, await actualBox(a));
    moved = await get(map.versionId);
    assert.deepEqual(moved.nodes, beforeOrder);
    assert(
      moved.layout.siblingOrder.indexOf(a) <
        moved.layout.siblingOrder.indexOf(bc),
    );
    pass(
      "Simple layout insertion previews sibling order without changing canonical units",
    );
    await dragTo(a, c);
    await overlay().waitFor();
    await page.mouse.move(5, 5);
    await page.mouse.up();
    assert.equal(await overlay().count(), 0);
    assert(await button("Save ORBAT").isDisabled());
    await dragTo(a, c);
    await overlay().waitFor();
    await canvas().dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    assert.equal(await overlay().count(), 0);
    assert(await button("Save ORBAT").isDisabled());
    pass(
      "Outside drop and pointer cancellation clear previews without applying a stale hover",
    );
    await button("Move position").click();
    await button("Reset zoom").click();
    await ready();
    await node(c).scrollIntoViewIfNeeded();
    const box = await node(c).boundingBox(),
      beforePosition = await actualBox(c);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 45,
      box.y + box.height / 2 + 25,
      { steps: 8 },
    );
    await overlay().waitFor();
    const translated = await overlay().evaluate((el) => {
      const r = el.querySelector("rect");
      const m = el.transform.baseVal.consolidate().matrix;
      return {
        x: +r.getAttribute("x") + 5 + m.e,
        y: +r.getAttribute("y") + 5 + m.f,
        width: +r.getAttribute("width") - 10,
        height: +r.getAttribute("height") - 10,
      };
    });
    near(translated, {
      ...beforePosition,
      x: beforePosition.x + 45,
      y: beforePosition.y + 25,
    });
    await page.screenshot({ path: path.join(folder, "position-preview.png") });
    await release();
    await save();
    near(translated, await actualBox(c));
    assert.deepEqual((await get(map.versionId)).nodes, beforeOrder);
    pass(
      "Move position previews actual zoom-scaled placement and alters only layout offsets",
    );
    await button("Select unit").click();
    await field("Fit diagram").check();
    await node(b).click();
    await page.getByText("Unit actions and layout", { exact: true }).click();
    await field("Fold descendants").check();
    await save();
    await button("Change parent").click();
    await dragTo(c, b);
    await overlay().waitFor();
    assert.match(await overlay().textContent(), /Inside folded unit/);
    await page.screenshot({
      path: path.join(folder, "folded-destination-preview.png"),
    });
    await cancel();
    await field("Selected ORBAT unit").selectOption(b);
    await field("Fold descendants").uncheck();
    await save();
    await page.getByText("Unit actions and layout", { exact: true }).click();
    await button("Expand diagram").click();
    await ready();
    await dragTo(c, b);
    await overlay().waitFor();
    await page.screenshot({ path: path.join(folder, "expanded-preview.png") });
    await cancel();
    assert(await button("Compact diagram").isVisible());
    await button("Compact diagram").click();
    await page.setViewportSize({ width: 1120, height: 900 });
    await ready();
    await dragTo(c, b);
    await overlay().waitFor();
    await page.screenshot({ path: path.join(folder, "narrow-preview.png") });
    assert.equal(
      await overlay().count(),
      1,
      "The placement card stays visible while holding the drag in a narrow window",
    );
    await cancel();
    pass(
      "Folded destinations explain hidden placement; expanded and narrow maps support dragging and cancellation",
    );
    const final = await get(map.versionId);
    await close();
    await launch();
    await show(map.versionId);
    assert.deepEqual((await get(map.versionId)).nodes, final.nodes);
    assert.deepEqual((await get(map.versionId)).layout, final.layout);
    assert.equal(await overlay().count(), 0);
    await close();
    assert.deepEqual(errors, []);
    pass(
      "Hierarchy and position persist through normal offline clean exit/reopen; transient cards are never stored",
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
