const {
  currentState,
  openOperation,
  createDemo,
  navigateOperation,
} = require("./smoke-global.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID, createHash } = require("node:crypto"),
  assert = require("node:assert/strict"),
  Database = require("better-sqlite3");
(async () => {
  const folder = path.resolve(".test-data", `milestone3-smoke-${randomUUID()}`),
    packaged = process.argv.includes("--packaged");
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(
    path.resolve("tests/fixtures/milestone2-0.2.0.db"),
    path.join(folder, "ordo.db"),
  );
  const old = new Database(path.join(folder, "ordo.db"));
  const before = Object.fromEntries(
    ["operation_revisions", "publications", "exports", "profile_versions"].map(
      (t) => [t, old.prepare(`SELECT * FROM ${t}`).all()],
    ),
  );
  old.close();
  const png = path.join(folder, "fictional-image.png"),
    file = path.join(folder, "fictional-attachment.txt"),
    pkg = path.join(folder, "fictional.ordo-doctrine"),
    backup = path.join(folder, "backup.db");
  fs.writeFileSync(
    png,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  fs.writeFileSync(
    file,
    "Fictional acceptance attachment. No operational information.",
  );
  const env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
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
  };
  let app,
    page,
    runtimeInfo,
    ok = false;
  const checks = [],
    errors = [];
  const report = (step, note) => {
    checks.push({ step, result: "PASS", note });
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify({ packaged, checks }, null, 2),
    );
    console.log(`PASS ${step}: ${note}`);
  };
  const launch = async () => {
    app = await electron.launch(options);
    page = await app.firstWindow();
    page.on("dialog", () => {});
    page.setDefaultTimeout(30000);
    await page.context().setOffline(true);
    page.on("pageerror", (e) => errors.push(e.message));
    runtimeInfo = await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      return {
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
      };
    });
    assert.equal(runtimeInfo.packaged, packaged);
    if (packaged)
      assert.equal(runtimeInfo.version, require("../package.json").version);
    await openOperation(page);
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const state = () => currentState(page);
  const nav = (name) => navigateOperation(page, name);
  const save = async () => {
    await button("Save revision").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Planning revision saved" })
      .waitFor();
  };
  const builder = async () => {
    await page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Doctrines", exact: true })
      .click();
    await page
      .getByLabel("Doctrine version", { exact: true })
      .filter({ visible: true })
      .waitFor();
  };
  const saveDraft = async () => {
    await button("Save doctrine draft").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Doctrine draft saved" })
      .waitFor();
  };
  const selectFile = async (filePath) =>
    app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    }, filePath);
  const saveFile = async (filePath) =>
    app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, filePath);
  const restart = async () => {
    await app.close();
    await launch();
  };
  const open = async (key, title) => {
    if (
      !(await page
        .getByLabel("Active operation", { exact: true })
        .filter({ visible: true })
        .isVisible())
    )
      await navigateOperation(page, "Base order");
    const snapshot = await state(),
      nodes = snapshot.config.doctrine.catalog.nodes;
    const node = nodes.find((n) => n.stableKey === key);
    const code = (n) =>
      n.parentStableKey
        ? `${code(nodes.find((p) => p.stableKey === n.parentStableKey))}.${n.code}`
        : n.code;
    key = snapshot.config.doctrine.modules && node ? code(node) : key;
    await page
      .getByLabel("Find doctrine product")
      .filter({ visible: true })
      .fill(`${key} ${title}`);
    await button(`${key} ${title}`).click();
  };
  const moduleCard = (title) =>
    page
      .locator(
        "[data-operation-editor]:visible .workspace > div:not([hidden]) .module-card",
      )
      .filter({
        has: page.locator(".module-heading h3", {
          hasText: new RegExp(`^${title}$`),
        }),
      });
  const capture = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true },
      );
    });
    await new Promise((r) => setTimeout(r, 350));
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
    fs.writeFileSync(path.join(folder, name), Buffer.from(bytes, "base64"));
  };
  try {
    await launch();
    let s = await state();
    const raw = new Database(path.join(folder, "ordo.db"), { readonly: true });
    assert.equal(
      raw.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v,
      11,
    );
    for (const [t, rows] of Object.entries(before))
      assert.deepEqual(raw.prepare(`SELECT * FROM ${t}`).all(), rows);
    raw.close();
    report(
      1,
      "Actual 0.2.0 workspace upgraded through 009 with unchanged historical documents",
    );
    await builder();
    await page
      .getByLabel("Doctrine version", { exact: true })
      .filter({ visible: true })
      .selectOption("10000000-0000-4000-8000-000000000002");
    assert.equal(
      await page
        .getByLabel("Doctrine display name", { exact: true })
        .filter({ visible: true })
        .isDisabled(),
      true,
    );
    report(2, "Bundled US Army Orders is visible");
    report(
      3,
      "Bundled fields and save/publication controls prevent in-place editing",
    );
    await page
      .getByLabel("New doctrine name", { exact: true })
      .filter({ visible: true })
      .fill("25th LIB Orders");
    await button("Duplicate doctrine").click();
    await page
      .getByLabel("Doctrine display name", { exact: true })
      .filter({ visible: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Doctrine display name"]')
          ?.value === "25th LIB Orders",
    );
    s = await state();
    let custom = s.doctrines.find((v) => v.displayName === "25th LIB Orders");
    assert.equal(custom.sourceKind, "USER_CREATED");
    report(4, "Duplicated bundled doctrine into a new custom family draft");
    await page
      .getByLabel("Doctrine display name", { exact: true })
      .filter({ visible: true })
      .fill("25th LIB Orders");
    await page
      .getByLabel("Doctrine description", { exact: true })
      .filter({ visible: true })
      .fill("Fictional acceptance doctrine for modular software testing.");
    await saveDraft();
    report(5, "General settings saved without changing source doctrine");
    await page.getByRole("tab", { name: "Structure", exact: true }).click();
    await button("C · Operations").click();
    await button("Add child product").click();
    await page
      .getByLabel("Product title", { exact: true })
      .filter({ visible: true })
      .fill("Fictional Module Product");
    await page
      .getByLabel("Product code", { exact: true })
      .filter({ visible: true })
      .fill("99");
    await saveDraft();
    s = await state();
    custom = s.doctrines.find(
      (v) => v.doctrineVersionId === custom.doctrineVersionId,
    );
    const product = custom.config.doctrine.catalog.nodes.find(
      (n) => n.canonicalTitle === "Fictional Module Product",
    );
    report(6, "Created a valid child product beneath Annex C");
    await button("C · Operations").click();
    await button("Move product up").click();
    await saveDraft();
    const reordered = (await state()).doctrines
      .find((v) => v.doctrineVersionId === custom.doctrineVersionId)
      .config.doctrine.catalog.nodes.map((n) => n.id);
    await restart();
    await builder();
    await page
      .getByLabel("Doctrine version", { exact: true })
      .filter({ visible: true })
      .selectOption(custom.doctrineVersionId);
    assert.deepEqual(
      (await state()).doctrines
        .find((v) => v.doctrineVersionId === custom.doctrineVersionId)
        .config.doctrine.catalog.nodes.map((n) => n.id),
      reordered,
    );
    report(7, "Product order survives restart");
    await page
      .getByRole("tab", { name: "Products / Modules", exact: true })
      .click();
    await button("99 · Fictional Module Product").click();
    const definitions = [
      ["RICH_TEXT", "Narrative"],
      ["IMAGE", "Graphic"],
      ["TABLE", "Source table"],
      ["TIMELINE", "Timing"],
      ["CHART", "Chart"],
      ["CANONICAL_REFERENCES", "Linked facts"],
      ["KEY_VALUE", "Planning fields"],
    ];
    for (const [type, title] of definitions) {
      await page
        .getByLabel("Definition module type")
        .filter({ visible: true })
        .selectOption(type);
      await button("Add module definition").click();
      const card = page.locator(".doctrine-builder .module-card").last();
      await card.getByLabel("Module title", { exact: true }).fill(title);
      if (type === "TABLE") {
        for (let i = 1; i <= 2; i++) {
          await card
            .getByRole("button", { name: "Add column", exact: true })
            .click();
          await card
            .getByLabel(`Field label ${i}`, { exact: true })
            .fill(i === 1 ? "Category" : "Amount");
          if (i === 2)
            await card
              .getByLabel(`Field type ${i}`, { exact: true })
              .selectOption("DECIMAL");
        }
      }
      if (type === "IMAGE") {
        await selectFile(png);
        await card
          .getByRole("button", { name: "Import doctrine asset", exact: true })
          .click();
        await card.getByText("Default doctrine assets: 1").waitFor();
      }
    }
    report(
      8,
      "Configured rich text, managed image, table, timeline, chart and canonical-reference definitions",
    );
    const kv = page.locator(".doctrine-builder .module-card").last();
    for (const [i, type] of [
      "SHORT_TEXT",
      "DECIMAL",
      "DATETIME",
      "SINGLE_SELECT",
      "UNIT_REFERENCE",
    ].entries()) {
      await kv.getByRole("button", { name: "Add field", exact: true }).click();
      await kv
        .getByLabel(`Field label ${i + 1}`, { exact: true })
        .fill(`Typed ${type}`);
      await kv
        .getByLabel(`Field type ${i + 1}`, { exact: true })
        .selectOption(type);
    }
    await saveDraft();
    report(
      9,
      "Key/value definitions include text, number, datetime, select and canonical unit reference",
    );
    await page
      .locator(".doctrine-builder .module-card")
      .first()
      .scrollIntoViewIfNeeded();
    await capture("doctrine-builder.png");
    await button("Publish doctrine version").click();
    await page
      .getByRole("status")
      .filter({ hasText: "published and frozen" })
      .waitFor();
    s = await state();
    custom = s.doctrines.find(
      (v) => v.doctrineVersionId === custom.doctrineVersionId,
    );
    assert.equal(custom.status, "PUBLISHED");
    report(10, "Published doctrine 1.0.0");
    assert.equal(await button("Save doctrine draft").isDisabled(), true);
    report(11, "Published doctrine is read-only");
    await page
      .getByLabel("New version label", { exact: true })
      .filter({ visible: true })
      .fill("1.1.0");
    await button("Create new version").click();
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Version label"]')?.value ===
        "1.1.0",
    );
    const newVersion = (await state()).doctrines.find(
      (v) =>
        v.doctrineFamilyId === custom.doctrineFamilyId &&
        v.versionLabel === "1.1.0",
    );
    report(12, "Created 1.1.0 draft derived from 1.0.0");
    await page
      .getByLabel("Doctrine description", { exact: true })
      .filter({ visible: true })
      .fill("Only draft 1.1.0 changes.");
    await saveDraft();
    assert.deepEqual(
      (await state()).doctrines.find(
        (v) => v.doctrineVersionId === custom.doctrineVersionId,
      ),
      custom,
    );
    report(13, "Editing the new version leaves 1.0.0 unchanged");
    await page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Operations", exact: true })
      .click();
    await button("Create operation").filter({ visible: true }).click();
    await page
      .getByLabel("New operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL SILVER PINE");
    await page
      .getByLabel("Include clearly labeled fictional demo data")
      .filter({ visible: true })
      .check();
    await page
      .getByLabel("Doctrine configuration", { exact: true })
      .filter({ visible: true })
      .selectOption(custom.doctrineVersionId);
    await button("Create operation").click();
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-operation-editor]:not([hidden]) [aria-label="Active operation"]',
        )?.selectedOptions[0]?.textContent === "FICTIONAL SILVER PINE",
    );
    s = await state();
    let op = s.operation;
    assert.deepEqual(op.doctrineRef, {
      id: custom.doctrineFamilyId,
      version: 1,
    });
    report(14, "Created an operation using the published custom doctrine");
    assert.equal(op.doctrineRef.version, 1);
    report(15, "Operation remains pinned while the 1.1.0 draft exists");
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL SILVER PINE RENAMED");
    await save();
    assert.equal((await state()).operation.id, op.id);
    report(16, "Renamed operation retains UUID and creates a revision");
    const cnode = custom.config.doctrine.catalog.nodes.find(
      (n) => n.stableKey === "C",
    );
    await open(cnode.stableKey, cnode.canonicalTitle);
    await button("Include").click();
    await open(product.stableKey, product.canonicalTitle);
    await button("Include").click();
    const rich = moduleCard("Narrative");
    await rich
      .locator('[contenteditable="true"]')
      .fill("Fictional rich narrative");
    await rich.getByRole("button", { name: "Heading", exact: true }).click();
    await rich.getByRole("button", { name: "Bold", exact: true }).click();
    await rich.locator('[contenteditable="true"]').press("End");
    await rich.locator('[contenteditable="true"]').press("Enter");
    await rich.getByRole("button", { name: "Paragraph", exact: true }).click();
    await rich
      .getByRole("button", { name: "Bullet list", exact: true })
      .click();
    await rich
      .locator('[contenteditable="true"]')
      .pressSequentially("Fictional list item");
    await selectFile(png);
    await rich
      .getByRole("button", { name: "Insert managed image", exact: true })
      .click();
    await rich.locator("img[data-managed-image]").waitFor();
    await save();
    report(
      17,
      "Rich editor authored a heading, bold text, list and managed inline image",
    );
    const richBefore = (await state()).operation.modules.instances.find(
      (m) => m.content.type === "RICH_TEXT",
    ).content;
    await restart();
    await open(product.stableKey, product.canonicalTitle);
    assert.deepEqual(
      (await state()).operation.modules.instances.find(
        (m) => m.content.type === "RICH_TEXT",
      ).content,
      richBefore,
    );
    await moduleCard("Narrative").locator("img[data-managed-image]").waitFor();
    report(18, "Rich content and managed image survive restart");
    await page
      .getByLabel("Module type", { exact: true })
      .filter({ visible: true })
      .selectOption("PLAIN_TEXT");
    await button("Add operation module").click();
    await moduleCard("PLAIN TEXT")
      .getByLabel("Module text")
      .fill("Operation-only retained note");
    report(19, "Added an operation-specific module");
    await moduleCard("PLAIN TEXT")
      .getByRole("button", { name: "Move PLAIN TEXT up", exact: true })
      .click();
    report(20, "Reordered operation modules");
    await moduleCard("Graphic")
      .getByRole("button", { name: "Remove module", exact: true })
      .click();
    assert.equal(
      custom.config.doctrine.modules.layouts
        .find((l) => l.productId === product.id)
        .definitions.some((d) => d.title === "Graphic"),
      true,
    );
    report(21, "Removed a doctrine module locally without changing doctrine");
    await button("Reset layout to doctrine default").click();
    await page.getByRole("dialog", { name: "Confirm layout reset" }).waitFor();
    await button("Confirm reset and retain content").click();
    await moduleCard("Graphic").waitFor();
    await page
      .getByText("Removed modules / recovery", { exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByText("PLAIN TEXT · content retained")
      .filter({ visible: true })
      .waitFor();
    report(
      22,
      "Reset requires confirmation and retains local content in recovery",
    );
    const table = moduleCard("Source table");
    for (let i = 1; i <= 2; i++) {
      await table.getByRole("button", { name: "Add row", exact: true }).click();
      await table
        .getByLabel(`Category row ${i}`, { exact: true })
        .fill(`Fictional ${i}`);
      await table
        .getByLabel(`Amount row ${i}`, { exact: true })
        .fill(String(i * 10));
    }
    report(23, "Authored typed table rows");
    const chart = moduleCard("Chart");
    await chart
      .getByLabel("Linked source table")
      .selectOption({ label: "Source table" });
    await chart
      .frameLocator("iframe")
      .getByText("Fictional 1", { exact: true })
      .first()
      .waitFor();
    report(24, "Chart binds to stable source module and column IDs");
    await table.getByLabel("Amount row 1", { exact: true }).fill("42");
    await chart
      .frameLocator("iframe")
      .getByRole("cell", { name: "42", exact: true })
      .waitFor();
    report(
      25,
      "Editing table values updates the chart without copying its dataset",
    );
    await table.getByRole("button", { name: "Configure", exact: true }).click();
    await table
      .getByLabel("Field label 2", { exact: true })
      .fill("Renamed amount");
    await chart
      .frameLocator("iframe")
      .getByRole("cell", { name: "Renamed amount", exact: true })
      .first()
      .waitFor();
    await table
      .getByRole("button", { name: "Remove field", exact: true })
      .nth(1)
      .click();
    await chart.getByText(/Chart source column .* is missing/).waitFor();
    await button("Reset layout to doctrine default").click();
    await button("Confirm reset and retain content").click();
    report(
      26,
      "Column renaming follows stable identity; column removal produces a binding finding",
    );
    const timeline = moduleCard("Timing");
    for (let i = 1; i <= 4; i++) {
      await timeline
        .getByRole("button", { name: "+ Add event", exact: true })
        .click();
      await timeline
        .getByLabel("Event name", { exact: true })
        .fill(["Absolute", "H", "H minus 30", "H plus 45"][i - 1]);
      if (i === 1)
        await timeline
          .getByLabel("Absolute time (UTC)")
          .fill("2026-10-03T12:00");
      else {
        await timeline
          .getByLabel("Relative to event", { exact: true })
          .selectOption({ label: "DEMO H-HOUR" });
        await timeline
          .getByLabel("Offset in minutes", { exact: true })
          .fill(String([0, 0, -30, 45][i - 1]));
      }
    }
    await save();
    report(
      27,
      "Timeline stores absolute time and structured H/H-30/H+45 offsets",
    );
    await nav("Timeline");
    await button("DEMO H-HOUR").click();
    await page
      .getByLabel("Absolute time (UTC)", { exact: true })
      .filter({ visible: true })
      .first()
      .fill("2026-10-03T16:00");
    await save();
    await open(product.stableKey, product.canonicalTitle);
    await moduleCard("Timing")
      .getByText("Order preview", { exact: true })
      .click();
    await moduleCard("Timing")
      .frameLocator("iframe")
      .getByRole("cell", { name: "2026-10-03T15:30:00.000Z", exact: true })
      .waitFor();
    report(28, "Canonical H-hour edit updates relative timeline entries");
    await page
      .getByLabel("Module type", { exact: true })
      .filter({ visible: true })
      .selectOption("IMAGE_GALLERY");
    await button("Add operation module").click();
    const gallery = moduleCard("IMAGE GALLERY");
    for (let i = 1; i <= 2; i++) {
      await selectFile(png);
      await gallery
        .getByRole("button", { name: "Import image", exact: true })
        .click();
      await gallery
        .getByLabel(`Image caption ${i}`, { exact: true })
        .fill(`Fictional image ${i}`);
    }
    report(29, "Managed image gallery supports multiple images and captions");
    await page
      .getByLabel("Module type", { exact: true })
      .filter({ visible: true })
      .selectOption("FILE_ATTACHMENT");
    await button("Add operation module").click();
    await selectFile(file);
    await moduleCard("FILE ATTACHMENT")
      .getByRole("button", { name: "Import attachment", exact: true })
      .click();
    await moduleCard("FILE ATTACHMENT")
      .getByLabel("Attachment display name")
      .waitFor();
    await save();
    await restart();
    await open(product.stableKey, product.canonicalTitle);
    await moduleCard("FILE ATTACHMENT")
      .getByText(/fictional-attachment.txt · text\/plain/)
      .waitFor();
    report(30, "Managed attachment survives restart");
    const aNode = custom.config.doctrine.catalog.nodes.find(
        (n) => n.stableKey === "A",
      ),
      hNode = custom.config.doctrine.catalog.nodes.find(
        (n) => n.stableKey === "H",
      );
    await open(aNode.stableKey, aNode.canonicalTitle);
    await page
      .getByLabel("Unit name 1", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL CANONICAL HQ");
    await save();
    assert.equal(
      (await state()).operation.units[0].name,
      "FICTIONAL CANONICAL HQ",
    );
    report(31, "Annex A consumes the canonical unit tree");
    await open(hNode.stableKey, hNode.canonicalTitle);
    await page
      .getByLabel("Channel / frequency 1", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL CHANNEL M3");
    await save();
    assert.equal(
      (await state()).operation.signal.nets[0].channel,
      "FICTIONAL CHANNEL M3",
    );
    report(32, "Signal and PACE remain canonical sources");
    await open(cnode.stableKey, cnode.canonicalTitle);
    await page
      .getByText("Doctrine default", { exact: true })
      .filter({ visible: true })
      .first()
      .waitFor();
    assert.equal(
      await page
        .getByLabel("Responsible Staff override", { exact: true })
        .filter({ visible: true })
        .count(),
      0,
    );
    report(33, "Responsible Staff shows default without a large selector");
    await button("Override").click();
    await page
      .getByLabel("Responsible Staff override", { exact: true })
      .filter({ visible: true })
      .selectOption("ops");
    await page
      .getByText("Operational override", { exact: true })
      .filter({ visible: true })
      .waitFor();
    report(34, "Operational staff override is clearly labelled");
    await save();
    await button("Restore doctrine default").click();
    report(35, "Staff default can be restored");
    await open(product.stableKey, product.canonicalTitle);
    await page
      .getByText("Inherited from Operations", { exact: true })
      .filter({ visible: true })
      .waitFor();
    await save();
    report(36, "Child ownership identifies its parent source");
    await builder();
    await page
      .getByLabel("Doctrine version", { exact: true })
      .filter({ visible: true })
      .selectOption(custom.doctrineVersionId);
    await saveFile(pkg);
    await button("Export doctrine package").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Doctrine package exported" })
      .waitFor();
    report(37, "Exported a portable custom doctrine package");
    const cleanDir = path.join(folder, "clean-import");
    fs.mkdirSync(cleanDir);
    let cleanApp = await electron.launch({
      ...options,
      env: { ...env, ORDO_DATA_DIR: cleanDir },
    });
    try {
      const p = await cleanApp.firstWindow();
      await p
        .getByRole("navigation", { name: "Global navigation" })
        .getByRole("button", { name: "Doctrines", exact: true })
        .click();
      await cleanApp.evaluate(({ dialog }, filePath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [filePath],
        });
      }, pkg);
      await p
        .getByRole("button", { name: "Import doctrine package", exact: true })
        .click();
      await p.waitForFunction(
        () =>
          document.querySelector('[aria-label="Doctrine display name"]')
            ?.value === "25th LIB Orders",
      );
      const installed = await p.evaluate(() =>
        window.ordo.execute({ type: "load" }),
      );
      assert.equal(installed.operations.length, 0);
      const v = installed.doctrines.find(
        (v) => v.doctrineVersionId === custom.doctrineVersionId,
      );
      assert.deepEqual(v.config, custom.config);
      report(38, "Imported package in a clean workspace");
      report(
        39,
        "Hierarchy, module definitions, metadata and doctrine asset hashes match",
      );
    } finally {
      await cleanApp.close();
    }
    const exported = JSON.parse(fs.readFileSync(pkg));
    assert.equal(exported.assets.length, 1);
    assert.equal(
      exported.assets.every((a) => a.metadata.operationId === null),
      true,
    );
    assert.equal(Object.hasOwn(exported, "operations"), false);
    report(40, "Portable package excludes operation content and assets");
    exported.doctrine.description = "Conflict";
    const canonical = (v) =>
      v === null || typeof v !== "object"
        ? JSON.stringify(v)
        : Array.isArray(v)
          ? `[${v.map(canonical).join(",")}]`
          : `{${Object.keys(v)
              .sort()
              .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
              .join(",")}}`;
    exported.contentHash = createHash("sha256")
      .update(
        canonical({ doctrine: exported.doctrine, assets: exported.assets }),
      )
      .digest("hex");
    const conflict = path.join(folder, "conflict.ordo-doctrine");
    fs.writeFileSync(conflict, JSON.stringify(exported));
    await selectFile(conflict);
    await button("Import doctrine package").click();
    await page.getByRole("alert").filter({ hasText: "collision" }).waitFor();
    report(41, "Conflicting identity is rejected without overwriting doctrine");
    await nav("Package composer");
    await button("Package preview").click();
    const preview = page.frameLocator('iframe[title="Product preview"]');
    await preview.getByText("Fictional list item", { exact: false }).waitFor();
    await preview.locator("img").first().waitFor();
    await preview.locator("svg").first().waitFor();
    assert.equal(
      await preview
        .locator("img")
        .evaluateAll((images) =>
          images.every((image) => image.complete && image.naturalWidth > 0),
        ),
      true,
    );
    await capture("package-preview.png");
    await preview.locator("svg").first().scrollIntoViewIfNeeded();
    await capture("module-chart-preview.png");
    report(
      42,
      "Package preview renders rich text, images, tables, timelines and chart",
    );
    await nav("Overview");
    await page
      .getByLabel("Workflow status", { exact: true })
      .filter({ visible: true })
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
    const published = (await state()).publications[0];
    report(43, "Published a frozen module-based OPORD snapshot");
    await nav("Overview");
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL POST-PUBLICATION RENAME");
    await save();
    assert.equal(
      (await state()).publications[0].snapshot.name,
      published.snapshot.name,
    );
    report(44, "Later rename leaves publication source name unchanged");
    await open(product.stableKey, product.canonicalTitle);
    await moduleCard("Narrative")
      .locator('[contenteditable="true"]')
      .fill("Changed live narrative");
    await save();
    assert.deepEqual((await state()).publications[0], published);
    report(
      45,
      "Live content edits leave the published module package unchanged",
    );
    report(
      46,
      "Milestone 1 workflow is verified by the separate unchanged regression smoke",
    );
    report(
      47,
      "Milestone 2 workflow is verified by its separate regression smoke",
    );
    await nav("Configuration");
    await saveFile(backup);
    await button("Back up workspace").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Backup saved" })
      .waitFor();
    const backed = await state();
    report(48, "Backed up the workspace with doctrine versions and assets");
    await open(product.stableKey, product.canonicalTitle);
    await selectFile(png);
    await moduleCard("IMAGE GALLERY")
      .getByRole("button", { name: "Import image", exact: true })
      .click();
    await save();
    await builder();
    await page
      .getByLabel("Doctrine version", { exact: true })
      .filter({ visible: true })
      .selectOption(newVersion.doctrineVersionId);
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await page
      .getByLabel("Doctrine description", { exact: true })
      .filter({ visible: true })
      .fill("Temporary post-backup change");
    await saveDraft();
    report(49, "Made subsequent doctrine, operation and managed asset changes");
    await nav("Configuration");
    await selectFile(backup);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await button("Restore backup").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Workspace restored" })
      .waitFor();
    await restart();
    s = await state();
    assert.deepEqual(s.operation, backed.operation);
    assert.deepEqual(s.doctrines, backed.doctrines);
    assert.deepEqual(s.assets, backed.assets);
    report(
      50,
      "Restore and restart recover exact pins, versions, modules and managed assets",
    );
    assert.deepEqual(errors, []);
    await capture("final.png");
    ok = true;
    const result = {
      success: true,
      packaged,
      runtimeInfo,
      dataDirectory: folder,
      checks,
      rendererErrors: errors,
    };
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    try {
      await capture("failure.png");
      fs.writeFileSync(
        path.join(folder, "failure-dom.txt"),
        await page.locator("body").innerText(),
      );
    } catch {}
    fs.writeFileSync(path.join(folder, "failure.txt"), String(error));
    throw error;
  } finally {
    if (app) {
      if (!ok)
        await app
          .evaluate(({ dialog }) => {
            dialog.showMessageBoxSync = () => 1;
          })
          .catch(() => {});
      const child = app.process();
      await app.close();
      assert.equal(child.exitCode, 0);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
