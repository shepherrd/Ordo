// Fictional isolated workspace; normal launch/exit/reopen without startup flags.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "catalog-polish-" + uid());
  const data = path.join(folder, "workspace");
  fs.mkdirSync(data, { recursive: true });
  const packaged = process.argv.includes("--packaged"),
    env = { ...process.env, ORDO_DATA_DIR: data, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, page;
  const checks = [],
    errors = [],
    events = [];
  const write = (failure) =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          packaged,
          checks,
          errors,
          events,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const report = (step) => {
    checks.push(step);
    write();
    console.log("PASS " + step);
  };
  process.on("uncaughtExceptionMonitor", (error) => write(error));
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const launch = async () => {
    events.push({ at: new Date().toISOString(), stage: "launch" });
    write();
    app = await electron.launch({
      env,
      timeout: 60000,
      ...(packaged
        ? { executablePath: process.env.ORDO_PACKAGED_PATH, args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
    events.push({
      at: new Date().toISOString(),
      stage: "shell-ready",
      pid: app.process().pid,
    });
  };
  const close = async () => {
    await clean();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    events.push({ at: new Date().toISOString(), stage: "normal-close", pids });
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
  };
  const capture = async (file) => {
    await page.evaluate(() => document.fonts.ready);
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      );
    });
    await page.waitForTimeout(350);
    let timer;
    try {
      const bytes = await Promise.race([
        app.evaluate(async ({ BrowserWindow }) =>
          (
            await BrowserWindow.getAllWindows()[0].webContents.capturePage(
              undefined,
              { stayHidden: true, stayAwake: true },
            )
          ).toPNG(),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Capture exceeded 20 seconds")),
            20000,
          );
        }),
      ]);
      fs.writeFileSync(path.join(folder, file), Buffer.from(bytes));
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    await launch();
    await nav("Military Symbols");
    await field("New symbol name").fill("FICTIONAL DIVISION SYMBOL");
    await button("Create symbol").click();
    await field("Echelon / mobility").selectOption("21");
    await page.locator(".symbol-code-details > summary").click();
    assert.equal((await field("SIDC").inputValue()).slice(8, 10), "21");
    await field("Symbol set").selectOption("15");
    await page
      .getByRole("dialog", { name: "Change symbol set", exact: true })
      .waitFor();
    await button("Change set and reset components").click();
    assert.equal((await field("SIDC").inputValue()).slice(4, 6), "15");
    await field("Symbol set").selectOption("10");
    await button("Change set and reset components").click();
    await field("Echelon / mobility").selectOption("21");
    await button("Save symbol").click();
    await clean();
    await field("Code form").selectOption("LETTER");
    await button("Start new code").click();
    await field("Unit echelon").selectOption({ label: "Division" });
    assert.equal((await field("SIDC").inputValue())[11], "I");
    await field("Code form").selectOption("NUMERIC");
    await button("Start new code").click();
    await field("Echelon / mobility").selectOption("21");
    await button("Save symbol").click();
    await clean();
    assert.equal(await button("Publish symbol").count(), 0);
    const symbol = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: {
          search: "FICTIONAL DIVISION",
          status: "",
          offset: 0,
          limit: 10,
        },
      })
    ).page.items[0];
    assert(symbol);
    report(
      "numeric-and-legacy-echelon-and-symbol-set-controls-save-without-publishing",
    );
    await field("Echelon / mobility").scrollIntoViewIfNeeded();
    await capture("symbol-editor.png");

    await nav("Organizations");
    await button("New organization").click();
    await field("Organization designation").fill("FICTIONAL 38th Division");
    await button("Create organization").click();
    await clean();
    await field("Echelon").fill("Division");
    await field("Description").fill(
      "Fictional disaster relief organization with a long readable description.",
    );
    await field("Description").press("ControlOrMeta+a");
    await page
      .getByRole("toolbar", { name: "Description formatting", exact: true })
      .getByRole("button", { name: "Bold", exact: true })
      .click();
    await button("Staff & roles").click();
    await button("Add staff section").click();
    await button("Add position to New section").click();
    await field("Position title").fill("Relief coordinator");
    await field("Person filling this role").fill("Alex Rowan");
    await button("Symbol").click();
    await button("Choose symbol").click();
    await page
      .getByRole("dialog", { name: "Choose symbol", exact: true })
      .getByRole("button")
      .filter({ hasText: "FICTIONAL DIVISION SYMBOL" })
      .click();
    await button("Use symbol").click();
    await button("Save organization").click();
    await clean();
    let profile = (
      await call("workspace", {
        type: "browse-unit-profiles",
        query: {
          search: "FICTIONAL 38th",
          status: "",
          echelon: "",
          sort: "name",
          offset: 0,
          limit: 10,
        },
      })
    ).organizations.items[0];
    profile = (
      await call("workspace", {
        type: "unit-profile-get",
        id: profile.unitProfileVersionId,
      })
    ).profile;
    assert.equal(profile.staff.positions[0].incumbent.name, "Alex Rowan");
    assert(profile.identity.description.startsWith("[[ORDO_RICH_TEXT_V1:"));
    assert.equal(profile.defaultSymbol.definition.code.sidc.slice(8, 10), "21");
    for (const label of [
      "Versions",
      "Validation",
      "Preview",
      "Publish profile",
    ])
      assert.equal(await button(label).count(), 0, label);
    report(
      "organization-rich-description-personnel-and-unpublished-symbol-selection",
    );
    await button("Staff & roles").click();
    await field("Person filling this role").scrollIntoViewIfNeeded();
    await capture("organization-staff.png");
    const insignia = path.join(folder, "fictional-insignia.png");
    fs.writeFileSync(
      insignia,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, insignia);
    await button("Assets").click();
    await button("Import insignia image").click();
    await button("Save organization").click();
    await clean();
    await page.locator(".catalog-insignia").waitFor();
    assert(
      await page
        .locator(".catalog-insignia")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    );
    profile = (
      await call("workspace", {
        type: "unit-profile-get",
        id: profile.unitProfileVersionId,
      })
    ).profile;
    await button("Identity").click();
    await field("Description").scrollIntoViewIfNeeded();
    await capture("organization-description.png");
    report("organization-insignia-import-and-catalog-display");

    await nav("Doctrines");
    await field("New doctrine name").fill("Fictional relief doctrine");
    await button("New doctrine").click();
    await clean();
    await page.getByRole("tab", { name: "Staff", exact: true }).click();
    await field("Role name 1").fill("");
    await page
      .getByRole("alert")
      .filter({ hasText: /Staff/ })
      .first()
      .waitFor();
    await button("Save doctrine").click();
    await page
      .getByRole("alert")
      .filter({ hasText: /Staff/ })
      .first()
      .waitFor();
    await field("Role name 1").fill("Relief planning");
    await button("Add staff role").click();
    await page
      .locator(".doctrine-builder .staff-role-row")
      .filter({ has: field("Role name 2") })
      .getByRole("button", { name: "Remove role", exact: true })
      .click();
    await button("Save doctrine").click();
    await clean();
    const doctrines = (await call("execute", { type: "load" })).doctrines;
    const doctrine = doctrines.find(
      (d) => d.displayName === "Fictional relief doctrine",
    );
    assert.equal(doctrine.config.doctrine.staff[0].name, "Relief planning");
    assert(
      doctrine.config.doctrine.staff.some((s) => s.name === "New staff role"),
    );
    for (const name of ["Validation", "Preview", "Versions"])
      assert.equal(
        await page.getByRole("tab", { name, exact: true }).count(),
        0,
      );
    report(
      "generic-doctrine-role-edit-add-remove-and-save-with-inline-validation",
    );
    await field("Role name 1").scrollIntoViewIfNeeded();
    await capture("doctrine-staff.png");

    const op = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL POLISH RELIEF",
        demo: false,
        configuration: { id: doctrine.doctrineVersionId, version: 1 },
        unitProfileVersionId: profile.unitProfileVersionId,
        initializeTaskOrganization: true,
      })
    ).operation;
    assert.equal(op.units[0].name, "FICTIONAL 38th Division");
    const frozen = JSON.stringify(op);
    profile.identity.fullDesignation = "FICTIONAL RENAMED DIVISION";
    profile = (
      await call("workspace", {
        type: "unit-profile-save",
        profile,
        expectedContentVersion: profile.contentVersion,
      })
    ).profile;
    assert.equal(
      JSON.stringify(
        (await call("execute", { type: "load", operationId: op.id })).operation,
      ),
      frozen,
    );
    report("current-library-edits-preserve-operation-snapshots");

    let orbat = (
      await call("symbols", {
        type: "orbat-from-profile",
        id: profile.unitProfileVersionId,
        name: "FICTIONAL RELIEF ORBAT",
      })
    ).orbat;
    await nav("ORBATs");
    await button("FICTIONAL RELIEF ORBAT").click();
    const symbolDetails = page
      .locator("details")
      .filter({
        has: page
          .locator("summary")
          .filter({ hasText: "Selected unit and symbols" }),
      })
      .first();
    if (!(await symbolDetails.evaluate((d) => d.open)))
      await symbolDetails.locator("summary").first().click();
    await button("Add subordinate: FICTIONAL DIVISION SYMBOL").click();
    await button("Save ORBAT").click();
    await clean();
    orbat = (
      await call("symbols", { type: "get", kind: "ORBAT", id: orbat.versionId })
    ).orbat;
    assert.equal(orbat.nodes.length, 2);
    assert(
      orbat.nodes.some(
        (n) => n.unit.kind === "INLINE_UNIT" && n.unit.symbol?.source,
      ),
    );
    report(
      "orbat-symbol-tray-resolves-editable-catalog-identity-and-saves-a-child",
    );
    await page.locator(".symbol-tray").scrollIntoViewIfNeeded();
    await capture("orbat-symbol-tray.png");
    const imported = await call("symbols", {
      type: "import-orbat",
      operationId: op.id,
      expectedRevision: op.revision,
      orbatVersionId: orbat.versionId,
      importId: uid(),
      parentUnitId: null,
      confirmDuplicate: true,
      replaceLayout: false,
    });
    assert(imported.receipt);
    assert(imported.operation.units.length > op.units.length);
    report(
      "saved-orbat-create-and-import-without-draft-or-publication-lifecycle",
    );
    await nav("Dashboard");
    let richState = await call("execute", { type: "load", operationId: op.id });
    richState.operation.sections[0].summary = profile.identity.description;
    richState = await call("execute", {
      type: "save",
      operation: richState.operation,
      expectedRevision: richState.operation.revision,
    });
    const exportProfile = richState.profiles.find((p) => p.product === "opord");
    richState = await call("execute", {
      type: "generate",
      operationId: op.id,
      expectedRevision: richState.operation.revision,
      profileRef: { id: exportProfile.id, version: exportProfile.version },
      publicationId: null,
    });
    const richExport = richState.exports[0];
    assert.equal(richExport.rendererVersion, "html-v4");
    assert(richExport.html.includes("<strong>Fictional disaster relief"));
    assert(!richExport.html.includes("[[ORDO_RICH_TEXT"));
    assert(!richExport.html.includes("<p><div>"));
    fs.writeFileSync(path.join(folder, "rich-order.html"), richExport.html);
    const pdf = await call("documents", {
      type: "generate",
      operationId: op.id,
      exportId: richExport.id,
      options: { paper: "A4", orientation: "portrait" },
    });
    assert(pdf.record.byteLength > 1000);
    const pdfPath = path.join(folder, "rich-order.pdf");
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, pdfPath);
    await call("documents", { type: "save", id: pdf.record.id });
    assert(fs.statSync(pdfPath).size > 1000);
    report("rich-narrative-html-and-retained-pdf-generation");

    const graphic = await call("exportGraphic", {
      source: {
        kind: "SAVED_ORBAT",
        versionId: orbat.versionId,
        expectedContentVersion: orbat.contentVersion,
      },
      profile: {
        schemaVersion: 1,
        id: uid(),
        version: 1,
        name: "Fictional native exchange",
        product: "ORBAT",
        format: "JSON",
        jsonMode: "NATIVE_EXCHANGE",
        size: 100,
        scale: 1,
        background: "TRANSPARENT",
        foldPolicy: "AS_SHOWN",
        ancestorPolicy: "BOUNDARY",
        selectedUnitIds: null,
        renderProfile: { id: "ordo-symbol", version: 1 },
      },
    });
    const exchangePath = path.join(folder, "orbat-exchange.json");
    fs.writeFileSync(exchangePath, graphic.dependencies[0].canonicalValue);
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, exchangePath);
    const preview = await call(
      "previewLibraryImport",
      uid(),
      "DETACHED_COPIES",
    );
    assert(preview.canCommit);
    const receipt = await call("commitLibraryImport", preview.token, true);
    assert(receipt.targets.some((t) => t.kind === "ORBAT"));
    for (const t of receipt.targets)
      assert(
        (await call("symbols", { type: "get", kind: t.kind, id: t.versionId }))[
          t.kind === "ORBAT" ? "orbat" : "symbol"
        ],
      );
    await nav("Military Symbols");
    await page
      .getByText("Import Ordo JSON", { exact: true })
      .filter({ visible: true })
      .click();
    await field("Linked symbols and organizations").selectOption(
      "DETACHED_COPIES",
    );
    await button("Choose file and preview").click();
    await button("Import 1 new item").waitFor();
    await field("Linked symbols and organizations").scrollIntoViewIfNeeded();
    await capture("import-language.png");
    await button("Cancel import").click();
    report("native-orbat-closure-and-editable-import-preview");
    await app.evaluate(({ dialog }) => {
      globalThis.polishDialogs = [];
      dialog.showMessageBox = async (_win, options) => {
        globalThis.polishDialogs.push(options);
        return { response: 0, checkboxChecked: false };
      };
    });
    assert.equal(
      (await call("deleteItem", { kind: "symbol", id: symbol.versionId }))
        .deleted,
      false,
    );
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (_win, options) => {
        globalThis.polishDialogs.push(options);
        return { response: 1, checkboxChecked: false };
      };
    });
    assert.equal(
      (await call("deleteItem", { kind: "symbol", id: symbol.versionId }))
        .deleted,
      true,
    );
    const dialogs = await app.evaluate(() => globalThis.polishDialogs);
    assert(
      dialogs.every(
        (d) =>
          d.detail.includes("permanent") &&
          d.detail.includes("independent copies"),
      ),
    );
    assert(
      (
        await call("workspace", {
          type: "unit-profile-get",
          id: profile.unitProfileVersionId,
        })
      ).profile.defaultSymbol,
    );
    assert.equal(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .revision,
      richState.operation.revision,
    );
    report(
      "permanent-deletion-confirmation-cancel-and-independent-consumed-symbols",
    );

    const backup = path.join(folder, "workspace-backup.db");
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, backup);
    await call("backup");
    const extra = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "After backup",
      })
    ).symbol;
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, backup);
    const restored = await call("restore");
    assert(restored.doctrines.every((d) => d.contentVersion > 1000000));
    const catalogPage = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: { search: "", status: "", offset: 0, limit: 100 },
      })
    ).page;
    assert(
      !catalogPage.items.some(
        (s) =>
          s.versionId === extra.versionId || s.versionId === symbol.versionId,
      ),
    );
    assert.equal(
      (
        await call("workspace", {
          type: "unit-profile-get",
          id: profile.unitProfileVersionId,
        })
      ).profile.insigniaAssetId,
      profile.insigniaAssetId,
    );
    report(
      "backup-restore-preserves-editable-catalogs-assets-history-and-deletion-receipts",
    );
    await nav("Doctrines");
    const doctrineCount = (await call("execute", { type: "load" })).doctrines
      .length;
    for (let i = 0; i < doctrineCount; i++) {
      await button("Delete doctrine").click();
      await clean();
    }
    assert.equal((await call("execute", { type: "load" })).doctrines.length, 0);
    await field("New doctrine name").fill("FICTIONAL FRESH DOCTRINE");
    await button("New doctrine").click();
    await clean();
    assert.equal(
      (await call("execute", { type: "load" })).doctrines[0].displayName,
      "FICTIONAL FRESH DOCTRINE",
    );
    await page.getByRole("tab", { name: "Structure", exact: true }).click();
    await button("Add annex").click();
    await button("Save doctrine").click();
    await clean();
    assert.equal(
      (await call("execute", { type: "load" })).doctrines[0].config.doctrine
        .catalog.nodes.length,
      1,
    );
    report(
      "empty-doctrine-catalog-can-create-again-without-resurrecting-deleted-items",
    );
    await nav("Dashboard");
    await close();
    await launch();
    assert.equal(
      (
        await call("workspace", {
          type: "unit-profile-get",
          id: profile.unitProfileVersionId,
        })
      ).profile.identity.fullDesignation,
      profile.identity.fullDesignation,
    );
    assert.equal(
      (
        await call("symbols", {
          type: "get",
          kind: "ORBAT",
          id: orbat.versionId,
        })
      ).orbat.name,
      orbat.name,
    );
    assert.equal(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .revision,
      richState.operation.revision,
    );
    assert.deepEqual(errors, []);
    await close();
    report("normal-offline-clean-exit-reopen-and-persisted-content");
    write();
    console.log(JSON.stringify({ folder, checks: checks.length }));
  } catch (e) {
    write(e);
    if (page)
      try {
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    // Failure cleanup remains a normal app close; no process termination.
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
