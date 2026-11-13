// Fictional isolated data; native dialogs are answered deterministically.
// Normal Electron startup, clean exit and reopen use the unchanged 60s limit.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
(async () => {
  const packaged = process.argv.includes("--packaged"),
    version = require("../package.json").version;
  const folder = path.resolve(".test-data", "deletion-ui-" + uid()),
    data = path.join(folder, "workspace");
  fs.mkdirSync(data, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: data, ORDO_HEADLESS: "1" };
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
          version,
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
    console.log("PASS " + step);
    write();
  };
  const event = (stage, detail = {}) => {
    events.push({ at: new Date().toISOString(), stage, ...detail });
    write();
  };
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const idle = () => page.locator('[data-workspace-busy="false"]').waitFor();
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const nav = async (name) => {
    await page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
    await idle();
  };
  const launch = async () => {
    event("launch-request");
    app = await electron.launch({
      env,
      timeout: 60000,
      ...(packaged
        ? { executablePath: process.env.ORDO_PACKAGED_PATH, args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
    });
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => {
      if (d.type() !== "beforeunload")
        errors.push("Unexpected dialog " + d.type());
    });
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await idle();
    event("shell-ready", { pid: app.process().pid });
  };
  const close = async () => {
    await clean();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    event("normal-close", { pids });
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
    event("process-tree-exited");
  };
  const answer = async (response) =>
    app.evaluate(({ dialog }, response) => {
      globalThis.deletionDialogs = [];
      dialog.showMessageBox = async (_win, options) => {
        globalThis.deletionDialogs.push(options);
        return { response, checkboxChecked: false };
      };
    }, response);
  const dialogs = () => app.evaluate(() => globalThis.deletionDialogs);
  const deleteButton = (id) =>
    page.locator(`[data-delete-id="${id}"]`).filter({ visible: true });
  const capture = async (name) => {
    // Hidden Electron windows use the same native capture path as navigation
    // and composition acceptance. Keep the original 20-second capture bound.
    let timer;
    try {
      const bytes = await Promise.race([
        (async () => {
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          // Prime the hidden compositor, then capture its refreshed frame,
          // matching the retained M5 screenshot helper.
          await app.evaluate(async ({ BrowserWindow }) => {
            await BrowserWindow.getAllWindows()[0].webContents.capturePage(
              undefined,
              { stayHidden: true, stayAwake: true },
            );
          });
          await page.waitForTimeout(350);
          return app.evaluate(async ({ BrowserWindow }) => {
            const image =
              await BrowserWindow.getAllWindows()[0].webContents.capturePage(
                undefined,
                { stayHidden: true, stayAwake: true },
              );
            if (image.isEmpty()) throw Error("Empty desktop capture");
            return image.toPNG().toString("base64");
          });
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Desktop capture exceeded 20000ms")),
            20000,
          );
        }),
      ]);
      fs.writeFileSync(path.join(folder, name), Buffer.from(bytes, "base64"));
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await launch();
    report("normal-offline-startup");
    let state = await call("execute", {
        type: "create",
        name: "FICTIONAL PERMANENT REMOVAL",
        demo: true,
      }),
      op = state.operation;
    op.units.forEach((u) => (u.inTaskOrganization = true));
    op.metadata.statusId = "approved";
    state = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    op = state.operation;
    await call("execute", {
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "Fictional deletion fixture",
    });
    await call("execute", {
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    });
    const p = state.profiles[0];
    state = await call("execute", {
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: p.id, version: p.version },
      publicationId: null,
    });
    const pdf = (
      await call("documents", {
        type: "generate",
        operationId: op.id,
        exportId: state.exports[0].id,
        options: { paper: "A4", orientation: "portrait" },
      })
    ).record;
    const second = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL KEEP THIS OPERATION",
        demo: true,
      })
    ).operation;
    await openOperation(page, op.id);
    await nav("Dashboard");
    await openOperation(page, second.id);
    await navigateOperation(page, "Base order");
    await field("Situation").fill("UNSAVED OTHER OPERATION MUST SURVIVE");
    await page.waitForFunction(
      async (id) =>
        (
          await window.ordo.recovery({
            type: "get",
            key: { kind: "operation", id, scope: id },
          })
        ).draft !== null,
      second.id,
    );
    await idle();
    await nav("Operations");
    await field("Search operations").fill(op.name);
    await answer(0);
    await deleteButton(op.id).click();
    await idle();
    const prompt = (await dialogs())[0];
    assert.equal(prompt.defaultId, 0);
    assert.equal(prompt.cancelId, 0);
    assert.deepEqual(prompt.buttons, ["Cancel", "Delete permanently"]);
    assert(prompt.message.includes(op.name));
    assert(prompt.detail.includes("permanent and cannot be undone"));
    assert(prompt.detail.includes("Published orders: 1"));
    assert(prompt.detail.includes("Retained PDFs: 1"));
    assert.equal(
      (await call("execute", { type: "load", operationId: op.id })).publications
        .length,
      1,
    );
    report("cancel-default-and-explicit-complete-history-warning");
    assert.equal(
      await page
        .locator(`[data-open-operation-id="${op.id}"]`)
        .filter({ visible: true })
        .count(),
      1,
    );
    report("cancellation-keeps-operation-and-open-tab");
    await answer(1);
    await deleteButton(op.id).click();
    await idle();
    await page
      .locator(`[data-operation-id="${op.id}"]`)
      .waitFor({ state: "detached" });
    assert.equal(
      await page.locator(`[data-open-operation-id="${op.id}"]`).count(),
      0,
    );
    assert(
      !(await call("execute", { type: "load" })).operations.some(
        (o) => o.id === op.id,
      ),
    );
    assert.equal(
      (await call("documents", { type: "list", operationId: op.id })).records
        .length,
      0,
    );
    report("published-operation-and-retained-pdf-removed-with-tab");
    await page
      .locator(`[data-open-operation-id="${second.id}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
    assert.equal(
      await field("Situation").inputValue(),
      "UNSAVED OTHER OPERATION MUST SURVIVE",
    );
    report("unrelated-open-operation-unsaved-editor-preserved");
    await button("Save revision").click();
    await clean();
    await navigateOperation(page, "Export studio");
    state = await call("execute", { type: "load", operationId: second.id });
    for (const profile of state.profiles) {
      await field("Export profile").selectOption(profile.id);
      await deleteButton(profile.id).click();
      await idle();
    }
    assert.equal(
      (await call("execute", { type: "load", operationId: second.id })).profiles
        .length,
      0,
    );
    await button("New OPORD profile").click();
    await idle();
    assert.equal(await field("Export profile").locator("option").count(), 1);
    report("empty-export-profile-catalog-can-create-a-new-profile");
    await close();
    await launch();
    await openOperation(page, second.id);
    await navigateOperation(page, "Export studio");
    assert.equal(await field("Export profile").locator("option").count(), 1);
    assert(
      (await field("Export profile").locator("option").textContent()).includes(
        "OPORD",
      ),
    );
    report("remaining-opord-profile-reopens-with-a-valid-selection");
    await answer(1);
    await button("Generate export").click();
    await idle();
    state = await call("execute", { type: "load", operationId: second.id });
    await deleteButton(state.profiles[0].id).click();
    await idle();
    assert((await dialogs()).at(-1).message.includes("cannot be deleted"));
    assert.equal(
      (await call("execute", { type: "load", operationId: second.id })).profiles
        .length,
      1,
    );
    report("retained-export-protects-its-profile");
    let s = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL REMOVABLE SYMBOL",
      })
    ).symbol;
    s = (
      await call("symbols", {
        type: "publish",
        kind: "SYMBOL",
        id: s.versionId,
        expected: s.contentVersion,
      })
    ).symbol;
    const graphic = await call("exportGraphic", {
      source: {
        kind: "SAVED_SYMBOL",
        versionId: s.versionId,
        expectedContentVersion: s.contentVersion,
      },
      profile: {
        schemaVersion: 1,
        id: uid(),
        version: 1,
        name: "Fictional deletion SVG",
        product: "SYMBOL",
        format: "SVG",
        scale: 1,
        background: "TRANSPARENT",
        size: 30,
        foldPolicy: "AS_SHOWN",
        ancestorPolicy: "BOUNDARY",
        selectedUnitIds: null,
        renderProfile: { id: "ordo-symbol", version: 1 },
      },
    });
    report("symbol-owned-graphic-retained-before-deletion");
    await nav("Military Symbols");
    await page.locator(`[data-symbol-id="${s.versionId}"]`).click();
    await page
      .getByText("Version family and maintenance", { exact: true })
      .click();
    await answer(0);
    await deleteButton(s.versionId).click();
    await idle();
    assert.equal(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: s.versionId }))
        .symbol.status,
      "PUBLISHED",
    );
    report("published-symbol-deletion-cancellation");
    await answer(1);
    await deleteButton(s.versionId).click();
    await idle();
    await page
      .locator(`[data-symbol-id="${s.versionId}"]`)
      .waitFor({ state: "detached" });
    report("published-symbol-version-removed-from-gallery");
    assert(!(await call("graphicExports")).some((g) => g.id === graphic.id));
    report("owned-symbol-graphics-removed-with-version");
    const legacy = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL LEGACY DELETE",
      })
    ).symbol;
    await answer(0);
    await call("symbols", {
      type: "delete-draft",
      kind: "SYMBOL",
      id: legacy.versionId,
    });
    assert((await dialogs())[0].detail.includes("permanent"));
    assert(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: legacy.versionId,
        })
      ).symbol,
    );
    await answer(1);
    await call("deleteItem", { kind: "symbol", id: legacy.versionId });
    report("legacy-delete-draft-ipc-also-requires-native-confirmation");
    const orb = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "FICTIONAL REMOVABLE ORBAT",
      })
    ).orbat;
    await nav("ORBATs");
    await page.locator(`[data-orbat-id="${orb.versionId}"]`).click();
    await page
      .getByText("Version family and maintenance", { exact: true })
      .filter({ visible: true })
      .click();
    await deleteButton(orb.versionId).click();
    await idle();
    await page
      .locator(`[data-orbat-id="${orb.versionId}"]`)
      .waitFor({ state: "detached" });
    report("orbat-version-removed-from-catalog");
    const unit = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "FICTIONAL REMOVABLE PROFILE",
      })
    ).profile;
    await nav("Organizations");
    await page
      .locator(`[data-unit-profile-version="${unit.unitProfileVersionId}"]`)
      .click();
    await button("Versions").click();
    await deleteButton(unit.unitProfileVersionId).click();
    await idle();
    await page
      .locator(`[data-unit-profile-version="${unit.unitProfileVersionId}"]`)
      .waitFor({ state: "detached" });
    report("organization-profile-version-removed-from-catalog");
    state = await call("execute", { type: "load" });
    const bundled = state.doctrines[0];
    state = await call("execute", {
      type: "doctrine-create",
      sourceId: bundled.doctrineVersionId,
      name: "FICTIONAL REMOVABLE DOCTRINE",
      versionLabel: "1.0.0",
      newFamily: true,
    });
    const doctrine = state.doctrines.find(
      (d) => d.displayName === "FICTIONAL REMOVABLE DOCTRINE",
    );
    await nav("Doctrines");
    await field("Doctrine version").selectOption(doctrine.doctrineVersionId);
    await deleteButton(doctrine.doctrineVersionId).click();
    await idle();
    assert(
      !(await call("execute", { type: "load" })).doctrines.some(
        (d) => d.doctrineVersionId === doctrine.doctrineVersionId,
      ),
    );
    await field("Doctrine version").selectOption(bundled.doctrineVersionId);
    assert(await deleteButton(bundled.doctrineVersionId).isDisabled());
    report("custom-doctrine-deletion-and-bundled-protection");
    const backup = path.join(folder, "before-delete.db");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, backup);
    await call("backup");
    const backupBytes = fs.readFileSync(backup);
    report("pre-deletion-backup-retained-outside-workspace");
    await nav("Operations");
    await field("Search operations").fill(second.name);
    await deleteButton(second.id).click();
    await idle();
    await clean();
    assert.equal(
      (await call("execute", { type: "load" })).operations.length,
      0,
    );
    report("last-operation-deletion-leaves-usable-empty-catalog");
    await page.getByText("0 operations", { exact: true }).waitFor();
    assert.equal(
      await page.locator('[data-delete-kind="operation"]').count(),
      0,
    );
    await capture("empty-catalog.png");
    await close();
    await launch();
    assert.equal(
      (await call("execute", { type: "load" })).operations.length,
      0,
    );
    report("normal-clean-exit-and-reopen-preserve-deletion");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backup);
    await nav("Settings");
    await button("Restore backup").click();
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await clean();
    assert.equal(
      (await call("execute", { type: "load", operationId: second.id }))
        .operation.id,
      second.id,
    );
    assert(fs.readFileSync(backup).equals(backupBytes));
    report("explicit-restore-recovers-pre-deletion-workspace");
    await close();
    assert.deepEqual(errors, []);
    report("restored-workspace-normal-exit");
    write();
    console.log("Deletion acceptance: " + folder);
  } catch (e) {
    write(e);
    console.error(e);
    if (page)
      try {
        await capture("failure.png");
        fs.writeFileSync(
          path.join(folder, "failure.html"),
          await page.content(),
        );
      } catch {}
    if (app)
      try {
        await app.evaluate(({ dialog }) => {
          dialog.showMessageBoxSync = () => 1;
        });
        await app.close();
      } catch {}
    process.exitCode = 1;
  }
})();
