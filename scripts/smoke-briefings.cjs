// Historical briefing workflow for a future release; excluded from 1.0.0 qualification.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(".test-data", "briefing-desktop-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const executable = process.argv[2],
    env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const evidence = {
    executable: executable ?? "development build",
    checks: [],
    errors: [],
    lifecycle: [],
    screenshots: [],
    buildFiles: fs
      .readdirSync("out", { recursive: true })
      .filter((p) => fs.statSync(path.join("out", p)).isFile())
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
  let app, page, operationId, deckId, retained;
  const button = (name) =>
      page.getByRole("button", { name, exact: true }).filter({ visible: true }),
    label = (name) =>
      page.getByLabel(name, { exact: true }).filter({ visible: true });
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
    await page.setViewportSize({ width: 1600, height: 1100 });
    evidence.lifecycle.push({ stage: "ready", pid: app.process().pid });
    record();
  };
  const close = async () => {
    const proc = app.process();
    await app.close();
    app = null;
    evidence.lifecycle.push({
      stage: "exited",
      pid: proc.pid,
      exitCode: proc.exitCode,
    });
    record();
    assert.equal(proc.exitCode, 0);
  };
  const save = async () => {
    await button("Save revision").click();
    await page
      .locator('[data-workspace-dirty="false"][data-workspace-busy="false"]')
      .filter({ visible: true })
      .first()
      .waitFor();
  };
  const shot = async (name) => {
    if (!(await page.locator(".briefing-presentation").count()))
      await page
        .locator("main.workspace:visible")
        .evaluate((el) => (el.scrollTop = 0));
    const frame = page
      .locator(".briefing-preview iframe")
      .last()
      .contentFrame();
    await frame.getByRole("heading").first().waitFor();
    // A previously hidden iframe may paint on Chromium's throttled schedule.
    // The preview disables scripts; do not schedule callbacks in its sandbox.
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(folder, name + ".png"),
      fullPage: true,
    });
    evidence.screenshots.push(name + ".png");
    record();
  };
  const global = () =>
    page.getByRole("navigation", { name: "Global navigation" });
  const openTab = () =>
    page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
  try {
    await launch();
    const initial = await call("execute", { type: "load" }),
      config = initial.configurations.find((c) => !c.doctrine.catalog);
    let state = await call("execute", {
      type: "create",
      name: "Fictional delivery three briefing",
      demo: true,
      configuration: {
        id: config.organization.id,
        version: config.organization.version,
      },
    });
    operationId = state.operation.id;
    const graphic = await call("exportGraphic", {
      source: {
        kind: "OPERATION",
        operationId,
        revision: state.operation.revision,
        publicationId: null,
      },
      profile: {
        schemaVersion: 1,
        id: randomUUID(),
        version: 1,
        name: "Fictional task organization",
        product: "ORBAT",
        format: "SVG",
        scale: 1,
        background: "WHITE",
        size: 40,
        foldPolicy: "EXPANDED",
        ancestorPolicy: "BOUNDARY",
        selectedUnitIds: null,
        renderProfile: { id: "ordo-symbol", version: 1 },
      },
    });
    await openOperation(page, operationId);
    await navigateOperation(page, "Briefings");
    await button("New briefing").click();
    await label("Briefing name").fill("Operation Lantern briefing");
    await label("Slide footer").fill("FICTIONAL TRAINING");
    await label("Slide title").fill("Operation Lantern");
    await label("Slide text").fill("Planning update\n16 October 2026");
    await button("Add slide").click();
    await label("Slide title").fill("Commander’s update");
    await label("Slide text").fill(
      "Purpose\nCoordinate the fictional relief effort.\n\nDecisions\nConfirm the assembly time and support priorities.",
    );
    await label("Presenter notes (excluded from PDF)").fill(
      "Presenter-only reminder",
    );
    await button("Add slide").click();
    await label("Slide layout").selectOption("cards");
    await label("Slide title").fill("Assigned task");
    await button("Add planning content").click();
    await label("Search briefing content").fill(state.operation.tasks[0].name);
    await page
      .locator(".planning-card-sources")
      .getByRole("button", { name: new RegExp(state.operation.tasks[0].name) })
      .first()
      .click();
    await button("Add linked content").click();
    await button("Make independent copy").click();
    await page.getByText("Independent copy", { exact: true }).waitFor();
    await button("Add slide").click();
    await label("Slide layout").selectOption("graphic");
    await label("Slide title").fill("Task organization");
    await label("Saved briefing graphic").selectOption(graphic.id);
    await page.locator(".briefing-preview iframe").waitFor();
    await button("Duplicate slide").click();
    await button("Move slide up").click();
    await button("Remove slide").click();
    await save();
    state = await call("execute", { type: "load", operationId });
    deckId = state.operation.briefings.decks[0].id;
    assert.equal(state.operation.briefings.decks[0].slides.length, 4);
    assert.equal(
      state.operation.planningCards.definitions.at(-1).mode,
      "independent",
    );
    pass(
      "Create four layouts, add linked content, detach a copy, select a retained ORBAT, reorder, duplicate and remove slides, then save",
    );
    await navigateOperation(page, "Overview");
    await page.keyboard.press("Control+k");
    await label("Find in Ordo").fill("Presenter-only reminder");
    await page.locator(".search-result").first().click();
    await page
      .locator('[aria-label="Search preview"]')
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await label("Slide title").waitFor();
    assert.equal(await label("Slide title").inputValue(), "Commander’s update");
    pass("Unified search opens the exact briefing slide by its note text");
    await button("Present briefing").click();
    await page
      .getByRole("dialog", { name: "Operation Lantern briefing presentation" })
      .waitFor();
    await page.keyboard.press("ArrowRight");
    await page.getByText("Slide 2 of 4", { exact: true }).waitFor();
    await button("Presenter notes").click();
    await page
      .locator(".briefing-presentation .briefing-notes")
      .getByText("Presenter-only reminder", { exact: true })
      .waitFor();
    await shot("presentation");
    await page.keyboard.press("Escape");
    assert.equal(await button("End presentation").count(), 0);
    await button("Generate briefing PDF").click();
    await page
      .getByText(/Briefing PDF retained from revision/)
      .waitFor({ timeout: 45000 });
    retained = (await call("briefings", { type: "list", operationId }))
      .records[0];
    const output = path.join(folder, "briefing.pdf");
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, output);
    await button("Save PDF").click();
    await page.getByText("Saved " + output, { exact: true }).waitFor();
    assert.ok(fs.statSync(output).size > 1000);
    const saved = await app.evaluate(
      ({ app }, a) => {
        const req = process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/package.json"),
          db = new (req("better-sqlite3"))(a.database, { readonly: true });
        try {
          return JSON.parse(
            db
              .prepare("SELECT document FROM briefing_exports WHERE id=?")
              .get(a.id).document,
          );
        } finally {
          db.close();
        }
      },
      { database: path.join(folder, "workspace", "ordo.db"), id: retained.id },
    );
    fs.writeFileSync(path.join(folder, "briefing.html"), saved.html);
    assert.ok(!saved.html.includes("Presenter-only reminder"));
    assert.ok(saved.html.includes("data:image/svg+xml;base64,"));
    await button("Preview saved source").click();
    await page.getByText("Slide 1 of 4", { exact: true }).waitFor();
    await button("End presentation").click();
    pass(
      "Keyboard presentation and presenter notes work; saved-source preview and a real four-slide PDF retain graphics and exclude notes",
    );
    await page.locator(".briefing-slides li button").nth(1).click();
    await label("Slide text").fill("Recovered briefing edit");
    await page.waitForFunction(
      async (id) =>
        (await window.ordo.recovery({ type: "list" })).drafts?.some(
          (d) => d.id === id,
        ),
      operationId,
    );
    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const c = BrowserWindow.getAllWindows()[0].webContents;
          c.once("render-process-gone", () => resolve());
          c.forcefullyCrashRenderer();
        }),
    );
    await close();
    await launch();
    await openOperation(page, operationId);
    await button("Recover working copy").click();
    await navigateOperation(page, "Briefings");
    await page.locator(".briefing-slides li button").nth(1).click();
    assert.equal(
      await label("Slide text").inputValue(),
      "Recovered briefing edit",
    );
    await save();
    assert.equal(
      (await call("briefings", { type: "list", operationId })).records[0]
        .status,
      "Outdated",
    );
    await label("Slide text").fill("Undo probe");
    await button("Undo").click();
    assert.equal(
      await label("Slide text").inputValue(),
      "Recovered briefing edit",
    );
    await button("Redo").click();
    assert.equal(await label("Slide text").inputValue(), "Undo probe");
    await button("Undo").click();
    pass(
      "Working-copy recovery survives renderer failure; normal restart preserves retained PDFs and undo/redo covers briefing edits",
    );
    await label("Slide text").fill(
      "Long content must not be silently cut off. ".repeat(120),
    );
    await save();
    await button("Generate briefing PDF").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Content does not fit on slide" })
      .waitFor({ timeout: 45000 });
    assert.equal(
      (await call("briefings", { type: "list", operationId })).records.length,
      1,
    );
    await label("Slide text").fill("Recovered briefing edit");
    await save();
    pass("Overfull slides fail export clearly and do not retain a clipped PDF");
    await global()
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    const themes = await label("Color theme")
      .locator("option")
      .evaluateAll((a) => a.map((o) => o.value));
    assert.equal(themes.length, 8);
    for (const theme of themes) {
      await label("Color theme").selectOption(theme);
      await openTab();
      await navigateOperation(page, "Briefings");
      await page.locator(".briefing-slides li button").first().click();
      await shot("briefing-" + theme);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await global()
        .getByRole("button", { name: "Settings", exact: true })
        .click();
    }
    await label("Color theme").selectOption(themes[0]);
    await openTab();
    await page.setViewportSize({ width: 1050, height: 850 });
    await navigateOperation(page, "Briefings");
    await shot("briefing-narrow");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1600, height: 1100 });
    pass(
      "All eight themes and a narrow desktop show the briefing editor without page-level horizontal overflow",
    );
    const backup = path.join(folder, "briefing-backup.db");
    await global()
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, backup);
    await button("Back up workspace").click();
    await page.getByText("Backup saved:", { exact: false }).waitFor();
    await openTab();
    await navigateOperation(page, "Briefings");
    await label("Briefing name").fill("Name after backup");
    await save();
    await global()
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, backup);
    await button("Restore backup").click();
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    state = await call("execute", { type: "load", operationId });
    assert.equal(
      state.operation.briefings.decks[0].name,
      "Operation Lantern briefing",
    );
    assert.equal(
      (await call("briefings", { type: "list", operationId })).records[0]
        .contentHash,
      retained.contentHash,
    );
    pass(
      "Backup and restore preserve slide layout, independent cards, graphics, and exact PDF bytes",
    );
    await close();
    await launch();
    await openOperation(page, operationId);
    await navigateOperation(page, "Briefings");
    await button("Remove briefing").click();
    await save();
    assert.equal(await button("Save PDF").count(), 1);
    await button("Save PDF").click({ trial: true });
    pass(
      "Retained PDFs remain accessible after removing their editable briefing and after normal restart",
    );
    assert.deepEqual(evidence.errors, []);
  } catch (e) {
    evidence.failure = String(e.stack ?? e);
    record();
    console.error(e);
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png"), fullPage: true })
        .catch(() => {});
    process.exitCode = 1;
  } finally {
    if (
      app &&
      page &&
      (await button("End presentation")
        .count()
        .catch(() => 0))
    )
      await button("End presentation")
        .click()
        .catch(() => {});
    if (app && evidence.failure)
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1;
        })
        .catch(() => {});
    if (app) await close();
    record();
    console.log(folder);
  }
})();
