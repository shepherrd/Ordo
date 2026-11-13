// Isolated fictional records: staff propagation, duplicate notices, and focus/scroll.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");
(async () => {
  const folder = path.resolve(".test-data", "workspace-audit-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const env = {
    ...process.env,
    ORDO_DATA_DIR: path.join(folder, "workspace"),
    ORDO_HEADLESS: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const checks = [],
    errors = [];
  let app, page;
  const record = () =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
  const pass = (name) => {
    checks.push(name);
    record();
    console.log("PASS " + name);
  };
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  try {
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1500, height: 1000 });
    const initial = await call("execute", { type: "load" });
    const doctrine = initial.doctrines.find((d) => d.config.doctrine.catalog);
    const organization = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "Fictional staff headquarters",
      })
    ).profile;
    const state = await call("execute", {
      type: "create",
      name: "Fictional staff audit",
      demo: false,
      configuration: { id: doctrine.doctrineVersionId, version: 1 },
      unitProfileVersionId: organization.unitProfileVersionId,
    });
    const operationId = state.operation.id;
    const operationTab = () =>
      page
        .locator(
          `[data-open-operation-id="${operationId}"] .open-operation-name`,
        )
        .filter({ visible: true });
    const staff = () =>
      page.locator(".staff-assignment").filter({ visible: true });
    const openOrganization = async () => {
      await nav("Organizations");
      await page
        .locator(
          `[data-unit-profile-version="${organization.unitProfileVersionId}"]`,
        )
        .click();
      await button("Staff & roles").click();
      await field("Staff unit").waitFor();
    };
    await nav("Operations");
    await page.locator(`[data-operation-id="${operationId}"]`).click();
    await page
      .getByRole("navigation", { name: "Operation navigation" })
      .getByRole("button", { name: /^Base order/ })
      .click();
    await staff().waitFor();
    assert.equal(
      await staff()
        .getByText("Doctrine role: Unassigned", { exact: true })
        .count(),
      0,
    );
    const baseField =
      state.config.doctrine.catalog.baseFields.find(
        (f) => f.type === "narrative",
      ) ?? state.config.doctrine.catalog.baseFields[0];
    if (baseField) {
      assert.equal(
        await page
          .getByText(baseField.title, { exact: true })
          .filter({ visible: true })
          .count(),
        1,
      );
      await field(baseField.title).waitFor();
    }
    pass(
      "Base-order fields keep their accessible names without repeating visible headings",
    );

    await openOrganization();
    await button("Add staff section").click();
    await field("Section name 1").fill("Command Staff");
    await button("Add position to Command Staff").click();
    await field("Position title").fill("Commanding General");
    await field("Functional role").selectOption("COMMAND");
    await button("Add position to Command Staff").click();
    await field("Position title").last().fill("Deputy Commanding General");
    await field("Functional role").last().selectOption("EXECUTIVE");
    await button("Save organization").click();
    await clean();
    await operationTab().click();
    await page
      .getByText("Organization staff updated", { exact: true })
      .waitFor();
    await staff()
      .getByRole("button", { name: "Change assignment", exact: true })
      .click();
    const options = field("Organization position override");
    const command = options.locator('optgroup[label="Command Staff"]');
    assert.equal(await command.locator("option").count(), 2);
    assert.deepEqual(await command.locator("option").allTextContents(), [
      "Commanding General · Command",
      "Deputy Commanding General · Executive",
    ]);
    await options.selectOption({ label: "Commanding General · Command" });
    await button("Save revision").click();
    await clean();
    const selected = (await call("execute", { type: "load", operationId }))
      .operation;
    assert.equal(
      selected.operationOrganizationBinding.staff.positions.find(
        (p) => p.positionId === selected.staffPositionOverrides[0].positionId,
      ).title,
      "Commanding General",
    );
    pass(
      "An already-open draft receives Command Staff and both new roles; the grouped selector saves the selected role",
    );

    // Keep a local edit while saving another organization change through its normal editor.
    const editField = field(baseField.title);
    await editField.fill("Keep this unsaved order text.");
    await openOrganization();
    await field("Position title").first().fill("Commanding General revised");
    await button("Save organization").click();
    await operationTab().click();
    assert.match(
      await editField.innerText().catch(() => editField.inputValue()),
      /Keep this unsaved order text/,
    );
    await button("Save revision").click();
    await clean();
    await staff()
      .getByText("Commanding General revised", { exact: true })
      .waitFor();
    assert.equal(
      await staff().getByText("Responsible Staff", { exact: true }).count(),
      0,
    );
    assert.equal(
      await staff()
        .getByText("Doctrine role: Unassigned", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await staff().getByText("Default: Unassigned", { exact: true }).count(),
      1,
    );
    assert.match(
      JSON.stringify(
        (await call("execute", { type: "load", operationId })).operation,
      ),
      /Keep this unsaved order text/,
    );
    pass(
      "Saving an operation retains its unsaved text and follows a renamed assigned role",
    );

    await openOrganization();
    // The same warning is displayed once, even when multiple positions trigger it.
    await field("Functional role").last().selectOption("COMMAND");
    await field("Default position for this functional role").first().check();
    await field("Default position for this functional role").last().check();
    await page
      .getByText("Staff: Multiple defaults for COMMAND", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByText("Staff: Multiple defaults for COMMAND", { exact: true })
        .filter({ visible: true })
        .count(),
      1,
    );
    assert.equal(await button("Save organization").isDisabled(), true);
    await field("Default position for this functional role").last().uncheck();
    await button("Save organization").click();
    await clean();
    pass(
      "Organization validation appears once and prevents saving conflicting defaults",
    );

    let tree = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional audit formation",
      })
    ).orbat;
    tree.nodes = [
      fixtureOrbatUnit(tree.rootNodeId, "Fictional formation headquarters"),
    ];
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    // Refresh organization choices after creating the saved map.
    await nav("Operations");
    await openOrganization();
    await button("ORBAT").click();
    await field("Assigned ORBAT").selectOption(tree.versionId);
    await button("Save organization").click();
    await clean();
    await page
      .locator('.organization-orbat-map .graphic-canvas[aria-busy="false"] svg')
      .waitFor();
    const expand = button("Expand diagram");
    await expand.scrollIntoViewIfNeeded();
    const scroll = () =>
      page.locator(".global-workspace").evaluate((el) => el.scrollTop);
    const before = await scroll();
    await expand.click();
    const modal = page.getByRole("dialog", { name: "Graphic preview" });
    await modal.waitFor();
    assert.ok(
      Math.abs((await scroll()) - before) < 2,
      "Expanding the diagram changed underlying scroll",
    );
    const zoom = modal.getByRole("button", { name: "Zoom in", exact: true });
    await zoom.focus();
    await page.evaluate(() =>
      document
        .querySelector(".global-nav button")
        .focus({ preventScroll: true }),
    );
    assert.equal(
      await zoom.evaluate((el) => el === document.activeElement),
      true,
    );
    await modal
      .getByRole("button", { name: "Compact diagram", exact: true })
      .click();
    await expand.waitFor();
    assert.ok(
      Math.abs((await scroll()) - before) < 2,
      "Closing the diagram changed underlying scroll",
    );
    assert.equal(
      await expand.evaluate((el) => el === document.activeElement),
      true,
    );
    pass(
      "Expanding and closing an ORBAT preserves page scroll; modal focus returns to the last control and then the trigger",
    );

    // Final visual checks for the changed staff selector and notice.
    await operationTab().click();
    await staff()
      .getByRole("button", { name: "Change assignment", exact: true })
      .click();
    await staff().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(folder, "staff-forest.png") });
    await nav("Settings");
    await field("Color theme").selectOption("charcoal");
    await operationTab().click();
    await page.setViewportSize({ width: 1000, height: 850 });
    await staff().scrollIntoViewIfNeeded();
    assert.ok(
      await staff().evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.screenshot({
      path: path.join(folder, "staff-charcoal-1000.png"),
    });
    pass(
      "Staff assignment controls fit wide Forest and narrow Charcoal workspaces",
    );
    assert.equal(errors.length, 0);
    record();
  } catch (e) {
    errors.push(String(e));
    record();
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
    throw e;
  } finally {
    if (app) {
      // This is a disposable isolated workspace. Failed assertions can leave a dirty editor.
      await app
        .evaluate(({ BrowserWindow }) => {
          for (const window of BrowserWindow.getAllWindows()) window.destroy();
        })
        .catch(() => {});
      await app.close();
    }
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
