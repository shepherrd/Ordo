// Theme changes are exercised in a separate, fictional workspace.
const { _electron: electron } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");
(async () => {
  const folder = path.resolve(".test-data", "themes-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const evidence = {
    version: require("../package.json").version,
    checks: [],
    errors: [],
    screenshots: [],
    themes: [],
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
  let app, page;
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(evidence, null, 2),
    );
  const pass = (name) => {
    evidence.checks.push(name);
    write();
    console.log("PASS " + name);
  };
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
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const capture = async (name) => {
    await page.screenshot({ path: path.join(folder, name + ".png") });
    evidence.screenshots.push(name + ".png");
    write();
  };
  const setTheme = async (id) => {
    await nav("Settings");
    await page.getByLabel("Color theme", { exact: true }).selectOption(id);
    await page.waitForFunction(
      (id) => document.documentElement.dataset.theme === id,
      id,
    );
    await page.waitForTimeout(180);
  };
  const launch = async () => {
    app = await electron.launch({
      env,
      args: [path.resolve("out/main/index.js")],
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page.context().setOffline(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
  };
  const close = async () => {
    await clean();
    const proc = app.process();
    await app.close();
    app = null;
    assert.equal(proc.exitCode, 0);
  };
  try {
    await launch();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "forest",
    );
    await nav("Settings");
    const choice = page.getByLabel("Color theme", { exact: true });
    assert.equal(await choice.locator("option").count(), 8);
    const preferences = (await call("workspace", { type: "preferences" }))
      .preferences;
    const ids = [
      "forest",
      "ocean",
      "sand",
      "plum",
      "midnight",
      "charcoal",
      "pine",
      "ember",
    ];
    for (const id of ids) {
      await setTheme(id);
      await clean();
      const colors = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement),
          panel = getComputedStyle(document.querySelector(".panel")),
          input = getComputedStyle(
            document.querySelector('[aria-label="Color theme"]'),
          );
        return {
          background: root.backgroundColor,
          paper: panel.backgroundColor,
          text: root.color,
          input: input.backgroundColor,
          inputText: input.color,
          colorScheme: root.colorScheme,
          stored: localStorage.getItem("ordo.appearance.theme"),
          focus: root.getPropertyValue("--focus"),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.equal(colors.stored, id);
      assert.equal(colors.colorScheme, ids.indexOf(id) < 4 ? "light" : "dark");
      assert(!colors.overflow);
      evidence.themes.push({ id, ...colors });
      await capture("settings-" + id);
    }
    assert.equal(new Set(evidence.themes.map((t) => t.background)).size, 8);
    assert.deepEqual(
      (await call("workspace", { type: "preferences" })).preferences,
      preferences,
    );
    pass(
      "Eight distinct light/dark palettes apply immediately, save locally, and leave planner preferences and dirty state unchanged",
    );
    await setTheme("midnight");
    await choice.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await choice.inputValue(), "charcoal");
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "charcoal",
    );
    await page.setViewportSize({ width: 1050, height: 820 });
    await capture("settings-charcoal-narrow");
    assert(await choice.isVisible());
    assert(
      await choice.evaluate(
        (el) => el.getBoundingClientRect().right <= innerWidth,
      ),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    pass(
      "The theme selector works by keyboard and fits the narrower desktop layout",
    );
    await setTheme("forest");
    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional theme infantry",
      })
    ).symbol;
    let tree = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional theme formation",
      })
    ).orbat;
    tree.nodes = Array.from({ length: 3 }, (_, i) =>
      fixtureOrbatUnit(
        i ? randomUUID() : tree.rootNodeId,
        i ? "Fictional company " + i : "Fictional division",
      ),
    );
    tree.nodes.forEach((n, i) => {
      n.parentNodeId = i ? tree.rootNodeId : null;
      n.unit.symbol = { definition: symbol.definition, source: null };
    });
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    await nav("Symbols & ORBATs");
    await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
    await page
      .getByLabel("ORBAT map", { exact: true })
      .selectOption(tree.versionId);
    const svg = page.locator(
      '[aria-label="Interactive ORBAT diagram"] .graphic-canvas[aria-busy="false"] > div > svg',
    );
    await svg.waitFor();
    const artwork = await svg.evaluate((el) => el.outerHTML);
    await capture("orbat-forest");
    await setTheme("midnight");
    await nav("Symbols & ORBATs");
    await svg.waitFor();
    assert.equal(await svg.evaluate((el) => el.outerHTML), artwork);
    assert.equal(
      await page
        .locator('[aria-label="Interactive ORBAT diagram"] .graphic-canvas')
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)",
    );
    await capture("orbat-midnight");
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "ORBAT",
          id: tree.versionId,
        })
      ).orbat,
      tree,
    );
    pass(
      "Theme changes preserve exact military-symbol SVG artwork and saved ORBAT data, with a neutral drawing surface",
    );
    let org = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "Fictional Theme Division",
      })
    ).profile;
    org.orbatWorkspace = { orbatId: tree.versionId, profiles: [] };
    org = await call("organizations", {
      type: "save",
      profile: org,
      expectedContentVersion: org.contentVersion,
    });
    await nav("Organizations");
    await page
      .locator(`[data-unit-profile-version="${org.unitProfileVersionId}"]`)
      .click();
    await button("ORBAT").click();
    await page
      .locator('.organization-orbat-map .graphic-canvas[aria-busy="false"] svg')
      .first()
      .waitFor();
    await capture("organization-midnight");
    const tabs = page.getByRole("group", { name: "Organization pages" });
    const pressed = tabs.getByRole("button", { name: "ORBAT", exact: true });
    assert.equal(await pressed.getAttribute("aria-pressed"), "true");
    await button("New organization").click();
    await capture("organization-dialog-midnight");
    await button("Cancel").click();
    await clean();
    pass(
      "Organization profiles, selected tabs and dialogs use the selected palette",
    );
    const state = await call("execute", {
      type: "create",
      name: "FICTIONAL THEME DOCUMENT",
      demo: true,
    });
    await nav("Operations");
    await page.locator(`[data-operation-id="${state.operation.id}"]`).click();
    const opNav = (name) =>
      page
        .getByRole("navigation", { name: "Operation navigation" })
        .getByRole("button", { name, exact: true })
        .click();
    await opNav("Export studio");
    const frame = page.locator(
      "[data-operation-editor]:not([hidden]) iframe.document-frame",
    );
    await frame.waitFor();
    const documentHtml = await frame.getAttribute("srcdoc");
    assert(documentHtml.includes("FICTIONAL THEME DOCUMENT"));
    await capture("document-midnight");
    await setTheme("sand");
    await page
      .locator(
        `[data-open-operation-id="${state.operation.id}"] .open-operation-name`,
      )
      .filter({ visible: true })
      .click();
    await frame.waitFor();
    assert.equal(await frame.getAttribute("srcdoc"), documentHtml);
    pass(
      "Changing the application theme leaves the exported-document preview HTML unchanged",
    );
    await setTheme("pine");
    await close();
    await launch();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "pine");
    await nav("Settings");
    assert.equal(
      await page.getByLabel("Color theme", { exact: true }).inputValue(),
      "pine",
    );
    await setTheme("forest");
    await close();
    await launch();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "forest",
    );
    pass(
      "The selected theme loads on normal restart before opening Settings, and Forest can be restored",
    );
    assert.deepEqual(evidence.errors, []);
    await close();
    pass("Normal offline launch and shutdown complete without renderer errors");
  } catch (e) {
    evidence.failure = String(e);
    write();
    if (page) {
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
      fs.writeFileSync(
        path.join(folder, "failure-dom.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
    }
    throw e;
  } finally {
    if (app) await app.close();
    write();
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
