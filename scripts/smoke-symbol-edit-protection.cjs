// Fictional isolated workspace; normal launch/exit/reopen without startup flags.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "symbol-edit-protection-" + uid());
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

  try {
    await launch();
    const expectedVersion = "v" + (await call("workspaceInfo")).appVersion;
    await page
      .locator('[aria-label="Application version"]:visible')
      .filter({ hasText: expectedVersion })
      .waitFor();
    assert(
      (
        await page
          .locator('[aria-label="Application version"]:visible')
          .allTextContents()
      ).every((v) => v === expectedVersion),
    );
    const entry = (
      await call("symbolCatalog", {
        type: "builtin-browse",
        collection: "LEGACY",
        group: "GRDTRK_UNT",
        search: "",
        offset: 0,
        limit: 1,
      })
    ).builtin.entries[0];
    const symbol = (
      await call("symbols", {
        type: "new-symbol-from-definition",
        name: "FICTIONAL POLISH SYMBOL",
        definition: entry.definition,
      })
    ).symbol;
    const recoveryKey = { kind: "symbol", id: symbol.versionId, scope: null };
    const recoveryToken = (
      await call("recovery", { type: "get", key: recoveryKey })
    ).token;
    await call("recovery", {
      type: "put",
      token: recoveryToken,
      key: recoveryKey,
      source: JSON.stringify(symbol),
      value: JSON.stringify({
        ...symbol,
        name: "FICTIONAL EARLIER WORKING COPY",
      }),
      label: symbol.name,
      expected: 0,
    });
    await nav("Military Symbols");
    await page.locator('[data-symbol-id="' + symbol.versionId + '"]').click();
    await button("Recover working copy").waitFor();
    await field("Legacy function").fill("UCI---");
    assert(await button("Recover working copy").isDisabled());
    await page
      .getByText("Version family and maintenance", { exact: true })
      .click();
    await page.getByText("Import Ordo JSON", { exact: true }).click();
    for (const name of [
      "Publish symbol",
      "Duplicate to new symbol family",
      "Reset symbol…",
    ])
      assert(await button(name).isDisabled(), name);
    assert(await field("SIDC").isDisabled());
    assert(await button("Delete symbol version").isDisabled());
    await field("Saved Symbol name").fill("FICTIONAL POLISH SYMBOL EDITED");
    assert(await button("Save symbol draft").isDisabled());
    assert(await button("Discard symbol edits").isDisabled());
    assert(await button("Choose JSON and preview").isDisabled());
    report(
      "symbol-publish-import-export-replace-and-delete-require-field-resolution",
    );
    await nav("Dashboard");
    await nav("Military Symbols");
    assert.equal(await field("Legacy function").inputValue(), "UCI---");
    await button("Apply Legacy function").click();
    await button("Discard recovery copy").click();
    await button("Save symbol draft").click();
    await clean();
    const symbolSaved = (
      await call("symbols", {
        type: "get",
        kind: "SYMBOL",
        id: symbol.versionId,
      })
    ).symbol;
    assert.equal(symbolSaved.name, "FICTIONAL POLISH SYMBOL EDITED");
    assert.equal(symbolSaved.definition.code.sidc.slice(4, 10), "UCI---");
    report("hidden-symbol-fields-survive-navigation-and-explicit-apply-save");

    let orbat = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "FICTIONAL POLISH ORBAT",
      })
    ).orbat;
    orbat.nodes = [
      require("./fixture-orbat-unit.cjs").fixtureOrbatUnit(
        orbat.rootNodeId,
        "Fictional root",
      ),
    ];
    orbat.nodes[0].unit.symbol = {
      definition: structuredClone(entry.definition),
      source: null,
    };
    orbat.nodes[0].unit.symbol.definition.definitionId = uid();
    const child = structuredClone(orbat.nodes[0]);
    child.nodeId = uid();
    child.parentNodeId = orbat.rootNodeId;
    child.unit.identity.fullDesignation = "FICTIONAL CHILD";
    child.unit.symbol.definition.definitionId = uid();
    orbat.nodes.push(child);
    orbat = (
      await call("symbols", {
        type: "save-orbat",
        value: orbat,
        expected: orbat.contentVersion,
      })
    ).orbat;
    await nav("ORBATs");
    await page
      .getByRole("button")
      .filter({ has: page.getByText(orbat.name, { exact: true }) })
      .click();
    await button("Edit symbol override").click();
    await field("Legacy identity").fill("H");
    await field("Legacy function").fill("UCI---");
    for (const name of [
      "Publish ORBAT",
      "Edit symbol override",
      "Replace symbol only",
      "Add inline child",
    ])
      assert(await button(name).isDisabled(), name);
    assert(await field("Selected ORBAT unit").isDisabled());
    await button("Select unit").click();
    await page
      .locator('.orbat-canvas-workspace [data-unit-id="' + child.nodeId + '"]')
      .first()
      .click();
    assert.equal(
      await field("Selected ORBAT unit").inputValue(),
      orbat.rootNodeId,
    );
    report(
      "saved-orbat-pending-fields-block-selection-replacement-and-publication",
    );
    await button("Apply Legacy identity").click();
    assert.equal(await field("Legacy function").inputValue(), "UCI---");
    assert(await button("Apply Legacy function").isEnabled());
    await button("Apply Legacy function").click();
    await button("Save ORBAT draft").click();
    await clean();
    const orbatSaved = (
      await call("symbols", { type: "get", kind: "ORBAT", id: orbat.versionId })
    ).orbat;
    assert.equal(
      orbatSaved.nodes[0].symbolOverride.definition.code.sidc[1],
      "H",
    );
    assert.equal(
      orbatSaved.nodes[0].symbolOverride.definition.code.sidc.slice(4, 10),
      "UCI---",
    );
    assert.deepEqual(
      orbatSaved.nodes[0].unit.symbol,
      orbat.nodes[0].unit.symbol,
    );
    assert.deepEqual(orbatSaved.nodes[1], orbat.nodes[1]);
    report("applying-one-field-preserves-other-pending-fields-and-frozen-base");

    const state = await call("execute", {
      type: "create",
      name: "FICTIONAL POLISH OPERATION",
      demo: true,
    });
    const operation = state.operation;
    operation.units[0].symbol = {
      schemaVersion: 1,
      base: { definition: structuredClone(entry.definition), source: null },
      override: null,
      labels: {
        uniqueDesignation: { kind: "UNIT_NAME" },
        higherFormation: { kind: "DEFINITION" },
      },
    };
    await call("execute", {
      type: "save",
      operation,
      expectedRevision: operation.revision,
    });
    await nav("Operations");
    await page.locator('[data-operation-id="' + operation.id + '"]').click();
    await button(/^(?:A )?Task organization$/i).click();
    await button("ORBAT view").click();
    assert(
      (
        await page
          .locator('[aria-label="Application version"]:visible')
          .allTextContents()
      ).every((v) => v === expectedVersion),
    );
    report("global-and-operation-sidebar-match-reported-build-version");
    await page.getByText("Edit selected unit symbol", { exact: true }).click();
    await button("Edit operation symbol override").click();
    await field("Legacy function").fill("UCI---");
    for (const name of [
      "Save revision",
      "Tree view",
      "Undo draft edit",
      "Close symbol editor",
      "Replace Symbol",
      "Reset to inherited symbol",
    ])
      assert(await button(name).isDisabled(), name);
    assert(await field("Selected operation unit").isDisabled());
    await button("Overview").click();
    assert.equal(await field("Legacy function").inputValue(), "UCI---");
    await nav("Dashboard");
    await page
      .locator(
        '[data-open-operation-id="' +
          operation.id +
          '"]:visible .open-operation-name',
      )
      .click();
    assert.equal(await field("Legacy function").inputValue(), "UCI---");
    report(
      "operation-pending-fields-block-save-close-switch-undo-and-page-replacement",
    );
    await button("Discard Legacy function edit").click();
    await page
      .getByRole("alert")
      .filter({
        hasText: "Apply or discard the highlighted symbol field edits",
      })
      .waitFor({ state: "hidden" });
    await button("Close symbol editor").click();
    await button("Save revision").click();
    await clean();
    const operationSaved = (
      await call("execute", { type: "load", operationId: operation.id })
    ).operation;
    assert.equal(
      operationSaved.units[0].symbol.override.definition.code.sidc,
      entry.definition.code.sidc,
    );
    await button("Tree view").click();
    const treeSymbol = page.locator(
      '[data-entity-id="' + operation.units[0].id + '"]',
    );
    await treeSymbol.getByText("Military symbol", { exact: true }).click();
    await button("Edit operation symbol override").click();
    await field("Legacy function").fill("UCI---");
    await treeSymbol.getByText("Military symbol", { exact: true }).click();
    assert(await field("Legacy function").isVisible());
    await button("Discard Legacy function edit").click();
    await page
      .getByRole("alert")
      .filter({
        hasText: "Apply or discard the highlighted symbol field edits",
      })
      .waitFor({ state: "hidden" });
    await button("Close symbol editor").click();
    await clean();
    report(
      "explicit-discard-keeps-saved-code-and-tree-collapse-cannot-lose-fields",
    );
    await capture("symbol-edit-protection.png");
    assert.deepEqual(errors, []);
    await close();
    await launch();
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: symbol.versionId,
        })
      ).symbol,
      symbolSaved,
    );
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "ORBAT",
          id: orbat.versionId,
        })
      ).orbat,
      orbatSaved,
    );
    assert.deepEqual(
      (await call("execute", { type: "load", operationId: operation.id }))
        .operation,
      operationSaved,
    );
    await close();
    report("normal-clean-exit-and-reopen-retain-exact-records");
    write();
    console.log(JSON.stringify({ folder, checks: checks.length }));
  } catch (e) {
    write(e);
    if (page)
      try {
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    // Failure cleanup remains a normal app close; no process termination.
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
