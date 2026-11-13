// Isolated fictional workspace. Normal Electron launch/exit/reopen; no startup flags.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(
    ".test-data",
    "readable-order-desktop-" + randomUUID(),
  );
  fs.mkdirSync(folder, { recursive: true });
  const env = {
    ...process.env,
    ORDO_DATA_DIR: path.join(folder, "workspace"),
    ORDO_HEADLESS: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
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
    const catalog = await call("execute", { type: "load" });
    const doctrine = catalog.doctrines.find(
      (d) => d.config.doctrine.catalog?.nodes.length === 185,
    );
    assert(doctrine, "Expected bundled Army catalog");
    let state = await call("execute", {
      type: "create",
      name: "FICTIONAL RELIEF DOCUMENT",
      demo: true,
      configuration: { id: doctrine.doctrineVersionId, version: 1 },
    });
    const operationId = state.operation.id;
    const field = state.operation.authoring.fields[0];
    assert(field.references.length > 0);
    const text =
      "Fictional relief teams deliver supplies to the island reception centre. The reception team confirms delivery needs each morning.";
    field.text =
      "[[ORDO_RICH_TEXT_V1:" +
      Buffer.from(
        JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text, marks: [{ type: "bold" }] }],
            },
          ],
        }),
      ).toString("base64url") +
      "]]";
    state = await call("execute", {
      type: "save",
      operation: state.operation,
      expectedRevision: state.operation.revision,
    });
    let profile = state.profiles.find((p) => p.product === "opord");
    profile.inclusion.paragraphIds = [
      state.config.doctrine.catalog.baseFields.find(
        (f) => f.id === field.fieldId,
      ).paragraphId,
    ];
    profile.inclusion.packageScope = "selected";
    profile.inclusion.attachmentIds = [];
    state = await call("execute", {
      type: "save-profile",
      profile,
      isNew: false,
    });
    profile = state.profiles.find((p) => p.id === profile.id);
    await page.reload();
    await openOperation(page, operationId);
    await navigateOperation(page, "Export studio");
    await page
      .getByLabel("Export profile", { exact: true })
      .selectOption(profile.id);
    const frame = page.frameLocator(
      'iframe[title="Communications and OPORD preview"]',
    );
    await frame.getByText(text, { exact: true }).waitFor();
    assert.equal(
      await frame
        .getByRole("heading", { name: "Linked facts", exact: true })
        .count(),
      0,
    );
    assert.equal(await frame.locator("table").count(), 0);
    report(
      "live-preview-keeps-written-facts-without-an-appended-reference-table",
    );
    await button("Generate export").click();
    await button("Return to live").waitFor();
    state = await call("execute", { type: "load", operationId });
    const record = state.exports[0];
    assert.equal(record.rendererVersion, "html-v5");
    assert.equal(record.staleness.outdated, false);
    assert(record.html.includes("<strong>" + text + "</strong>"));
    assert(!record.html.includes("Linked facts"));
    assert(!record.html.includes("<table"));
    assert(record.dependencies.some((d) => d.path.startsWith("facts/")));
    assert.deepEqual(
      state.operation.authoring.fields[0].references,
      field.references,
    );
    fs.writeFileSync(path.join(folder, "clean-order.html"), record.html);
    report("retained-html-keeps-reference-dependencies-and-authored-text");
    await page
      .locator('iframe[title="Communications and OPORD preview"]')
      .scrollIntoViewIfNeeded();
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    });
    await page.waitForTimeout(350);
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      ).toPNG(),
    );
    fs.writeFileSync(
      path.join(folder, "clean-order-preview.png"),
      Buffer.from(png),
    );
    const pdf = await call("documents", {
      type: "generate",
      operationId,
      exportId: record.id,
      options: { paper: "A4", orientation: "portrait" },
    });
    assert(pdf.record.byteLength > 1000);
    const pdfPath = path.join(folder, "clean-order.pdf");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, pdfPath);
    await call("documents", { type: "save", id: pdf.record.id });
    assert(fs.statSync(pdfPath).size > 1000);
    report("pdf-generated-from-the-exact-clean-retained-html");
    await close();
    await launch();
    const reopened = await call("execute", { type: "load", operationId });
    assert.equal(
      reopened.exports.find((e) => e.id === record.id).html,
      record.html,
    );
    assert.deepEqual(
      reopened.operation.authoring.fields[0].references,
      field.references,
    );
    assert.deepEqual(errors, []);
    await close();
    report("normal-offline-clean-exit-reopen-and-retained-document");
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
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
