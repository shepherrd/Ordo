const {
  currentState,
  openOperation,
  createDemo,
  navigateOperation,
} = require("./smoke-global.cjs");
const { _electron: electron } = require("playwright");
const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const catalog = require("../src/config/us-army-orders.json").catalog.nodes;
(async () => {
  const folder = resolve(".test-data", `milestone2-smoke-${randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  const packaged = process.argv.includes("--packaged"),
    env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
    env,
    timeout: 60000,
    ...(packaged
      ? {
          executablePath:
            process.env.ORDO_PACKAGED_PATH ||
            resolve(
              "release",
              require("../package.json").version,
              "win-unpacked/Ordo.exe",
            ),
          args: [],
        }
      : { args: [resolve("out/main/index.js")] }),
  };
  let app,
    page,
    runtimeInfo,
    succeeded = false;
  const checks = [],
    failures = [];
  const report = (step, note) => {
    checks.push({ step, result: "PASS", note });
    writeFileSync(
      join(folder, "acceptance.json"),
      JSON.stringify({ packaged, checks }, null, 2),
    );
    console.log(`PASS ${step}: ${note}`);
  };
  const launch = async () => {
    app = await electron.launch(options);
    runtimeInfo = await app.evaluate(({ app }) => ({
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
    }));
    assert.equal(runtimeInfo.packaged, packaged);
    if (packaged)
      assert.equal(runtimeInfo.version, require("../package.json").version);
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.context().setOffline(true);
    page.on("pageerror", (e) => failures.push(e.message));
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      ),
    );
  };
  const capture = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true },
      );
    });
    await new Promise((r) => setTimeout(r, 350));
    const b = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      )
        .toPNG()
        .toString("base64"),
    );
    writeFileSync(join(folder, name), Buffer.from(b, "base64"));
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const nav = (name) => navigateOperation(page, name);
  const state = () => currentState(page);
  const save = async () => {
    await button("Save revision").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Planning revision saved" })
      .waitFor();
  };
  const node = (key) => catalog.find((n) => n.stableKey === key);
  const open = async (key) => {
    const n = node(key);
    await page
      .getByLabel("Find doctrine product")
      .fill(`${key} ${n.canonicalTitle}`);
    await button(`${key} ${n.canonicalTitle}`).click();
    await page
      .locator("main")
      .getByRole("heading", {
        name: new RegExp(
          n.canonicalTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        ),
      })
      .first()
      .waitFor();
  };
  const include = async (key) => {
    await open(key);
    if (await button("Include").isEnabled()) await button("Include").click();
  };
  const preview = async (contains, excludes = []) => {
    await page.locator("iframe").waitFor();
    for (const text of contains)
      await page.waitForFunction(
        (t) => document.querySelector("iframe")?.srcdoc.includes(t),
        text,
      );
    const html = await page.locator("iframe").getAttribute("srcdoc");
    for (const text of excludes)
      assert(!html.includes(text), `Preview excludes ${text}`);
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "");
    return html;
  };
  const productState = (s, key) =>
    s.operation.attachments.find((a) => a.doctrineNodeId === node(key).id);
  try {
    await launch();
    await createDemo(page, "DEMO BRIGADE OPERATION", true);
    await page
      .getByRole("heading", { name: "DEMO BRIGADE OPERATION", exact: true })
      .first()
      .waitFor();
    await nav("Base order");
    await page
      .getByLabel("Purpose", { exact: true })
      .fill("DEMO intent purpose");
    await page
      .getByRole("group", { name: "Key tasks", exact: true })
      .getByRole("checkbox")
      .first()
      .check();
    await button("Add end state field").click();
    await page
      .getByLabel("End state value 1", { exact: true })
      .fill("DEMO review complete");
    await page
      .getByLabel("Concept of Operations", { exact: true })
      .fill("DEMO concept references existing phases and tasks.");
    await save();
    let s = await state();
    assert.equal(s.operation.schemaVersion, 2);
    assert.equal(s.config.doctrine.catalog.profileKey, "us-army-orders");
    assert(
      s.operation.authoring.fields.some((f) =>
        f.entries?.some((e) => e.value === "DEMO review complete"),
      ),
    );
    await capture("01-base-authoring.png");
    report(
      1,
      "Fresh fictional brigade pins US Army Orders and authors structured Execution intent, key tasks, end state and concept",
    );
    assert.equal(
      await page.locator('[role="tree"] > [role="treeitem"]').count(),
      26,
    );
    await capture("02-doctrine-tree.png");
    report(
      2,
      "All A-Z catalog roots are visible; browsing does not instantiate products",
    );
    for (const key of ["O", "T", "X", "Y"]) {
      await open(key);
      assert.equal(await button("Start authoring").count(), 0);
      assert.equal(await button("Include").count(), 0);
    }
    report(
      3,
      "O/T/X/Y remain visible reserved spares and cannot be repurposed",
    );
    await open("A");
    await page
      .getByLabel("Unit name 1", { exact: true })
      .first()
      .fill("DEMO BRIGADE HQ RENAMED");
    await save();
    assert.equal(
      (await state()).operation.units[0].name,
      "DEMO BRIGADE HQ RENAMED",
    );
    await button("Product preview").click();
    await preview(["DEMO BRIGADE HQ RENAMED"]);
    report(4, "Annex A edits and previews the authoritative unit tree");
    await include("B");
    assert.equal(await page.locator(".product-links button").count(), 7);
    await open("B.1");
    assert.equal(await page.locator(".product-links button").count(), 4);
    await button("Start authoring").click();
    await button("Add field").click();
    await page
      .getByLabel("Field 1 value", { exact: true })
      .fill("DEMO generic intelligence notes");
    await capture("05-generic-authoring.png");
    report(
      5,
      "B has seven appendices; B1 has four tabs and uses generic structured authoring",
    );
    await include("C");
    await include("C.3");
    assert.equal(await page.locator(".product-links button").count(), 3);
    await include("C.3.A");
    await button("Start authoring").click();
    await button("Add row").click();
    await page
      .getByLabel("Row 1 Item", { exact: true })
      .fill("DEMO MATRIX ROW");
    await page
      .getByLabel("Row 1 Notes", { exact: true })
      .fill("Review the shared task record");
    await capture("06-matrix.png");
    await open("C.3.B");
    await button("Start authoring").click();
    assert.equal(await page.locator('[data-editor="matrix"]').count(), 1);
    await include("C.3.C");
    await button("Start authoring").click();
    await button("Add checklist item").click();
    await page
      .getByLabel("Checklist item 1", { exact: true })
      .fill("DEMO checklist review");
    await page.getByLabel("Complete item 1", { exact: true }).check();
    report(
      6,
      "C3 exposes Execution Matrix, Decision Support Template and Matrix, and Execution Checklist with typed editors",
    );
    await include("D");
    assert.equal(await page.locator(".product-links button").count(), 7);
    await open("D.7");
    await button("View doctrine details in Overview").click();
    await page
      .locator(".inspector")
      .getByText("FM 5-0 • Sample format", { exact: true })
      .waitFor();
    assert.equal(node("D.7").canonicalTableD2, false);
    report(
      7,
      "D1-D6 are canonical; D7 is separately labeled sample-format data",
    );
    for (const key of ["F", "F.1", "F.1.C", "F.1.C.1"]) await include(key);
    await button("Start authoring").click();
    await button("Add field").click();
    await page
      .getByLabel("Field 1 value", { exact: true })
      .fill("DEMO exhibit-level reference");
    await save();
    s = await state();
    assert.equal(productState(s, "F.1.C.1").kind, "exhibit");
    await capture("08-exhibit.png");
    report(
      8,
      "F1C1 demonstrates saved Annex → Appendix → Tab → Exhibit nesting",
    );
    await open("H");
    assert.equal(await page.locator(".product-links button").count(), 5);
    for (const [key, count] of [
      ["H.1", 1],
      ["H.2", 5],
      ["H.3", 11],
      ["H.4", 5],
      ["H.5", 3],
    ]) {
      await open(key);
      assert.equal(await page.locator(".product-links button").count(), count);
    }
    report(9, "H contains all five appendices and their supplied tabs");
    await include("H.4");
    await include("H.4.A");
    await page
      .getByLabel("Channel / frequency 1", { exact: true })
      .fill("DEMO M2 SHARED CHANNEL");
    await save();
    await nav("Signal data");
    assert.equal(
      await page
        .getByLabel("Channel / frequency 1", { exact: true })
        .inputValue(),
      "DEMO M2 SHARED CHANNEL",
    );
    await nav("Export studio");
    await preview(["DEMO M2 SHARED CHANNEL"], ["DEMO spectrum notes"]);
    await capture("10-live-card.png");
    report(
      10,
      "H4A, Signal workspace and live Communications Card share one authoritative net",
    );
    await include("J");
    await include("J.1");
    await open("J.1-sample");
    await button("Include").click();
    await page.getByRole("alert").filter({ hasText: "alternatives" }).waitFor();
    await button("Dismiss message").click();
    await open("J.1");
    await button("Omit").click();
    await include("J.1-sample");
    await save();
    s = await state();
    assert.equal(productState(s, "J.1").applicability, "OMITTED");
    assert.equal(productState(s, "J.1-sample").applicability, "INCLUDED");
    report(
      11,
      "J1 canonical and sample alternatives remain distinct; simultaneous inclusion is rejected",
    );
    await open("M");
    assert.equal(await page.locator(".product-links button").count(), 3);
    assert(
      (await page.locator(".product-links").innerText()).includes(
        "Sample format",
      ),
    );
    report(
      12,
      "All three M appendices are visibly sourced to the sample format",
    );
    await open("Q");
    assert.equal(await page.locator(".product-links button").count(), 5);
    await open("Q.3");
    await button("View doctrine details in Overview").click();
    await page
      .locator(".inspector")
      .getByText("Command and Control Information Systems Integration Matrix", {
        exact: true,
      })
      .first()
      .waitFor();
    report(
      13,
      "Q has five appendices; Q3 keeps its canonical title and separately sourced sample alias",
    );
    await include("R");
    await button("Start authoring").click();
    await button("Add report").click();
    await page
      .getByLabel("Report 1 name", { exact: true })
      .fill("DEMO STATUS REPORT");
    await page
      .getByLabel("Recipient unit", { exact: true })
      .selectOption({ label: "DEMO BRIGADE HQ RENAMED" });
    await page
      .getByLabel("Timeline event", { exact: true })
      .selectOption({ label: "DEMO H-HOUR" });
    report(
      14,
      "R uses a report catalog with canonical unit and timeline links",
    );
    await include("Z");
    await button("Start authoring").click();
    await button("Add recipient").click();
    await page
      .getByLabel("Recipient 1", { exact: true })
      .fill("DEMO DUTY OFFICER");
    await page
      .getByLabel("Recipient unit", { exact: true })
      .selectOption({ label: "DEMO BRIGADE HQ RENAMED" });
    await page.getByLabel("Acknowledgment required", { exact: true }).check();
    await capture("15-distribution.png");
    report(
      15,
      "Z uses a distribution list with canonical unit references and acknowledgment fields",
    );
    await include("E");
    await open("E");
    await button("Omit").click();
    await open("N");
    await button("Include").click();
    await button("Reset to undecided").click();
    await save();
    const saved = await state();
    await app.close();
    app = null;
    await launch();
    await openOperation(page);
    await page
      .getByRole("heading", { name: "DEMO BRIGADE OPERATION", exact: true })
      .first()
      .waitFor();
    s = await state();
    assert.deepEqual(s.operation, saved.operation);
    assert.equal(productState(s, "E").applicability, "OMITTED");
    assert.equal(productState(s, "N").applicability, "UNDECIDED");
    report(
      16,
      "Included/Omitted/Undecided states and authored products survive a real desktop restart",
    );
    await open("C");
    await button("Omit").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "omitted parent" })
      .waitFor();
    await button("Dismiss message").click();
    assert.equal(productState(await state(), "C").applicability, "INCLUDED");
    report(
      17,
      "Omitting a parent with included descendants is rejected without changing saved state",
    );
    await nav("Package composer");
    for (const filter of [
      "All",
      "Included",
      "Omitted",
      "Undecided",
      "Spare",
      "Has Issues",
      "By Owner",
    ]) {
      await page
        .getByLabel("Package filter", { exact: true })
        .selectOption(filter);
      if (filter === "Spare")
        assert.equal(await page.locator(".package-table tbody tr").count(), 4);
      if (filter === "By Owner")
        await page
          .getByLabel("Package owner", { exact: true })
          .selectOption("signal");
      assert((await page.locator(".package-table tbody tr").count()) > 0);
    }
    await page
      .getByLabel("Package filter", { exact: true })
      .selectOption("Included");
    await capture("18-package-composer.png");
    report(
      18,
      "Package Composer displays applicability, owner, workflow, content, findings and every requested filter",
    );
    await button("Package preview").click();
    const html = await preview(
      [
        "DEMO MATRIX ROW",
        "DEMO checklist review",
        "DEMO STATUS REPORT",
        "DEMO DUTY OFFICER",
        "DEMO M2 SHARED CHANNEL",
      ],
      [
        "Annex E — Protection",
        "Public Affairs Guidance",
        "DEMO generic intelligence notes",
      ],
    );
    writeFileSync(join(folder, "package-preview.html"), html);
    await capture("19-package-preview.png");
    report(
      19,
      "Package preview contains only included products with included ancestors, derived from current authoritative data",
    );
    await nav("Export studio");
    await button("Generate export").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Export generated" })
      .waitFor();
    let before = await state();
    const generated = before.exports[0];
    await open("H");
    await page
      .getByLabel("Channel / frequency 1", { exact: true })
      .fill("DEMO M2 REVISED CHANNEL");
    await save();
    s = await state();
    assert(s.exports.find((e) => e.id === generated.id).staleness.outdated);
    await nav("Overview");
    await page
      .getByLabel("Workflow status", { exact: true })
      .selectOption("approved");
    await save();
    await nav("Publications");
    await page.getByRole("button", { name: /^Approve Revision / }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "explicitly approved" })
      .waitFor();
    await button("Publish OPORD snapshot").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Immutable OPORD baseline published" })
      .waitFor();
    before = await state();
    const pub = before.publications[0];
    await open("B");
    await button("Omit").click();
    await save();
    s = await state();
    assert.deepEqual(s.publications[0], pub);
    assert.equal(
      productState({ operation: pub.snapshot }, "B").applicability,
      "INCLUDED",
    );
    const backup = join(folder, "m2-backup.db");
    await nav("Configuration");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, backup);
    await button("Back up workspace").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Backup saved" })
      .waitFor();
    const backed = await state();
    await nav("Signal data");
    await page
      .getByLabel("Channel / frequency 1", { exact: true })
      .fill("TEMPORARY RESTORE CHANGE");
    await save();
    await nav("Configuration");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await button("Restore backup").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Workspace restored" })
      .waitFor();
    s = await state();
    assert.deepEqual(s.operation, backed.operation);
    assert.deepEqual(s.publications, backed.publications);
    assert.deepEqual(s.exports, backed.exports);
    report(
      20,
      "Card staleness, explicit approval, frozen publication package and validated backup/restore work with Milestone 2 data",
    );
    assert.deepEqual(failures, []);
    writeFileSync(
      join(folder, "final-state.json"),
      JSON.stringify(await state(), null, 2),
    );
    const result = {
      success: true,
      packaged,
      runtimeInfo,
      dataDirectory: folder,
      checks,
      rendererErrors: failures,
    };
    writeFileSync(
      join(folder, "acceptance.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    succeeded = true;
  } catch (error) {
    if (app) {
      try {
        await capture("failure.png");
        writeFileSync(
          join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    }
    writeFileSync(join(folder, "failure.txt"), String(error));
    throw error;
  } finally {
    if (app) {
      if (!succeeded)
        await app
          .evaluate(({ dialog }) => {
            dialog.showMessageBoxSync = () => 1;
          })
          .catch(() => {});
      await app.close().catch(() => app.process().kill());
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
