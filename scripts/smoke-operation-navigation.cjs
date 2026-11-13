// Operation navigation acceptance through normal offline Electron startup/shutdown.
const { _electron: electron } = require("playwright");
const { openOperation } = require("./smoke-global.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

(async () => {
  const folder = path.resolve(
    ".test-data",
    `operation-navigation-${randomUUID()}`,
  );
  fs.mkdirSync(folder, { recursive: true });
  const packaged = process.argv.includes("--packaged");
  const env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const checks = [],
    errors = [];
  let app, page;
  const record = (check) => {
    checks.push(check);
    console.log(`PASS ${check}`);
  };
  const launch = async () => {
    app = await electron.launch({
      env,
      timeout: 60000,
      ...(packaged
        ? {
            executablePath:
              process.env.ORDO_PACKAGED_PATH ||
              path.resolve(
                "release",
                require("../package.json").version,
                "win-unpacked/Ordo.exe",
              ),
            args: [],
          }
        : { args: [path.resolve("out/main/index.js")] }),
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.context().setOffline(true);
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
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
  const global = () =>
    page.getByRole("navigation", { name: "Global navigation" });
  const operation = () =>
    page.getByRole("navigation", { name: "Operation navigation" });
  const cmd = (command) =>
    page.evaluate((command) => window.ordo.execute(command), command);
  const save = async () => {
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Planning revision saved." })
      .waitFor();
    await page.waitForFunction(() =>
      document.querySelector(".save-state")?.textContent?.includes("✓ Saved"),
    );
  };
  const capture = async (name) => {
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
    await launch();
    const config = (await cmd({ type: "load" })).configurations.find(
      (c) => c.doctrine.catalog?.profileKey === "us-army-orders",
    );
    assert(config);
    const first = (
      await cmd({
        type: "create",
        name: "FICTIONAL OPERATION PINE",
        demo: true,
        configuration: {
          id: config.organization.id,
          version: config.organization.version,
        },
      })
    ).operation;
    const second = (
      await cmd({
        type: "create",
        name: "FICTIONAL OPERATION CEDAR",
        demo: true,
      })
    ).operation;
    await openOperation(page, first.id);
    for (const width of [1500, 1120]) {
      await app.evaluate(
        ({ BrowserWindow }, width) =>
          BrowserWindow.getAllWindows()[0].setContentSize(
            width,
            width === 1120 ? 720 : 980,
          ),
        width,
      );
      await page.waitForFunction((width) => window.innerWidth === width, width);
      const layout = await page.evaluate(() => {
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return {
            x: r.x,
            right: r.right,
            width: r.width,
            height: r.height,
            bottom: r.bottom,
          };
        };
        const nav = document.querySelector(
          '[aria-label="Operation navigation"]',
        );
        const workspace = document.querySelector(".operation-shell .workspace");
        return {
          global: rect(".operation-global-sidebar"),
          operation: rect(".operation-sidebar"),
          main: rect(".operation-shell .main-shell"),
          nav: rect('[aria-label="Operation navigation"]'),
          configuration: rect(".operation-sidebar .sidebar-bottom"),
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          overflow: workspace.scrollWidth - workspace.clientWidth,
          navScrollable: nav.scrollHeight > nav.clientHeight,
        };
      });
      await capture(`workspace-${width}`);
      assert.equal(layout.global.right, layout.operation.x);
      assert.equal(layout.operation.right, layout.main.x);
      assert.equal(layout.main.right, layout.viewportWidth);
      assert(layout.nav.height > 400, JSON.stringify(layout));
      assert(
        layout.configuration.bottom <= layout.viewportHeight + 1,
        JSON.stringify(layout),
      );
      assert(layout.overflow <= 1, JSON.stringify(layout));
      assert(
        layout.navScrollable,
        "Doctrine navigation must scroll independently",
      );
      record(
        `${width}px: separate rails, usable editor, full-height scroll and visible Configuration`,
      );
    }
    for (const [name, heading] of [
      ["Task organization", /Task organization$/i],
      ["Tasks & objectives", "Tasks & objectives"],
      ["Phases", "Operational phases"],
      ["Timeline", "Timeline"],
      ["Base order", "Base order"],
      ["Signal data", "Signal workspace"],
      ["Package composer", "Package composer"],
      ["Export studio", "Export studio"],
      ["Publications", "Publication history"],
      ["History / Changes", "History / Changes"],
      ["Validation", "Validation"],
      ["Overview", "Operation overview"],
    ]) {
      await operation()
        .getByRole("button", {
          name:
            name === "Task organization"
              ? /^(?:A )?Task organization$/i
              : new RegExp(`^${name}`),
        })
        .click();
      await page
        .getByRole("heading", { level: 1, name: heading, exact: true })
        .waitFor();
    }
    record(
      "All operation destinations remain reachable through independent sidebar scrolling",
    );
    await page
      .getByLabel("Operation name", { exact: true })
      .fill("FICTIONAL PINE RETAINED DRAFT");
    await global()
      .getByRole("button", { name: "Dashboard", exact: true })
      .click();
    assert.equal(await operation().count(), 0);
    await global()
      .locator(`[data-open-operation-id="${first.id}"] .open-operation-name`)
      .click();
    assert.equal(
      await page
        .getByLabel("Operation name", { exact: true })
        .filter({ visible: true })
        .inputValue(),
      "FICTIONAL PINE RETAINED DRAFT",
    );
    await save();
    record(
      "Global navigation and named open-operation tabs preserve and save the current draft",
    );
    await page
      .getByLabel("Active operation", { exact: true })
      .filter({ visible: true })
      .selectOption(second.id);
    await page
      .getByRole("heading", {
        level: 1,
        name: "Operation overview",
        exact: true,
      })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(
          "[data-operation-editor]:not([hidden]) .operation-identity strong",
        )?.textContent === "FICTIONAL OPERATION CEDAR",
    );
    await page
      .getByLabel("Active operation", { exact: true })
      .filter({ visible: true })
      .selectOption(first.id);
    await page.waitForFunction(
      () =>
        document.querySelector(
          "[data-operation-editor]:not([hidden]) .operation-identity strong",
        )?.textContent === "FICTIONAL PINE RETAINED DRAFT",
    );
    await page
      .locator(".operation-sidebar")
      .getByRole("button", { name: "Configuration", exact: true })
      .click();
    await page
      .getByRole("heading", { level: 1, name: "Configuration", exact: true })
      .waitFor();
    record(
      "Active operation switching and the fixed Configuration shortcut work",
    );
    await close();
    await launch();
    await openOperation(page, first.id);
    assert.equal(
      await page
        .getByLabel("Operation name", { exact: true })
        .filter({ visible: true })
        .inputValue(),
      "FICTIONAL PINE RETAINED DRAFT",
    );
    await close();
    record("Saved changes survive normal exit-code-zero shutdown and reopen");
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify({ packaged, checks, errors }, null, 2),
    );
    console.log(`Evidence: ${folder}`);
  } catch (error) {
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        { packaged, checks, errors, failure: String(error) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (app) await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
