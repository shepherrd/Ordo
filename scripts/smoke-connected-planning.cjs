// Fictional isolated data; normal offline Electron startup, clean exit/reopen.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(
    ".test-data",
    "connected-desktop-" + randomUUID(),
  );
  fs.mkdirSync(folder, { recursive: true });
  const executable = process.argv[2];
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const evidence = {
    executable: executable ?? "development build",
    checks: [],
    errors: [],
    events: [],
    buildFiles: fs
      .readdirSync("out", { recursive: true })
      .filter((p) => fs.statSync(path.join("out", p)).isFile())
      .sort()
      .map((p) => ({
        path: p,
        sha256: createHash("sha256")
          .update(fs.readFileSync(path.join("out", p)))
          .digest("hex"),
      })),
  };
  const record = () =>
    fs.writeFileSync(
      path.join(folder, "result.json"),
      JSON.stringify(evidence, null, 2),
    );
  const pass = (name) => {
    evidence.checks.push(name);
    record();
    console.log("PASS " + name);
  };
  let app, page, operationId;
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const launch = async () => {
    app = await electron.launch({
      ...(executable
        ? { executablePath: path.resolve(executable), args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1500, height: 1000 });
    evidence.events.push({ stage: "ready", pid: app.process().pid });
    record();
  };
  const close = async () => {
    const proc = app.process();
    await app.close();
    assert.equal(proc.exitCode, 0);
    evidence.events.push({
      stage: "exited",
      pid: proc.pid,
      exitCode: proc.exitCode,
    });
    app = null;
    record();
  };
  const search = async (query) => {
    await page.keyboard.press("Control+k");
    const region = page.locator('[aria-label="Search Ordo"]');
    await region.getByRole("textbox", { name: "Find in Ordo" }).fill(query);
    await region.locator(".search-result").first().waitFor();
    return region;
  };
  try {
    await launch();
    const initial = await call("execute", { type: "load" });
    const config = initial.configurations.find((c) => !c.doctrine.catalog);
    assert(config, "Starter configuration");
    let state = await call("execute", {
      type: "create",
      name: "Fictional connected planning acceptance",
      demo: true,
      configuration: {
        id: config.doctrine.id,
        version: config.doctrine.version,
      },
    });
    operationId = state.operation.id;
    const taskId = state.operation.tasks[0].id;
    state.operation.tasks[0].name = "Fictional reception task";
    state.operation.tasks[0].purpose = "Saved reception purpose";
    state = await call("execute", {
      type: "save",
      operation: state.operation,
      expectedRevision: state.operation.revision,
    });
    await page.reload();
    await openOperation(page, operationId);
    let dialog = await search("Fictional reception task");
    await page.evaluate(() => {
      window.__acceptanceFocus = [];
      document.addEventListener("focusin", (event) => {
        window.__acceptanceFocus.push(event.target.outerHTML.slice(0, 400));
      });
    });
    await dialog
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    const task = page
      .locator(`[data-entity-id="${taskId}"]`)
      .filter({ visible: true });
    await task.getByRole("textbox", { name: "Task", exact: true }).waitFor();
    await page.waitForFunction(
      (el) => document.activeElement === el,
      await task
        .getByRole("textbox", { name: "Task", exact: true })
        .elementHandle(),
    );
    await task
      .getByRole("textbox", { name: "Purpose", exact: true })
      .fill("Working amber purpose");
    dialog = await search("working amber");
    assert.match(
      await dialog.locator(".search-result").first().innerText(),
      /Working/,
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const persisted = await call("execute", { type: "load", operationId });
    assert.equal(
      persisted.operation.tasks[0].purpose,
      "Saved reception purpose",
    );
    pass(
      "Ctrl+K resolves the task field; applied draft search leaves the saved revision unchanged",
    );
    await navigateOperation(page, "Base order");
    await page
      .getByLabel("Module type", { exact: true })
      .selectOption("PLANNING_CARDS");
    await button("Add operation module").click();
    await button("Insert linked card").click();
    const picker = page.locator('[aria-label="Choose card source"]');
    await picker
      .getByLabel("Find card source", { exact: true })
      .fill("Fictional reception task");
    await picker
      .getByRole("button", { name: "Fictional reception task", exact: true })
      .click();
    await picker
      .getByRole("button", { name: "Insert card", exact: true })
      .click();
    const reuse = page.getByLabel("Reuse planning card", { exact: true });
    const cardId = await reuse.locator("option").nth(1).getAttribute("value");
    await reuse.selectOption(cardId);
    await page
      .locator(".planning-card")
      .first()
      .getByRole("button", { name: "Make independent copy", exact: true })
      .click();
    await page
      .locator(".planning-card")
      .first()
      .getByText("Independent copy", { exact: true })
      .waitFor();
    pass(
      "Two placements share a linked card; detaching one creates a separate editable copy",
    );
    await page
      .locator(".planning-card")
      .nth(1)
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await task
      .getByRole("textbox", { name: "Purpose", exact: true })
      .fill("Updated violet purpose");
    await task
      .getByRole("button", { name: "Remove task", exact: true })
      .click();
    await page.locator('[aria-label="Delete linked source"]').waitFor();
    await button("Cancel").click();
    await navigateOperation(page, "Base order");
    assert.match(
      await page.locator(".planning-card").first().innerText(),
      /Working amber purpose/,
    );
    assert.match(
      await page.locator(".planning-card").nth(1).innerText(),
      /Updated violet purpose/,
    );
    await page.screenshot({
      path: path.join(folder, "cards.png"),
      fullPage: true,
    });
    await button("Save revision").click();
    await page
      .locator('[data-workspace-dirty="false"]')
      .filter({ visible: true })
      .first()
      .waitFor();
    state = await call("execute", { type: "load", operationId });
    assert.equal(state.operation.planningCards.definitions.length, 2);
    pass(
      "Source edits update only linked placements; deletion offers an explicit cancel/copy/remove decision",
    );
    const profile = state.profiles.find((p) => p.product === "opord");
    assert(profile);
    profile.inclusion.paragraphIds = [];
    profile.inclusion.attachmentIds = [];
    profile.inclusion.packageScope = "selected";
    state = await call("execute", {
      type: "save-profile",
      profile,
      isNew: false,
    });
    const retainedProfile = state.profiles.find((p) => p.id === profile.id);
    state = await call("execute", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      profileRef: { id: retainedProfile.id, version: retainedProfile.version },
      publicationId: null,
    });
    const output = state.exports[0];
    assert.equal(output.schemaVersion, 7);
    assert.match(output.html, /Updated violet purpose/);
    assert.match(output.html, /Working amber purpose/);
    fs.writeFileSync(path.join(folder, "order.html"), output.html);
    const { record: pdf } = await call("documents", {
      type: "generate",
      operationId,
      exportId: output.id,
      options: { paper: "A4", orientation: "portrait" },
    });
    assert.equal(pdf.printVersion, "ordo-print-v3");
    await app.evaluate(
      ({ app }, args) => {
        const req = process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/package.json"),
          db = new (req("better-sqlite3"))(args.database, { readonly: true });
        try {
          const row = db
            .prepare("SELECT bytes FROM document_exports WHERE id=?")
            .get(args.id);
          req("node:fs").writeFileSync(args.output, row.bytes);
        } finally {
          db.close();
        }
      },
      {
        database: path.join(folder, "workspace", "ordo.db"),
        id: pdf.id,
        output: path.join(folder, "order.pdf"),
      },
    );
    pass(
      "Current renderer retains in-place linked and copied card HTML and generates a real PDF with print-v3 provenance",
    );
    await close();
    await launch();
    state = await call("execute", { type: "load", operationId });
    assert.equal(
      state.exports.find((e) => e.id === output.id).html,
      output.html,
    );
    assert.equal(
      (await call("documents", { type: "list", operationId })).records[0]
        .contentHash,
      pdf.contentHash,
    );
    await openOperation(page, operationId);
    dialog = await search("Updated violet");
    await dialog.getByRole("button", { name: "Used in", exact: true }).click();
    await dialog
      .getByText("Source recorded in this product", { exact: false })
      .waitFor();
    await page.screenshot({
      path: path.join(folder, "search.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    pass(
      "Clean restart verifies retained HTML/PDF and search Used in reports the recorded product",
    );
    const backup = path.join(folder, "cards-backup.db");
    const globalNav = page.getByRole("navigation", {
      name: "Global navigation",
    });
    await globalNav
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, backup);
    await button("Back up workspace").click();
    await page.getByText("Backup saved:", { exact: false }).waitFor();
    const priorSearch = await call("search", {
      query: "Updated violet",
      sequence: 1,
    });
    assert(priorSearch.hits.length);
    await page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
    await navigateOperation(page, "Overview");
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill("Fictional restore sentinel");
    await button("Save revision").click();
    await page
      .locator('[data-workspace-dirty="false"][data-workspace-busy="false"]')
      .waitFor();
    dialog = await search("restore sentinel");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await globalNav
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, backup);
    await button("Restore backup").click();
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    assert.equal(await page.locator("[data-operation-editor]").count(), 0);
    assert.equal(
      (await call("search", { query: "restore sentinel", sequence: 2 })).hits
        .length,
      0,
    );
    await assert.rejects(
      call("resolveSearch", {
        target: priorSearch.hits[0].target,
        sourceToken: priorSearch.hits[0].sourceToken,
        workspaceGeneration: priorSearch.workspaceGeneration,
      }),
      /workspace changed/i,
    );
    state = await call("execute", { type: "load", operationId });
    assert.equal(state.operation.planningCards.definitions.length, 2);
    assert.equal(
      state.exports.find((e) => e.id === output.id).html,
      output.html,
    );
    assert.equal(
      (await call("documents", { type: "list", operationId })).records[0]
        .contentHash,
      pdf.contentHash,
    );
    dialog = await search("Updated violet");
    assert.match(
      await dialog.locator(".search-result").first().innerText(),
      /Saved/,
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    pass(
      "Workspace backup/restore preserves cards and frozen products, clears open draft providers, rebuilds search, and rejects pre-restore targets",
    );
    assert.deepEqual(evidence.errors, []);
  } catch (e) {
    evidence.failure = String(e.stack ?? e);
    if (page)
      evidence.focus = await page
        .evaluate(() => ({
          active: document.activeElement?.outerHTML.slice(0, 800),
          history: window.__acceptanceFocus,
        }))
        .catch(() => null);
    record();
    console.error(e);
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png"), fullPage: true })
        .catch(() => {});
    process.exitCode = 1;
  } finally {
    if (app) await close();
    console.log(folder);
    record();
  }
})();
