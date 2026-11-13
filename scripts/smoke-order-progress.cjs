// Isolated fictional workspace; normal offline startup, clean exit and reopen.
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");

(async () => {
  const folder = path.resolve(".test-data", "order-progress-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const checks = [],
    errors = [],
    events = [];
  let app, page, failure;
  const record = () =>
    fs.writeFileSync(
      path.join(folder, "result.json"),
      JSON.stringify(
        {
          checks,
          errors,
          events,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const pass = (check) => {
    checks.push(check);
    record();
    console.log("PASS " + check);
  };
  const launch = async () => {
    events.push({ at: new Date().toISOString(), stage: "launch" });
    record();
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    events.push({
      at: new Date().toISOString(),
      stage: "ready",
      pid: app.process().pid,
    });
    record();
  };
  const close = async () => {
    const proc = app.process();
    events.push({
      at: new Date().toISOString(),
      stage: "close",
      pid: proc.pid,
    });
    record();
    await app.close();
    assert.equal(proc.exitCode, 0);
    app = null;
    events.push({
      at: new Date().toISOString(),
      stage: "exited",
      pid: proc.pid,
    });
    record();
  };
  const call = (command) =>
    page.evaluate((c) => window.ordo.execute(c), command);
  const count = async (value) => {
    await navigateOperation(page, "Overview");
    await page
      .getByRole("button", {
        name: new RegExp(`Five-paragraph order ${value} of 5 sections started`),
      })
      .waitFor();
  };
  try {
    await launch();
    const catalog = await call({ type: "load" });
    const doctrine = catalog.doctrines.find(
      (d) => d.config.doctrine.catalog?.nodes.length === 185,
    );
    assert(doctrine);
    let state = await call({
      type: "create",
      name: "FICTIONAL ORDER PROGRESS",
      demo: false,
      configuration: { id: doctrine.doctrineVersionId, version: 1 },
    });
    const operationId = state.operation.id;
    const fields = state.config.doctrine.paragraphs.map((p) =>
      state.config.doctrine.catalog.baseFields.find(
        (f) => f.paragraphId === p.id && f.contentKind === "narrative",
      ),
    );
    assert(fields.every(Boolean));
    await page.reload();
    await openOperation(page, operationId);
    await count(0);
    pass("Blank order starts at zero");
    for (let index = 0; index < fields.length; index++) {
      await navigateOperation(page, "Base order");
      const field = page
        .locator(`[data-entity-id="${fields[index].id}"]`)
        .getByRole("textbox", { name: fields[index].title, exact: true });
      await field.fill(
        `Fictional reference content for paragraph ${index + 1}.`,
      );
      if (index === 0) {
        await field.press("Control+A");
        await field.press("Control+B");
      }
      await count(index + 1);
    }
    pass(
      "All five structured paragraphs update the overview immediately, including formatted text",
    );
    await page
      .getByRole("button", {
        name: /Five-paragraph order 5 of 5 sections started/,
      })
      .screenshot({ path: path.join(folder, "five-sections.png") });
    await navigateOperation(page, "Base order");
    const last = page
      .locator(`[data-entity-id="${fields[4].id}"]`)
      .getByRole("textbox", { name: fields[4].title, exact: true });
    await last.fill("");
    await count(4);
    pass("Clearing the last paragraph lowers the count immediately");
    await navigateOperation(page, "Base order");
    await last.fill("Fictional command and signal instructions.");
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    state = await call({ type: "load", operationId });
    assert(state.operation.sections.every((s) => s.summary === ""));
    assert.equal(state.operation.authoring.fields.length, 5);
    await count(5);
    pass("Saved count is five while legacy summaries remain untouched");
    await close();
    await launch();
    await openOperation(page, operationId);
    await count(5);
    pass("Normal offline reopen retains the correct progress");
    assert.deepEqual(errors, []);
    await close();
    pass("No renderer errors and normal clean exit");
  } catch (error) {
    failure = error;
    record();
    throw error;
  } finally {
    if (app) await close();
    record();
    console.log(folder);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
