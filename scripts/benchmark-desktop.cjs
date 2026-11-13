// Local performance comparison on fictional data; normal Electron launch and exit.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { fileURLToPath } = require("node:url");
const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");

(async () => {
  const folder = path.resolve(".test-data", "optimization-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const evidence = {
    label: process.argv[2] || "measurement",
    version: require("../package.json").version,
    measurements: {},
    checks: [],
    errors: [],
  };
  evidence.buildFiles = fs
    .readdirSync("out", { recursive: true })
    .filter((p) => fs.statSync(path.join("out", p)).isFile())
    .sort()
    .map((p) => ({
      path: p,
      sha256: createHash("sha256")
        .update(fs.readFileSync(path.join("out", p)))
        .digest("hex"),
    }));
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "measurement.json"),
      JSON.stringify(evidence, null, 2),
    );
  let app, page;
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const measure = async (name, action) => {
    const start = performance.now();
    await action();
    await paint();
    evidence.measurements[name] =
      Math.round((performance.now() - start) * 10) / 10;
    console.log(name + ": " + evidence.measurements[name] + " ms");
    write();
  };
  const summary = (samples) => {
    const ordered = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return {
      samples,
      median:
        ordered.length % 2
          ? ordered[middle]
          : (ordered[middle - 1] + ordered[middle]) / 2,
    };
  };
  try {
    const started = performance.now();
    app = await electron.launch({
      env,
      args: [path.resolve("out/main/index.js")],
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page
      .getByRole("heading", { name: "Recent operations", exact: true })
      .waitFor();
    evidence.measurements.startupMs = performance.now() - started;
    const startupSession = await page.context().newCDPSession(page);
    const loaded = [];
    startupSession.on("Debugger.scriptParsed", ({ url }) => {
      if (url.startsWith("file:") && /\.js$/.test(url)) loaded.push(url);
    });
    await startupSession.send("Debugger.enable");
    await startupSession.send("Debugger.disable");
    await startupSession.detach();
    evidence.dashboardScripts = [...new Set(loaded)].map((url) => ({
      name: path.basename(fileURLToPath(url)),
      bytes: fs.statSync(fileURLToPath(url)).size,
    }));
    evidence.measurements.dashboardScriptBytes =
      evidence.dashboardScripts.reduce((sum, f) => sum + f.bytes, 0);
    write();
    const initial = await call("execute", { type: "load" });
    const doctrine = initial.doctrines.find(
      (d) => d.config.doctrine.catalog?.nodes.length === 185,
    );
    assert(doctrine);
    const operations = [];
    for (let i = 0; i < 3; i++) {
      let state = await call("execute", {
        type: "create",
        name: "FICTIONAL PERFORMANCE " + i,
        demo: true,
        configuration: { id: doctrine.doctrineVersionId, version: 1 },
      });
      const task = state.operation.tasks[0];
      assert(task);
      state.operation.tasks.push(
        ...Array.from({ length: 400 }, (_, n) => ({
          ...structuredClone(task),
          id: randomUUID(),
          name: "Fictional relief task " + n,
          purpose:
            "Deliver fictional supplies to the exercise reception centre.",
        })),
      );
      state = await call("execute", {
        type: "save",
        operation: state.operation,
        expectedRevision: state.operation.revision,
      });
      operations.push(state.operation);
    }
    for (const [index, op] of operations.entries()) {
      await nav("Operations");
      await measure("openOperation" + index + "Ms", async () => {
        await page.locator(`[data-operation-id="${op.id}"]`).click();
        await page
          .getByLabel("Operation name", { exact: true })
          .filter({ visible: true })
          .waitFor();
      });
    }
    const edit = async (suffix) =>
      page.evaluate(async (value) => {
        const input = [...document.querySelectorAll("input")].find(
          (el) =>
            el.getAttribute("aria-label") === "Operation name" &&
            el.getClientRects().length,
        );
        if (!input) throw Error("Operation name field missing");
        const start = performance.now();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return performance.now() - start;
      }, "FICTIONAL PERFORMANCE EDIT " + suffix);
    const samples = [];
    for (let i = 0; i < 12; i++) samples.push(await edit(i));
    evidence.measurements.operationEditMs = summary(samples);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.startPreciseCoverage", {
      callCount: true,
      detailed: false,
    });
    for (let i = 0; i < 5; i++) await edit("coverage " + i);
    const { result } = await cdp.send("Profiler.takePreciseCoverage");
    await cdp.send("Profiler.stopPreciseCoverage");
    evidence.operationEditCoverage = result
      .flatMap((r) => r.functions)
      .filter((f) =>
        /^(projectReadableOrder|validate|renderDocumentHtml|canonical)$/.test(
          f.functionName,
        ),
      )
      .map((f) => ({ function: f.functionName, calls: f.ranges[0].count }));
    await cdp.detach();
    assert.equal(
      await page
        .getByLabel("Operation name", { exact: true })
        .filter({ visible: true })
        .inputValue(),
      "FICTIONAL PERFORMANCE EDIT coverage 4",
    );
    await button("Save revision").click();
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    evidence.checks.push(
      "Three operation tabs retain independent drafts while repeated editing finishes on the latest value",
    );

    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional benchmark infantry",
      })
    ).symbol;
    const pin = (
      await call("symbols", { type: "symbol-pin", id: symbol.versionId })
    ).pin;
    let tree = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional benchmark formation",
      })
    ).orbat;
    tree.nodes = Array.from({ length: 127 }, (_, i) =>
      fixtureOrbatUnit(
        i ? randomUUID() : tree.rootNodeId,
        "Fictional unit " + i,
      ),
    );
    tree.nodes.forEach((n, i) => {
      n.parentNodeId = i ? tree.nodes[Math.floor((i - 1) / 2)].nodeId : null;
      n.unit.symbol = { definition: pin.definition, source: null };
    });
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    await nav("Symbols & ORBATs");
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    await measure("orbatOpen127UnitsMs", async () => {
      await page
        .getByLabel("ORBAT map", { exact: true })
        .selectOption(tree.versionId);
      await page
        .locator(
          '[aria-label="Interactive ORBAT diagram"] .graphic-canvas[aria-busy="false"] [data-unit-id]',
        )
        .first()
        .waitFor();
    });
    const unitButtons = page.locator(
      '[aria-label="Interactive ORBAT diagram"] .graphic-canvas [data-unit-id]',
    );
    const unitCount = await unitButtons.count();
    assert(unitCount > 1);
    const selectionTimes = [];
    for (let i = 0; i < 12; i++) {
      const start = performance.now();
      await unitButtons.nth(i % unitCount).dispatchEvent("click");
      await paint();
      selectionTimes.push(performance.now() - start);
    }
    evidence.measurements.orbatSelectionMs = summary(selectionTimes);
    evidence.checks.push(
      "A 127-unit ORBAT renders and repeated selections replace the selected unit",
    );
    assert.equal(
      await page
        .locator('[aria-label="Interactive ORBAT diagram"] .graphic-canvas')
        .getAttribute("data-selected-unit"),
      await unitButtons.nth(11 % unitCount).getAttribute("data-unit-id"),
    );
    await page
      .locator(
        `[aria-label="Interactive ORBAT diagram"] [data-unit-id="${tree.nodes[1].nodeId}"]`,
      )
      .dispatchEvent("click");
    await button("Change parent").click();
    await page.locator(".orbat-inspector > summary").click();
    const parentPicker = page.getByLabel("New ORBAT parent", { exact: true });
    const parentChoices = await parentPicker
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value));
    assert(!parentChoices.includes(tree.nodes[1].nodeId));
    assert(!parentChoices.includes(tree.nodes[3].nodeId));
    assert(parentChoices.includes(tree.nodes[2].nodeId));
    await parentPicker.selectOption(tree.nodes[2].nodeId);
    await button("Apply parent relationship").click();
    assert(await button("Save ORBAT").isEnabled());
    await button("Undo ORBAT edit").click();
    assert(await button("Save ORBAT").isDisabled());
    evidence.checks.push(
      "Indexed ORBAT parent choices exclude self and descendants; changing parent and undo remain valid",
    );
    const activate = async (id) =>
      page
        .locator(
          `[data-open-operation-id="${id}"]:visible .open-operation-name`,
        )
        .click();
    const operationNav = (name) =>
      page
        .getByRole("navigation", { name: "Operation navigation" })
        .getByRole("button", { name, exact: true })
        .click();
    const previewText = async (expected) => {
      const frame = page.frameLocator(
        "[data-operation-editor]:not([hidden]) iframe.document-frame",
      );
      await frame.getByText(expected, { exact: false }).first().waitFor();
      return frame.locator("body").innerText();
    };
    await activate(operations[2].id);
    await operationNav("Export studio");
    await previewText("FICTIONAL PERFORMANCE EDIT coverage 4");
    await operationNav("Overview");
    await edit("visible preview");
    await operationNav("Export studio");
    await previewText("FICTIONAL PERFORMANCE EDIT visible preview");
    await button("Save revision").click();
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    await button("Generate export").click();
    await button("Return to live").waitFor();
    const retainedText = await previewText(
      "FICTIONAL PERFORMANCE EDIT visible preview",
    );
    await operationNav("Overview");
    await edit("after retained export");
    await button("Save revision").click();
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    await operationNav("Export studio");
    await button("View").click();
    assert.equal(
      await previewText("FICTIONAL PERFORMANCE EDIT visible preview"),
      retainedText,
    );
    await button("Return to live").click();
    await previewText("FICTIONAL PERFORMANCE EDIT after retained export");
    await activate(operations[0].id);
    await operationNav("Export studio");
    const otherPreview = await previewText(operations[0].name);
    assert(!otherPreview.includes("after retained export"));
    evidence.checks.push(
      "Deferred previews use the latest edits, preserve retained exports, and stay isolated between operation tabs",
    );
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    assert.deepEqual(evidence.errors, []);
    const proc = app.process();
    await app.close();
    app = null;
    assert.equal(proc.exitCode, 0);
    evidence.checks.push("Normal offline shutdown without renderer errors");
    write();
    console.log(
      JSON.stringify({ folder, measurements: evidence.measurements }),
    );
  } catch (e) {
    evidence.failure = String(e);
    write();
    if (page)
      try {
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
