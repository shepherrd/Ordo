const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "focus-notices-" + randomUUID());
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
  try {
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    const initial = await call("execute", { type: "load" });
    const config = initial.configurations[0].organization;
    const operation = (
      await call("execute", {
        type: "create",
        name: "Fictional search audit",
        demo: false,
        configuration: { id: config.id, version: config.version },
      })
    ).operation;
    const imagePath = path.join(folder, "fictional-audit-image.png");
    fs.writeFileSync(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    }, imagePath);
    const asset = (
      await call("files", {
        type: "asset-import",
        owner: { kind: "operation", id: operation.id },
      })
    ).asset;
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog", { name: "Search Ordo" });
    await search
      .getByRole("textbox", { name: "Find in Ordo" })
      .fill("fictional-audit-image");
    await search.locator(".search-result").first().click();
    await search
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await page.waitForFunction(
      (id) => document.activeElement?.getAttribute("data-asset-id") === id,
      asset.assetId,
    );
    await field("Search files").fill("audit");
    // Allow the debounced file query and resulting row refresh to finish.
    await page.waitForTimeout(800);
    assert.equal(
      await field("Search files").evaluate(
        (el) => el === document.activeElement,
      ),
      true,
    );
    await page.locator(`[data-asset-id="${asset.assetId}"]`).waitFor();
    await nav("Operations");
    await nav("Library");
    await field("Search files").focus();
    await page.waitForTimeout(400);
    assert.equal(
      await field("Search files").evaluate(
        (el) => el === document.activeElement,
      ),
      true,
    );
    pass(
      "A file search opens and focuses its result once; filtering or revisiting Library does not steal focus",
    );

    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional audit symbol",
      })
    ).symbol;
    await nav("Symbols & ORBATs");
    await page.locator(`[data-symbol-id="${symbol.versionId}"]`).click();
    await button("New symbol").click();
    const dialog = page.getByRole("dialog", {
      name: "New symbol",
      exact: true,
    });
    await field("New symbol name").fill("");
    await button("Create symbol").click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(
      await page.getByRole("alert").filter({ visible: true }).count(),
      1,
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    pass(
      "A symbol creation error appears in its dialog once without a second background alert",
    );
    await page.getByText("Advanced: symbol code", { exact: true }).click();
    await field("Code form").selectOption("LETTER");
    await button("Start new code").click();
    await field("Legacy function").fill("UCR---");
    const notice = page
      .getByText(
        "Apply or discard the highlighted symbol field edits before saving, replacing, exporting, or leaving this editor.",
        { exact: true },
      )
      .filter({ visible: true });
    assert.equal(await notice.count(), 1);
    assert.equal(await button("Save symbol").isDisabled(), true);
    await button("Discard Legacy function edit").click();
    assert.equal(await notice.count(), 0);
    await button("Discard symbol edits").click();
    pass(
      "Unapplied symbol fields show one notice and still prevent saving until resolved",
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
