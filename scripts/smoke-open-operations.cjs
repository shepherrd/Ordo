// Focused normal-lifecycle verification for development and packaged builds.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

(async () => {
  const packaged = process.argv.includes("--packaged");
  const version = require("../package.json").version;
  const folder = path.resolve(".test-data", `open-operations-${randomUUID()}`);
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.env.ORDO_VISIBLE_TEST === "1") delete env.ORDO_HEADLESS;
  let app, page;
  const checks = [],
    errors = [];
  const record = (check) => {
    checks.push(check);
    console.log(`PASS ${check}`);
  };
  const write = (failure) =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          packaged,
          version,
          checks,
          errors,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const global = () =>
    page.getByRole("navigation", { name: "Global navigation" });
  const tab = (id) => page.locator(`[data-open-operation-id="${id}"]:visible`);
  const editor = () => page.locator("[data-operation-editor]:visible");
  const command = (value) =>
    page.evaluate((value) => window.ordo.execute(value), value);
  const saved = async (id) => await command({ type: "load", operationId: id });
  const go = async (name) =>
    global().getByRole("button", { name, exact: true }).click();
  const open = async (id) => {
    await go("Operations");
    await page.getByLabel("Search operations").fill("");
    await page
      .locator(`.browse-row[data-operation-id="${id}"]:visible`)
      .click();
    await editor().getByLabel("Active operation", { exact: true }).waitFor();
    assert.equal(
      await editor()
        .getByLabel("Active operation", { exact: true })
        .inputValue(),
      id,
    );
  };
  const activate = async (id) => {
    await tab(id).locator(".open-operation-name").click();
    assert.equal(
      await editor()
        .getByLabel("Active operation", { exact: true })
        .inputValue(),
      id,
    );
  };
  const closeTab = async (id) => tab(id).locator(".close-operation").click();
  const dialog = () => page.getByRole("dialog");
  const navigate = async (name) =>
    editor()
      .getByRole("navigation", { name: "Operation navigation" })
      .getByRole("button", {
        name:
          name === "Task organization"
            ? /^(?:A )?Task organization$/i
            : new RegExp(`^${name}`),
      })
      .click();
  const start = async () => {
    app = await electron.launch({
      env,
      timeout: 60000,
      ...(packaged
        ? {
            executablePath:
              process.env.ORDO_PACKAGED_PATH ||
              path.resolve("release", version, "win-unpacked/Ordo.exe"),
            args: [],
          }
        : { args: [path.resolve("out/main/index.js")] }),
    });
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
    if (packaged)
      assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
  };
  const close = async () => {
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    const process = app.process();
    await app.close();
    assert.equal(process.exitCode, 0);
    app = null;
  };
  const capture = async (name) => {
    // Wake the hidden test window's compositor before retaining the next frame.
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        {
          stayHidden: true,
          stayAwake: true,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const bytes = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      )
        .toPNG()
        .toString("base64"),
    );
    fs.writeFileSync(
      path.join(folder, `${name}.png`),
      Buffer.from(bytes, "base64"),
    );
  };
  try {
    await start();
    const a = (
      await command({
        type: "create",
        name: "FICTIONAL OPERATION PINE",
        demo: true,
      })
    ).operation;
    const b = (
      await command({
        type: "create",
        name: "FICTIONAL OPERATION CEDAR",
        demo: true,
      })
    ).operation;
    await open(a.id);
    await editor()
      .getByLabel("Operation name", { exact: true })
      .fill("FICTIONAL PINE DRAFT");
    await navigate("Task organization");
    const initialUnit = await editor()
      .getByLabel("Unit name 1", { exact: true })
      .inputValue();
    await editor()
      .getByLabel("Unit name 1", { exact: true })
      .fill("FICTIONAL UNSAVED UNIT");
    await open(b.id);
    await editor()
      .getByLabel("Operation name", { exact: true })
      .fill("FICTIONAL CEDAR DRAFT");
    assert.deepEqual((await saved(a.id)).operation, a);
    assert.deepEqual((await saved(b.id)).operation, b);
    await activate(a.id);
    await editor()
      .getByRole("heading", {
        level: 1,
        name: /Task organization$/i,
        exact: true,
      })
      .waitFor();
    assert.equal(
      await editor().getByLabel("Unit name 1", { exact: true }).inputValue(),
      "FICTIONAL UNSAVED UNIT",
    );
    await editor()
      .getByRole("button", { name: "Undo draft edit", exact: true })
      .click();
    assert.equal(
      await editor().getByLabel("Unit name 1", { exact: true }).inputValue(),
      initialUnit,
    );
    assert.equal(
      await page.locator("[data-open-operation-id]:visible").count(),
      2,
    );
    await go("Dashboard");
    await open(a.id);
    assert.equal(
      await page.locator("[data-open-operation-id]:visible").count(),
      2,
    );
    record(
      "Two independent drafts retain pages and undo history; switching and duplicate opens write no revisions",
    );

    for (const width of [1500, 1120]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setContentSize(
            width,
            width === 1120 ? 720 : 980,
          ),
        width,
      );
      await page.waitForFunction((width) => innerWidth === width, width);
      await tab(a.id).scrollIntoViewIfNeeded();
      const layout = await tab(a.id).evaluate((node) => {
        const r = node.getBoundingClientRect();
        const label = node
          .querySelector(".open-operation-label")
          .getBoundingClientRect();
        const close = node
          .querySelector(".close-operation")
          .getBoundingClientRect();
        const main = document
          .querySelector("[data-operation-editor]:not([hidden]) .main-shell")
          .getBoundingClientRect();
        return {
          labelWidth: label.width,
          closeRight: close.right,
          right: r.right,
          mainRight: main.right,
          viewport: innerWidth,
        };
      });
      assert(layout.labelWidth > 80, JSON.stringify(layout));
      assert(layout.closeRight <= layout.right + 1, JSON.stringify(layout));
      assert.equal(layout.mainRight, layout.viewport);
      await capture(`open-operations-${width}`);
    }
    record(
      "1500px and 1120px layouts expose named operations, unsaved markers, and close controls",
    );

    await closeTab(b.id); // Close an inactive dirty editor without touching the active editor.
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
    await activate(b.id);
    assert.equal(
      await editor().getByLabel("Operation name", { exact: true }).inputValue(),
      "FICTIONAL CEDAR DRAFT",
    );
    await activate(a.id);
    await closeTab(b.id);
    await dialog().waitFor({ state: "visible" });
    await capture("close-unsaved-operation");
    await dialog()
      .getByRole("button", { name: "Discard changes and close", exact: true })
      .click();
    await tab(b.id).waitFor({ state: "detached" });
    assert.deepEqual((await saved(b.id)).operation, b);
    assert.equal(
      await editor()
        .getByLabel("Active operation", { exact: true })
        .inputValue(),
      a.id,
    );
    record(
      "Cancel preserves inactive edits; discard closes only that editor and preserves its saved catalog record",
    );

    await closeTab(a.id);
    await dialog()
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Operations", level: 1, exact: true })
      .waitFor();
    const savedA = (await saved(a.id)).operation;
    assert.equal(savedA.name, "FICTIONAL PINE DRAFT");
    assert.equal(savedA.revision, a.revision + 1);
    assert.equal(
      await page.locator("[data-open-operation-id]:visible").count(),
      0,
    );
    await open(b.id);
    assert.equal(
      await editor().getByLabel("Operation name", { exact: true }).inputValue(),
      b.name,
    );
    await open(a.id);
    assert.equal(
      await editor().getByLabel("Operation name", { exact: true }).inputValue(),
      savedA.name,
    );
    record(
      "Save and close persists one revision; closing the last tab returns to the catalog; closed operations reopen",
    );

    // An actual optimistic-concurrency failure must keep the original draft open.
    await editor()
      .getByLabel("Operation name", { exact: true })
      .fill("FICTIONAL RETAIN ON SAVE FAILURE");
    await command({
      type: "save",
      operation: { ...savedA, name: "FICTIONAL EXTERNAL REVISION" },
      expectedRevision: savedA.revision,
    });
    await closeTab(a.id);
    await dialog()
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    await dialog()
      .getByRole("alert")
      .filter({ hasText: "Operation changed" })
      .waitFor();
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(
      await editor().getByLabel("Operation name", { exact: true }).inputValue(),
      "FICTIONAL RETAIN ON SAVE FAILURE",
    );
    await closeTab(a.id);
    await dialog()
      .getByRole("button", { name: "Discard changes and close", exact: true })
      .click();
    await tab(a.id).waitFor({ state: "detached" });
    record(
      "Failed save leaves the tab and unsaved content intact; no overwrite of a newer revision",
    );

    const profilesBefore = (await saved(b.id)).profiles;
    await navigate("Export studio");
    await editor()
      .getByLabel("Profile name", { exact: true })
      .fill("FICTIONAL TAB PROFILE");
    await open(a.id);
    await closeTab(b.id);
    await dialog()
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    await tab(b.id).waitFor({ state: "detached" });
    const profileAfter = (await saved(b.id)).profiles.find(
      (p) => p.name === "FICTIONAL TAB PROFILE",
    );
    assert(profileAfter);
    assert(
      profileAfter.version >
        profilesBefore.find((p) => p.id === profileAfter.id).version,
    );
    assert.equal((await saved(b.id)).operation.revision, b.revision);
    record(
      "Inactive export-profile drafts participate in the close guard and save their own version without unrelated operation revisions",
    );

    await close();
    await start();
    await tab(a.id)
      .getByRole("button", {
        name: "Open operation: FICTIONAL EXTERNAL REVISION",
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.locator("[data-open-operation-id]:visible").count(),
      1,
    );
    assert.equal(await tab(b.id).count(), 0);
    await activate(a.id);
    assert.equal(
      await editor().getByLabel("Operation name", { exact: true }).inputValue(),
      "FICTIONAL EXTERNAL REVISION",
    );
    await closeTab(a.id);
    await page
      .getByRole("heading", { name: "Operations", level: 1, exact: true })
      .waitFor();
    await close();
    await start();
    assert.equal(
      await page.locator("[data-open-operation-id]:visible").count(),
      0,
    );
    await open(b.id);
    assert.equal(
      await editor().getByLabel("Operation name", { exact: true }).inputValue(),
      b.name,
    );
    await close();
    record(
      "Normal offline exit/reopen restores only open IDs; explicit closes stay closed; saved operations remain reopenable",
    );
    assert.deepEqual(errors, []);
    write();
    console.log(`Evidence: ${folder}`);
  } catch (error) {
    write(error);
    if (app) await capture("failure").catch(() => {});
    throw error;
  } finally {
    if (app) {
      // On failure retain the process for inspection, never force a passing shutdown.
      console.log(`Unclosed diagnostic PID: ${app.process().pid}`);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
