// Offline Export Studio, real DOCX and PDF output, and saved-file compatibility.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: id, createHash } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(".test-data", "office-desktop-" + id());
  fs.mkdirSync(folder, { recursive: true });
  const executable = process.argv[2],
    env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const evidence = {
    executable: executable ?? "development build",
    checks: [],
    errors: [],
    lifecycle: [],
    screenshots: [],
    buildFiles: fs
      .readdirSync("out", { recursive: true })
      .filter((p) => fs.statSync(path.join("out", p)).isFile())
      .map((p) => ({
        path: p,
        sha256: createHash("sha256")
          .update(fs.readFileSync(path.join("out", p)))
          .digest("hex"),
      })),
  };
  const record = () =>
      fs.writeFileSync(
        path.join(folder, "result.json"),
        JSON.stringify(evidence, null, 2),
      ),
    pass = (name) => {
      evidence.checks.push(name);
      record();
      console.log("PASS " + name);
    };
  let app, page, operationId, state;
  const button = (name) =>
      page.getByRole("button", { name, exact: true }).filter({ visible: true }),
    label = (name) =>
      page.getByLabel(name, { exact: true }).filter({ visible: true });
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const launch = async () => {
    app = await electron.launch({
      ...(executable
        ? { executablePath: path.resolve(executable), args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1600, height: 1100 });
    evidence.lifecycle.push({ stage: "ready", pid: app.process().pid });
    record();
  };
  const close = async () => {
    const proc = app.process();
    await app.close();
    app = null;
    evidence.lifecycle.push({
      stage: "exit",
      pid: proc.pid,
      exitCode: proc.exitCode,
    });
    record();
    assert.equal(proc.exitCode, 0);
  };
  const save = async () => {
    await button("Save revision").click();
    await page
      .locator('[data-workspace-dirty="false"][data-workspace-busy="false"]')
      .filter({ visible: true })
      .first()
      .waitFor();
    state = await call("execute", { type: "load", operationId });
  };
  const shot = async (name) => {
    await page.screenshot({
      path: path.join(folder, name + ".png"),
      fullPage: true,
    });
    evidence.screenshots.push(name + ".png");
    record();
  };
  const openTab = () =>
    page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
  const settings = () =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
  const exportFile = async (action, name) => {
    const output = path.join(folder, name);
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, output);
    await action.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Saved " + output })
      .waitFor();
    assert(fs.statSync(output).size > 1000);
    return output;
  };
  try {
    await launch();
    const initial = await call("execute", { type: "load" }),
      config = initial.configurations.find((c) => !c.doctrine.catalog);
    state = await call("execute", {
      type: "create",
      name: "Fictional Office exchange",
      demo: true,
      configuration: {
        id: config.organization.id,
        version: config.organization.version,
      },
    });
    operationId = state.operation.id;
    const op = state.operation;
    op.metadata.documentLayout = {
      schemaVersion: 1,
      header: {
        title: "OPERATION ORDER",
        unit: "Fictional Relief Group",
        organization: "Training Directorate",
        location: "Exercise Area",
        dateTime: "19 OCTOBER 2026, 1200 UTC",
        classification: "FICTIONAL TRAINING",
        logo: null,
      },
      footer: {
        left: "Exercise copy",
        centre: "Operation Lantern",
        right: "Planning",
        pageNumbers: true,
      },
    };
    op.sections[0].summary =
      "Fictional situation for Office exchange. Editable paragraphs preserve the operation's saved source.";
    op.sections[1].summary =
      "Coordinate a fictional relief effort and maintain a clear common plan.";
    const importedSource = {
      type: "import",
      note: "legacy.xlsx · Units · row 2",
    };
    op.units[0].metadata.source = importedSource;
    const card = {
      id: id(),
      title: "Assigned task",
      mode: "linked",
      source: { kind: "entity", entityKind: "task", entityId: op.tasks[0].id },
      fields: ["name", "purpose", "unit"],
    };
    op.planningCards = { schemaVersion: 1, definitions: [card] };
    state = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    const profile = state.profiles.find((p) => p.product === "opord");
    state = await call("execute", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      profileRef: { id: profile.id, version: profile.version },
      publicationId: null,
    });
    fs.writeFileSync(path.join(folder, "order.html"), state.exports[0].html);
    await openOperation(page, operationId);
    assert.equal(await button("Office exchange").count(), 0);
    assert.equal(await button("Import spreadsheet").count(), 0);
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => {
        throw Error("Unexpected spreadsheet picker");
      };
    });
    await assert.rejects(
      call("office", { type: "read-table" }),
      (e) => !String(e).includes("Unexpected spreadsheet picker"),
    );
    await navigateOperation(page, "Export studio");
    const toolbar = page.locator(".export-toolbar").filter({ visible: true });
    const format = toolbar.getByLabel("File format");
    assert.deepEqual(await format.locator("option").allTextContents(), [
      "HTML",
      "PDF",
      "Word (.docx)",
    ]);
    await label("Export profile").selectOption(profile.id);
    await format.selectOption("DOCX");
    await label("Export paper").selectOption("A4");
    await label("Export orientation").selectOption("landscape");
    await exportFile(
      toolbar.getByRole("button", { name: "Export Word" }),
      "order.docx",
    );
    const listWord = async () =>
      (await call("office", { type: "list", operationId })).records;
    const [word] = await listWord();
    assert.equal(word.name, profile.name);
    assert.deepEqual(word.source.options, {
      paper: "A4",
      orientation: "landscape",
    });
    assert.equal(word.sourceRevision, state.operation.revision);
    assert.equal(
      word.contentHash,
      createHash("sha256")
        .update(fs.readFileSync(path.join(folder, "order.docx")))
        .digest("hex"),
    );
    pass(
      "Export Studio writes the selected profile and page settings to a retained Word file",
    );
    const oldSource = state.exports[0];
    const oldRow = page
      .locator(".history-row")
      .filter({ has: page.locator(".document-output") })
      .last();
    await oldRow
      .locator("summary")
      .filter({ hasText: "Word / PDF / print" })
      .click();
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    await oldRow.getByRole("button", { name: "Export Word" }).click();
    await page
      .getByRole("status")
      .filter({
        hasText: "Your Word file is available under Saved Word exports.",
      })
      .waitFor();
    assert.equal((await listWord())[0].source.exportId, oldSource.id);
    pass(
      "An existing saved product can be converted, and canceling the file dialog retains the new DOCX",
    );
    await format.selectOption("PDF");
    const pdf = await exportFile(
      toolbar.getByRole("button", { name: "Export PDF" }),
      "order.pdf",
    );
    assert(fs.readFileSync(pdf).subarray(0, 5).equals(Buffer.from("%PDF-")));
    pass("PDF exports from the same profile and source controls");
    const originals = await listWord();
    await settings();
    const themes = await label("Color theme")
      .locator("option")
      .evaluateAll((a) => a.map((o) => o.value));
    assert.equal(themes.length, 8);
    for (const theme of themes) {
      await label("Color theme").selectOption(theme);
      await openTab();
      await navigateOperation(page, "Export studio");
      await format.selectOption("DOCX");
      await page.setViewportSize({ width: 1050, height: 850 });
      const bounds = await toolbar.boundingBox();
      const action = await toolbar
        .getByRole("button", { name: "Export Word" })
        .boundingBox();
      assert(
        action.x >= bounds.x &&
          action.x + action.width <= bounds.x + bounds.width + 1,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await shot("export-studio-" + theme);
      await settings();
    }
    await page.setViewportSize({ width: 1600, height: 1100 });
    pass("Export controls fit at narrow desktop width in all eight themes");
    const backup = path.join(folder, "office-backup.db");
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, backup);
    await button("Back up workspace").click();
    await page.getByText("Backup saved:", { exact: false }).waitFor();
    await openTab();
    await navigateOperation(page, "Overview");
    await label("Operation name").fill("Changed after backup");
    await save();
    await settings();
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, backup);
    await button("Restore backup").click();
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    state = await call("execute", { type: "load", operationId });
    assert.equal(state.operation.name, "Fictional Office exchange");
    assert.deepEqual(state.operation.units[0].metadata.source, importedSource);
    assert.deepEqual(
      (await call("office", { type: "list", operationId })).records.map(
        (r) => r.contentHash,
      ),
      originals.map((r) => r.contentHash),
    );
    pass(
      "Backup and restore preserve previously imported unit data and retained Word files",
    );
    await close();
    await launch();
    await openOperation(page, operationId);
    await navigateOperation(page, "Export studio");
    await button("Save DOCX").first().waitFor();
    assert.equal(await button("Save DOCX").count(), 2);
    assert.equal(await button("Save PPTX").count(), 0);
    await exportFile(button("Save DOCX").last(), "reopened-order.docx");
    assert(
      fs
        .readFileSync(path.join(folder, "order.docx"))
        .equals(fs.readFileSync(path.join(folder, "reopened-order.docx"))),
    );
    pass(
      "Reopening a saved Word file after restart produces a byte-identical copy",
    );
    assert.deepEqual(evidence.errors, []);
  } catch (e) {
    evidence.failure = String(e.stack ?? e);
    record();
    console.error(e);
    if (page) await shot("failure").catch(() => {});
    process.exitCode = 1;
  } finally {
    if (app && evidence.failure)
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1;
        })
        .catch(() => {});
    if (app) await close();
    record();
    console.log(folder);
  }
})();
