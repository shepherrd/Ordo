// Navigation adapter for retained M1-M4 workflows. All authoring assertions stay in their original scripts.
const currentState = (page) =>
  page.evaluate(async () => {
    const prefs = (await window.ordo.workspace({ type: "preferences" }))
      .preferences;
    const id =
      document.querySelector(
        '[data-operation-editor]:not([hidden]) [aria-label="Active operation"]',
      )?.value || prefs.lastOpenedOperationId;
    return window.ordo.execute({
      type: "load",
      ...(id ? { operationId: id } : {}),
    });
  });
const openOperation = async (page, id) => {
  await page.getByRole("heading", { name: "Dashboard", exact: true }).waitFor();
  const s = await page.evaluate(() => window.ordo.execute({ type: "load" }));
  const target = id
    ? s.operations.find((o) => o.id === id)
    : s.operations.find((o) => o.id === s.preferences.lastOpenedOperationId) ||
      s.operations[0];
  if (!target) return;
  await page
    .getByRole("navigation", { name: "Global navigation" })
    .getByRole("button", { name: "Operations", exact: true })
    .click();
  await page.getByLabel("Search operations", { exact: true }).fill(target.name);
  await page.locator(`[data-operation-id="${target.id}"]`).click();
  await page
    .getByLabel("Active operation", { exact: true })
    .filter({ visible: true })
    .waitFor();
  // Retained workflows begin on Overview; the product itself preserves each tab's page.
  await page
    .getByRole("navigation", { name: "Operation navigation" })
    .getByRole("button", { name: /^Overview$/ })
    .click();
};
const createDemo = async (page, name, army) => {
  await page
    .getByRole("button", { name: "Create Operation", exact: true })
    .click();
  await page.getByLabel("New operation name", { exact: true }).fill(name);
  await page.getByLabel("Include clearly labeled fictional demo data").check();
  const options = await page
    .getByLabel("Doctrine configuration", { exact: true })
    .locator("option")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({ value: n.value, text: n.textContent })),
    );
  await page
    .getByLabel("Doctrine configuration", { exact: true })
    .selectOption(
      options.find((o) =>
        o.text.includes(
          army ? "US Army Orders" : "Traditional five-paragraph starter",
        ),
      ).value,
    );
  await page
    .locator("form.create-operation")
    .getByRole("button", { name: "Create operation", exact: true })
    .click();
  await page
    .getByLabel("Active operation", { exact: true })
    .filter({ visible: true })
    .waitFor();
};
const navigateOperation = async (page, name) => {
  const global = () =>
    page.getByRole("navigation", { name: "Global navigation" });
  if (name === "Configuration") {
    await global()
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    return;
  }
  if (
    !(await page
      .getByLabel("Active operation", { exact: true })
      .filter({ visible: true })
      .count())
  ) {
    const last = await page.evaluate(
      async () =>
        (await window.ordo.workspace({ type: "preferences" })).preferences
          .lastOpenedOperationId,
    );
    const resume = global().locator(
      `[data-open-operation-id="${last}"] .open-operation-name`,
    );
    if (await resume.isVisible()) await resume.click();
    else {
      if (
        !(await page
          .getByRole("heading", { name: "Dashboard", exact: true })
          .isVisible())
      )
        await global()
          .getByRole("button", { name: "Dashboard", exact: true })
          .click();
      await openOperation(page);
    }
  }
  await page
    .locator("nav:visible")
    .getByRole("button", {
      name:
        name === "Task organization"
          ? /^(?:A )?Task organization$/i
          : new RegExp("^" + name),
    })
    .click();
};
module.exports = { currentState, openOperation, createDemo, navigateOperation };
