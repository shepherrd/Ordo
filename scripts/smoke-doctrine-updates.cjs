// Isolated fictional workspace, normal Electron bridge and user-facing navigation.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "doctrine-updates-" + randomUUID());
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
    const initial = await call("execute", { type: "load" });
    const source = initial.doctrines.find((d) => d.config.doctrine.catalog);
    const created = await call("execute", {
      type: "doctrine-create",
      sourceId: source.doctrineVersionId,
      name: "Fictional live doctrine",
      versionLabel: "1.0.0",
      newFamily: true,
    });
    const doctrineId = created.selectedDoctrineId;
    const organization = await call("workspace", {
      type: "unit-profile-new",
      name: "Fictional headquarters",
    });
    const state = await call("execute", {
      type: "create",
      name: "Fictional linked draft",
      demo: false,
      configuration: { id: doctrineId, version: 1 },
      unitProfileVersionId: organization.profile.unitProfileVersionId,
    });
    const operationId = state.operation.id;
    await nav("Operations");
    await page.locator(`[data-operation-id="${operationId}"]`).click();
    await page
      .locator(".operation-identity")
      .filter({ visible: true })
      .getByText("Fictional live doctrine", { exact: true })
      .waitFor();
    await page
      .getByRole("navigation", { name: "Operation navigation" })
      .getByRole("button", { name: /^Base order/ })
      .click();
    const staff = page.locator(".staff-assignment").filter({ visible: true });
    await staff.waitFor();
    assert.equal(
      await staff.getByText("Doctrine default", { exact: true }).count(),
      1,
    );
    assert.equal(await staff.getByText(/Doctrine role: Unassigned/).count(), 0);
    pass("Unassigned responsible staff has one doctrine-default explanation");
    await nav("Doctrines");
    await page.getByLabel("Doctrine", { exact: true }).selectOption(doctrineId);
    await page
      .getByLabel("Doctrine name", { exact: true })
      .fill("Fictional revised doctrine");
    await button("Save doctrine").click();
    await page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
    await page
      .locator(".operation-identity")
      .filter({ visible: true })
      .getByText("Fictional revised doctrine", { exact: true })
      .waitFor();
    await page.getByText("Doctrine updated", { exact: true }).waitFor();
    pass(
      "An already-open operation adopts a saved doctrine edit when returning from the doctrine editor",
    );
    await nav("Doctrines");
    const latest = (await call("execute", { type: "load" })).doctrines.find(
      (d) => d.doctrineVersionId === doctrineId,
    );
    latest.config.doctrine.catalog.baseFields = [];
    await call("execute", {
      type: "doctrine-save",
      doctrine: latest,
      expectedContentVersion: latest.contentVersion,
    });
    await page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
    await page
      .getByText("Doctrine update needs review", { exact: true })
      .waitFor();
    await page.getByText(/Base-order field.*was removed/).waitFor();
    await page.screenshot({ path: path.join(folder, "doctrine-conflict.png") });
    pass(
      "Conflicting doctrine edits leave the draft intact and show a review notice",
    );
    await nav("Settings");
    await page
      .getByLabel("Color theme", { exact: true })
      .selectOption("charcoal");
    await page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
    await page
      .getByText("Doctrine update needs review", { exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1000, height: 850 });
    const review = button("Review doctrine");
    await review.waitFor();
    const notice = page
      .locator(".doctrine-update-notice")
      .filter({ visible: true });
    assert.ok(
      await notice.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    );
    await page.screenshot({
      path: path.join(folder, "doctrine-conflict-charcoal-1000.png"),
    });
    pass(
      "The conflict notice and review action fit a narrow Charcoal workspace",
    );
    await review.click();
    await page.getByLabel("Doctrine", { exact: true }).waitFor();
    pass("Review doctrine opens the doctrine editor");
    assert.equal(errors.length, 0);
    record();
  } catch (e) {
    errors.push(String(e));
    record();
    throw e;
  } finally {
    if (app) await app.close();
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
