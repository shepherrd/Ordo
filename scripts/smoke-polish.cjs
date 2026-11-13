// Isolated fictional workspace. Normal Electron launch/exit/reopen; no startup flags.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "polish-desktop-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const env = {
    ...process.env,
    ORDO_DATA_DIR: path.join(folder, "workspace"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  // Review actual window rendering, including sandboxed document previews.
  delete env.ORDO_HEADLESS;
  const events = [],
    checks = [],
    errors = [];
  let app, page, failure;
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const files = fs
    .readdirSync("out", { recursive: true })
    .filter((f) => fs.statSync(path.join("out", f)).isFile())
    .sort();
  const buildFiles = files.map((f) => ({
    path: f,
    sha256: hash(fs.readFileSync(path.join("out", f))),
  }));
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          version: require("../package.json").version,
          buildFiles,
          events,
          checks,
          errors,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const report = (name) => {
    checks.push(name);
    write();
    console.log("PASS " + name);
  };
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const launch = async () => {
    events.push({ at: new Date().toISOString(), stage: "launch" });
    write();
    app = await electron.launch({
      env,
      args: [path.resolve("out/main/index.js")],
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    events.push({
      at: new Date().toISOString(),
      stage: "shell-ready",
      pid: app.process().pid,
    });
    write();
  };
  const close = async () => {
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    events.push({ at: new Date().toISOString(), stage: "normal-close", pids });
    write();
    await app.close();
    assert.equal(proc.exitCode, 0);
    for (const pid of pids) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
        alive = false;
      }
      assert(!alive, "Lingering process " + pid);
    }
    app = null;
    events.push({ at: new Date().toISOString(), stage: "fully-exited" });
    write();
  };
  try {
    await launch();
    const newButton = button("Create operation");
    await newButton.click();
    const dialog = page.getByRole("dialog", { name: "Create an operation" });
    await dialog.waitFor();
    const first = dialog.getByLabel("New operation name", { exact: true });
    await first.focus();
    await page.keyboard.press("Shift+Tab");
    assert(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
      "Dialog focus escaped",
    );
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert(
      await newButton.evaluate((el) => el === document.activeElement),
      "Focus did not return to opening button",
    );
    report("dialog-keyboard-containment-and-focus-return");
    let state = await call("execute", {
      type: "create",
      name: "FICTIONAL DOCUMENT POLISH",
      demo: true,
    });
    const operationId = state.operation.id;
    await page.reload();
    await openOperation(page, operationId);
    await button("Configuration").click();
    const field = (label) =>
      page.getByLabel(label, { exact: true }).filter({ visible: true });
    await field("Unit / first line").fill("38th Mobile Infantry Division");
    await field("Organization / second line").fill(
      "Cascadian Defense Directorate",
    );
    await field("Location / third line").fill("Arcadia, GCR");
    await field("Date and time / fourth line").fill("24 MAY 2036, 1200 GMT");
    await field("Classification / right label").fill("Unclassified");
    await field("Left footer text").fill("FICTIONAL EXAMPLE");
    await field("Centre footer text").fill("Operation Testify");
    await field("Right footer text").fill("Planning copy");
    await field("Include page numbers on the right").check();
    const logoPath = path.join(folder, "fixture-logo.png");
    const logo = await app.evaluate(
      ({ nativeImage }, p) => nativeImage.createFromPath(p).toPNG(),
      path.resolve("build/icon.ico"),
    );
    fs.writeFileSync(logoPath, Buffer.from(logo));
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, logoPath);
    await button("Choose header logo").click();
    await button("Change header logo").waitFor();
    await button("Save revision").click();
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    // A saved operation can replace srcdoc while the test window is
    // painting. Wait for the current document, then request its actual frame.
    const header = page.frameLocator('iframe[title="Document header preview"]');
    await header
      .getByText("38th Mobile Infantry Division", { exact: true })
      .waitFor({ state: "attached" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator('iframe[title="Document header preview"]')
      .scrollIntoViewIfNeeded();
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    });
    fs.writeFileSync(
      path.join(folder, "header-before-assertion.png"),
      await app.evaluate(async ({ BrowserWindow }) =>
        (
          await BrowserWindow.getAllWindows()[0].webContents.capturePage()
        ).toPNG(),
      ),
    );
    fs.writeFileSync(
      path.join(folder, "header-dom.json"),
      JSON.stringify(
        {
          outer: await page
            .locator('iframe[title="Document header preview"]')
            .evaluate((el) => ({
              rect: el.getBoundingClientRect().toJSON(),
              style: getComputedStyle(el).cssText,
              parents: [
                ...(function* (e) {
                  while (e) {
                    yield e;
                    e = e.parentElement;
                  }
                })(el),
              ].map((e) => ({
                tag: e.tagName,
                classes: e.className,
                display: getComputedStyle(e).display,
                visibility: getComputedStyle(e).visibility,
                rect: e.getBoundingClientRect().toJSON(),
              })),
            })),
          inner: await header.locator("body").evaluate((el) => ({
            html: el.innerHTML,
            rect: el.getBoundingClientRect().toJSON(),
            nodes: [...el.querySelectorAll("*")].map((e) => ({
              tag: e.tagName,
              display: getComputedStyle(e).display,
              visibility: getComputedStyle(e).visibility,
              rect: e.getBoundingClientRect().toJSON(),
            })),
          })),
        },
        null,
        2,
      ),
    );
    await header
      .getByText("38th Mobile Infantry Division", { exact: true })
      .waitFor();
    assert(
      await header
        .locator("img")
        .evaluate((el) => el.complete && el.naturalWidth > 0),
    );
    state = await call("execute", { type: "load", operationId });
    assert.equal(
      state.operation.metadata.documentLayout.header.unit,
      "38th Mobile Infantry Division",
    );
    assert(state.operation.metadata.documentLayout.header.logo.assetId);
    report("configuration-text-logo-footer-and-save");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
      .locator('iframe[title="Document header preview"]')
      .scrollIntoViewIfNeeded();
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    });
    const capture = async (name) => {
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (
          await BrowserWindow.getAllWindows()[0].webContents.capturePage(
            undefined,
            { stayHidden: true, stayAwake: true },
          )
        ).toPNG(),
      );
      fs.writeFileSync(path.join(folder, name), Buffer.from(png));
    };
    await capture("document-settings.png");
    await navigateOperation(page, "Base order");
    const editor = page
      .locator('.rich-document[contenteditable="true"]')
      .filter({ visible: true })
      .first();
    const editorLabel = await editor.getAttribute("aria-label");
    await editor.fill(
      "Fictional relief teams support the island reception centre.",
    );
    await editor.press("Control+End");
    await editor.press("Control+Shift+Home");
    const rich = editor.locator("..", {}).locator("..");
    await rich.getByRole("button", { name: "Bold", exact: true }).click();
    assert(await editor.locator("strong").count());
    await rich.getByRole("button", { name: "Add link", exact: true }).click();
    await rich
      .getByRole("textbox", { name: `${editorLabel} link URL`, exact: true })
      .fill("javascript:bad()");
    await rich.getByRole("button", { name: "Apply link", exact: true }).click();
    await rich.getByRole("alert").waitFor();
    await rich
      .getByRole("textbox", { name: `${editorLabel} link URL`, exact: true })
      .fill("https://example.test/fictional");
    await rich.getByRole("button", { name: "Apply link", exact: true }).click();
    assert.equal(
      await editor.locator("a").getAttribute("href"),
      "https://example.test/fictional",
    );
    await rich
      .getByRole("button", { name: "Remove link", exact: true })
      .click();
    assert.equal(await editor.locator("a").count(), 0);
    await rich
      .getByRole("button", { name: "Expand editor", exact: true })
      .click();
    assert(
      await rich.evaluate((el) => el.classList.contains("editor-expanded")),
    );
    await rich
      .getByRole("button", { name: "Collapse editor", exact: true })
      .click();
    await editor.focus();
    await editor.press("Alt+F10");
    assert(
      await rich
        .locator(".rich-toolbar")
        .evaluate((el) => el.contains(document.activeElement)),
    );
    await button("Save revision").click();
    report("rich-text-selection-safe-links-expand-and-keyboard-toolbar");
    state = await call("execute", { type: "load", operationId });
    // Ensure the PDF spans several pages for repeating footer verification.
    state.operation.sections[0].summary = Array.from(
      { length: 80 },
      (_, i) =>
        `Fictional planning note ${i + 1}. Reception teams record requested supplies, confirm access arrangements, and report completion to the exercise coordinator.`,
    ).join("\n\n");
    state = await call("execute", {
      type: "save",
      operation: state.operation,
      expectedRevision: state.operation.revision,
    });
    const profile = state.profiles.find((p) => p.product === "opord");
    state = await call("execute", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      profileRef: { id: profile.id, version: profile.version },
      publicationId: null,
    });
    const record = state.exports[0];
    assert.equal(record.rendererVersion, "html-v6");
    assert.equal(record.staleness.outdated, false);
    fs.writeFileSync(path.join(folder, "configured-order.html"), record.html);
    for (const options of [
      { paper: "A4", orientation: "portrait" },
      { paper: "Letter", orientation: "landscape" },
    ]) {
      const pdf = await call("documents", {
        type: "generate",
        operationId,
        exportId: record.id,
        options,
      });
      assert.equal(pdf.record.printVersion, "ordo-print-v2");
      const filePath = path.join(
        folder,
        `configured-order-${options.paper}-${options.orientation}.pdf`,
      );
      await app.evaluate(({ dialog }, p) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
      }, filePath);
      await call("documents", { type: "save", id: pdf.record.id });
      assert(fs.statSync(filePath).size > 1000);
    }
    report("exact-configured-html-and-multipage-a4-letter-pdf");
    await page.reload();
    await openOperation(page, operationId);
    await button("Configuration").click();
    await field("Left footer text").fill("REVISED EXERCISE");
    await button("Save revision").click();
    const changed = await call("execute", { type: "load", operationId });
    assert(
      changed.exports
        .find((e) => e.id === record.id)
        .staleness.changedPaths.includes("document/footer/left"),
    );
    report("document-only-edit-stales-retained-export");
    await close();
    await launch();
    const reopened = await call("execute", { type: "load", operationId });
    assert.equal(
      reopened.operation.metadata.documentLayout.footer.left,
      "REVISED EXERCISE",
    );
    assert.equal(
      reopened.exports.find((e) => e.id === record.id).html,
      record.html,
    );
    assert.deepEqual(errors, []);
    await close();
    report("normal-offline-clean-exit-reopen-and-retained-settings");
    console.log(JSON.stringify({ folder, checks: checks.length }));
  } catch (e) {
    failure = e;
    write();
    if (page)
      try {
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    throw e;
  } finally {
    if (app) {
      if (failure && page) {
        const save = button("Save revision");
        if ((await save.count()) && (await save.isEnabled()))
          await save.click();
        await page
          .locator(
            '[data-workspace-busy="false"][data-workspace-dirty="false"]',
          )
          .waitFor();
      }
      await app.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
