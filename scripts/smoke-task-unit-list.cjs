// Exercise the user-selected task list in an isolated desktop workspace.
const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { navigateOperation, openOperation } = require("./smoke-global.cjs");

(async () => {
  const folder = path.resolve(".test-data", "task-unit-list-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    args: [path.resolve("out/main/index.js")],
    env,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const execute = (command) =>
      page.evaluate((c) => window.ordo.execute(c), command);
    const tasks = async (id) => {
      await openOperation(page, id);
      await navigateOperation(page, "Tasks & objectives");
      await page
        .getByRole("heading", { name: "Tasks & objectives by unit" })
        .waitFor();
    };
    const editor = page.locator("[data-operation-editor]:not([hidden])");
    const button = (name) => editor.getByRole("button", { name, exact: true });
    const cards = editor.locator("[data-task-unit-id]");
    const find = editor.getByRole("searchbox", {
      name: "Find a unit, task or objective",
    });
    const group = (id) => editor.locator(`[data-task-unit-id="${id}"]`);
    const save = async () => {
      await button("Save revision").click();
      await page
        .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
        .waitFor();
    };
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    const { operation } = await execute({
      type: "create",
      demo: false,
      name: "Fictional task roster",
    });
    const [hq, division, signal] = Array.from({ length: 3 }, () =>
      randomUUID(),
    );
    operation.units = [
      [hq, "Test Division", null],
      [division, "Test Division", hq],
      [signal, "Signal Company", division],
    ].map(([id, name, parentUnitId]) => ({
      id,
      name,
      parentUnitId,
      inTaskOrganization: true,
      metadata: operation.metadata,
    }));
    await execute({
      type: "save",
      operation,
      expectedRevision: operation.revision,
    });
    await tasks(operation.id);
    assert.equal(await cards.count(), 0);
    assert.equal(await editor.locator(".inspector").count(), 0);
    const picker = page.getByRole("dialog", { name: "Add units from ORBAT" });
    await button("Add units from ORBAT").click();
    await picker
      .getByRole("checkbox", { name: /Test Division Top-level unit/ })
      .check();
    await page.keyboard.press("Escape");
    assert.equal(await cards.count(), 0);
    await button("Add units from ORBAT").click();
    await picker
      .getByRole("checkbox", { name: /^Test Division Under Test Division$/ })
      .check();
    await picker.getByLabel("Search ORBAT units").fill("signal");
    await picker.getByRole("checkbox", { name: /Signal Company/ }).check();
    await picker.getByRole("button", { name: "Add 2 units" }).click();
    assert.equal(await cards.count(), 2);
    assert.equal(await group(hq).count(), 0);
    await save();
    await page.reload();
    await tasks(operation.id);
    await group(division).waitFor();
    await group(signal).waitFor();
    assert.equal(await cards.count(), 2);
    assert.equal(await editor.locator(".unit-task-group[open]").count(), 0);
    await find.fill("SIGNAL");
    assert.equal(await cards.count(), 1);
    assert.notEqual(await group(signal).getAttribute("open"), null);
    await find.fill("");
    assert.equal(await editor.locator(".unit-task-group[open]").count(), 0);
    await button("Add units from ORBAT").click();
    assert.equal(await picker.getByRole("checkbox").count(), 1);
    await picker.getByRole("button", { name: "Cancel" }).click();
    await group(signal).locator("summary").click();
    await group(signal)
      .getByRole("button", { name: "Remove from task list" })
      .click();
    await group(division).locator("summary").click();
    await group(division)
      .getByRole("button", { name: /^Add task for / })
      .click();
    await group(division)
      .getByLabel("Task", { exact: true })
      .fill("Secure crossing");
    await group(division)
      .getByLabel("Assigned unit", { exact: true })
      .selectOption(hq);
    await group(hq).getByLabel("Task", { exact: true }).waitFor();
    assert.equal(
      await group(hq)
        .getByRole("button", { name: "Remove from task list" })
        .count(),
      0,
    );
    await button("+ Add objective").click();
    await editor
      .getByLabel("Objective name", { exact: true })
      .fill("Hold east bank");
    await find.fill("crossing");
    assert.equal(await cards.count(), 1);
    await group(hq)
      .getByRole("button", { name: "Secure crossing", exact: true })
      .click();
    await editor
      .getByLabel("Objective", { exact: true })
      .selectOption({ label: "Hold east bank" });
    await find.fill("east bank");
    assert.equal(await group(hq).locator(".task-record-summary").count(), 2);
    await group(hq)
      .getByRole("button", { name: "Hold east bank", exact: true })
      .click();
    assert.equal(await editor.locator(".task-record-editor").count(), 1);
    assert.equal(
      await editor.getByLabel("Objective name", { exact: true }).inputValue(),
      "Hold east bank",
    );
    await find.fill("absent from task list");
    assert.equal(await cards.count(), 0);
    await button("Clear search").click();
    await save();
    const { operation: saved } = await execute({
      type: "load",
      operationId: operation.id,
    });
    assert.deepEqual(
      saved.units.map((u) => u.parentUnitId),
      [null, hq, division],
    );
    assert.deepEqual(
      saved.units.filter((u) => u.onTaskList).map((u) => u.id),
      [division],
    );
    assert.equal(saved.tasks.length, 1);
    assert.equal(saved.tasks[0].unitId, hq);
    assert.equal(saved.tasks[0].objectiveId, saved.objectives[0].id);
    await page.reload();
    await tasks(operation.id);
    assert.equal(await cards.count(), 2);
    assert.equal(await group(signal).count(), 0);
    assert.equal(await editor.locator(".task-record-editor").count(), 0);
    await find.fill("crossing");
    await group(hq)
      .getByRole("button", { name: /Secure crossing/ })
      .click();
    assert.equal(
      await group(hq).getByLabel("Task", { exact: true }).inputValue(),
      "Secure crossing",
    );
    await navigateOperation(page, "Overview");
    const inspector = editor.getByRole("region", {
      name: "Inspector",
      exact: true,
    });
    assert.equal(
      await inspector.evaluate(
        (el) => el === el.parentElement.lastElementChild,
      ),
      true,
    );
    const inspect = inspector.getByLabel("Inspect record", { exact: true });
    assert.equal(await inspect.inputValue(), operation.id);
    await inspect.selectOption(saved.tasks[0].id);
    await inspector.getByText("Source & references", { exact: true }).click();
    await inspector
      .getByLabel("References (one per line)", { exact: true })
      .fill("Crossing brief");
    await save();
    const after = (await execute({ type: "load", operationId: operation.id }))
      .operation;
    assert.deepEqual(after.tasks[0].metadata.references, ["Crossing brief"]);
    assert.deepEqual(after.metadata.references, saved.metadata.references);
    await navigateOperation(page, "Timeline");
    assert.equal(await editor.locator(".inspector").count(), 0);
    await page.keyboard.press("Control+k");
    const search = page.locator('[aria-label="Search Ordo"]');
    await search.getByLabel("Find in Ordo").fill("Secure crossing");
    await search
      .locator(".search-result")
      .filter({ hasText: "Secure crossing" })
      .first()
      .click();
    await search
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Task",
    );
    assert.equal(
      await group(hq).getByLabel("Task", { exact: true }).inputValue(),
      "Secure crossing",
    );
    // The same objective can be reached from multiple units, but only one editor opens.
    await find.fill("Test Division");
    await group(division)
      .getByRole("button", { name: /^Add task for / })
      .click();
    await group(division)
      .getByLabel("Task", { exact: true })
      .fill("Guard approach");
    await group(division)
      .getByLabel("Objective", { exact: true })
      .selectOption(saved.objectives[0].id);
    await find.fill("Hold east bank");
    await group(division)
      .getByRole("button", { name: "Hold east bank", exact: true })
      .click();
    assert.equal(await editor.locator(".task-record-editor").count(), 1);
    await group(division)
      .getByLabel("Objective name", { exact: true })
      .fill("Hold both banks");
    await find.fill("Hold both banks");
    assert.equal(await cards.count(), 2);
    await group(hq)
      .getByRole("button", { name: "Hold both banks", exact: true })
      .click();
    assert.equal(await editor.locator(".task-record-editor").count(), 1);
    await save();
    assert.equal(
      (await execute({ type: "load", operationId: operation.id })).operation
        .objectives.length,
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS ORBAT selection, collapsed unit list, task and objective search, single-record editing, reassignment, saved links and Overview inspector metadata.",
    );
  } catch (error) {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    throw error;
  } finally {
    await app.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
