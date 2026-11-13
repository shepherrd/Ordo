// Fictional isolated workspace; normal lifecycle and real persistence/restore.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
(async () => {
  const packaged = process.argv.includes("--packaged"),
    version = require("../package.json").version;
  const folder = path.resolve(".test-data", `workspace-safety-${randomUUID()}`);
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const checks = [],
    errors = [],
    events = [];
  let app, page;
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
    console.log(`PASS ${step}`);
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
  const button = (name) => page.getByRole("button", { name, exact: true });
  const field = (name) => page.getByLabel(name, { exact: true });
  const idle = () => page.locator('[data-workspace-busy="false"]').waitFor();
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
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
    const proc = app.process();
    proc.once("exit", (code, signal) =>
      event("process-exit", { pid: proc.pid, code, signal }),
    );
    event("electron-ready", {
      pid: proc.pid,
      ready: await app.evaluate(({ app }) => app.isReady()),
    });
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
    if (packaged)
      assert.equal(await app.evaluate(({ app }) => app.getVersion()), version);
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    // Electron's will-prevent-unload owns the native close decision. Register
    // the event so Playwright does not race it with automatic CDP dismissal.
    page.on("dialog", (dialog) => {
      event("renderer-dialog", { type: dialog.type() });
      if (dialog.type() !== "beforeunload")
        errors.push(`Unexpected dialog: ${dialog.type()}`);
    });
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await clean();
    event("shell-ready");
  };
  const close = async (discard = false) => {
    if (!discard) await clean();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    event("close-request", { pid: proc.pid, discard });
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
      assert(!alive, `Previous process ${pid} remains alive`);
    }
    app = null;
    event("process-tree-exited", { pids });
  };
  const openDialog = async (file) =>
    app.evaluate(({ dialog }, file) => {
      globalThis.restoreDialogs = 0;
      dialog.showOpenDialog = async () => {
        globalThis.restoreDialogs++;
        return file
          ? { canceled: false, filePaths: [file] }
          : { canceled: true, filePaths: [] };
      };
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, file);
  const restoreBlocked = async (pattern) => {
    await nav("Settings");
    await openDialog(null);
    await button("Restore backup").click();
    await page.getByRole("alert").filter({ hasText: pattern }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.restoreDialogs), 0);
  };
  try {
    await launch();
    report("normal-offline-startup");
    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL SAFE SYMBOL",
      })
    ).symbol;
    const orbat = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "FICTIONAL SAFE ORBAT",
      })
    ).orbat;
    const profile = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "FICTIONAL SAFE PROFILE",
      })
    ).profile;
    const backup = path.join(folder, "saved-workspace.db");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, backup);
    assert.equal(await call("backup"), backup);

    await nav("Military Symbols");
    await page.locator(`[data-symbol-id="${symbol.versionId}"]`).click();
    await field("Saved Symbol name").fill("UNSAVED SYMBOL");
    await nav("ORBATs");
    await page.locator(`[data-orbat-id="${orbat.versionId}"]`).click();
    await field("Saved ORBAT name").fill("UNSAVED ORBAT");
    await restoreBlocked(/Military Symbols.*ORBATs/);
    report("hidden-symbol-and-orbat-edits-block-restore");
    await nav("Military Symbols");
    await button("Discard symbol edits").click();
    await nav("ORBATs");
    await button("Discard ORBAT edits").click();
    await clean();

    await nav("Organizations");
    await button("New Unit Profile").click();
    await field("Organization designation").fill("FICTIONAL DELAYED PROFILE");
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("ordo:workspace");
      globalThis.workspaceHandler = original;
      ipcMain.removeHandler("ordo:workspace");
      ipcMain.handle("ordo:workspace", async (event, command) => {
        const result = await original(event, command);
        if (command.type === "browse-unit-profiles")
          await new Promise((resolve) => {
            globalThis.releaseProfileList = resolve;
          });
        return result;
      });
    });
    await button("Create Unit Profile").click();
    await field("Short Designation").waitFor();
    assert(await field("Short Designation").isDisabled());
    const fillProfile = field("Short Designation").fill("ACK PROFILE");
    await app.evaluate(async ({ ipcMain }) => {
      for (let i = 0; !globalThis.releaseProfileList && i < 100; i++)
        await new Promise((r) => setTimeout(r, 20));
      globalThis.releaseProfileList();
      ipcMain.removeHandler("ordo:workspace");
      ipcMain.handle("ordo:workspace", globalThis.workspaceHandler);
    });
    await fillProfile;
    assert.equal(await field("Short Designation").inputValue(), "ACK PROFILE");
    await button("Save profile").click();
    await clean();
    const loadedProfile = (
      await call("workspace", {
        type: "browse-unit-profiles",
        query: {
          search: "FICTIONAL DELAYED PROFILE",
          status: "",
          echelon: "",
          sort: "updated",
          offset: 0,
          limit: 20,
        },
      })
    ).organizations.items[0];
    assert.equal(
      (
        await call("workspace", {
          type: "unit-profile-get",
          id: loadedProfile.unitProfileVersionId,
        })
      ).profile.identity.shortDesignation,
      "ACK PROFILE",
    );
    await page
      .locator(`[data-unit-profile-version="${profile.unitProfileVersionId}"]`)
      .click();
    await field("Full Designation").fill("UNSAVED ORGANIZATION");
    await restoreBlocked(/Organizations/);
    await nav("Organizations");
    await button("Discard profile edits").click();
    await clean();
    report("hidden-unit-profile-edits-block-restore");

    await nav("Doctrines");
    await button("Duplicate doctrine").click();
    await idle();
    await field("Doctrine display name").fill("UNSAVED DOCTRINE");
    await restoreBlocked(/Doctrine Builder/);
    await nav("Doctrines");
    await button("Discard doctrine edits").click();
    await clean();
    report("hidden-doctrine-edits-block-restore");

    await nav("Settings");
    const actor = await field("Local actor label").inputValue();
    await field("Local actor label").fill("UNSAVED PREFERENCE");
    const opened = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL OPEN TAB",
        demo: false,
      })
    ).operation;
    await nav("Operations");
    await page.locator(`[data-operation-id="${opened.id}"]`).click();
    await page
      .getByRole("heading", { name: "Operation overview", exact: true })
      .waitFor();
    await idle();
    await nav("Settings");
    assert.equal(
      await field("Local actor label").inputValue(),
      "UNSAVED PREFERENCE",
    );
    await restoreBlocked(/Local preferences/);
    await button("Discard preference changes").click();
    assert.equal(await field("Local actor label").inputValue(), actor);
    await field("Local actor label").fill("FICTIONAL SAVED ACTOR");
    await button("Save preferences").click();
    await clean();
    const savedPreferences = (await call("workspace", { type: "preferences" }))
      .preferences;
    assert.equal(savedPreferences.localActor, "FICTIONAL SAVED ACTOR");
    assert.equal(savedPreferences.lastOpenedOperationId, opened.id);
    assert.equal(await page.locator("[data-operation-editor]").count(), 1);
    report("preferences-survive-navigation-and-block-restore");

    const openTab = () =>
      page.locator(`[data-open-operation-id="${opened.id}"]:visible`);
    await openTab().locator(".open-operation-name").click();
    await field("Operation name").fill("FICTIONAL REVIEW SAFETY");
    await button("Save revision").click();
    await clean();
    await button("History / Changes").click();
    await idle();
    await button("Current saved vs previous").click();
    await field("Review title").fill("FICTIONAL NOTE PROTECTION");
    await button("Create Change Review").click();
    await clean();
    const card = page.locator(".review-change:visible").first();
    const changeComment = () =>
      card.locator('textarea[aria-label^="Comment for"]');
    const decisionNote = () =>
      card.locator('input[aria-label^="Decision note for"]');
    await field("Review-level note").fill("UNSUBMITTED REVIEW NOTE");
    await changeComment().fill("UNSUBMITTED CHANGE COMMENT");
    await decisionNote().fill("UNSUBMITTED DECISION NOTE");
    await card
      .locator('select[aria-label^="Disposition for"]')
      .selectOption("ACCEPTED");
    await field("Search changes").fill("no matching changes at all");
    assert.equal(await page.locator(".review-change:visible").count(), 0);
    await restoreBlocked(/Change review notes and details/);
    await openTab().locator(".close-operation").click();
    const closeReview = page.getByRole("dialog", { name: /^Close / });
    await closeReview
      .getByRole("button", { name: "Save and close", exact: true })
      .click();
    await closeReview
      .getByRole("alert")
      .filter({ hasText: "Change review notes and details" })
      .waitFor();
    await closeReview
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await openTab().locator(".open-operation-name").click();
    await button("History / Changes").click();
    await idle();
    await field("Search changes").fill("");
    assert.equal(
      await changeComment().inputValue(),
      "UNSUBMITTED CHANGE COMMENT",
    );
    assert.equal(
      await decisionNote().inputValue(),
      "UNSUBMITTED DECISION NOTE",
    );
    assert.equal(
      await field("Review-level note").inputValue(),
      "UNSUBMITTED REVIEW NOTE",
    );
    await app.evaluate(({ ipcMain }) => {
      globalThis.reviewHandler = ipcMain._invokeHandlers.get("ordo:reviews");
      ipcMain.removeHandler("ordo:reviews");
      ipcMain.handle("ordo:reviews", (event, command) => {
        if (command.type === "review-actions")
          throw Error("Intentional review save failure");
        return globalThis.reviewHandler(event, command);
      });
    });
    await card
      .getByRole("button", { name: "Add change comment", exact: true })
      .click();
    await page
      .locator(".review-workspace [role=alert]")
      .filter({ hasText: "Intentional review save failure" })
      .waitFor();
    assert.equal(
      await changeComment().inputValue(),
      "UNSUBMITTED CHANGE COMMENT",
    );
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("ordo:reviews");
      ipcMain.handle("ordo:reviews", globalThis.reviewHandler);
    });
    await card
      .getByRole("button", { name: "Add change comment", exact: true })
      .click();
    await idle();
    assert.equal(await changeComment().inputValue(), "");
    assert.equal(
      await decisionNote().inputValue(),
      "UNSUBMITTED DECISION NOTE",
    );
    await card
      .getByRole("button", { name: "Record decision", exact: true })
      .click();
    await idle();
    assert.equal(await decisionNote().inputValue(), "");
    await button("Add review note").click();
    await clean();
    const reviewHistory = (
      await call("reviews", { type: "history", operationId: opened.id })
    ).reviews[0];
    assert(
      reviewHistory.events.some(
        (e) =>
          e.action.type === "COMMENT" &&
          e.action.text === "UNSUBMITTED CHANGE COMMENT",
      ),
    );
    assert(
      reviewHistory.events.some(
        (e) =>
          e.action.type === "DECISION" &&
          e.action.note === "UNSUBMITTED DECISION NOTE",
      ),
    );
    await button("Edit review details").click();
    await field("Review title").fill("DISCARDED REVIEW TITLE");
    await button("Discard unsubmitted review edits").click();
    await clean();
    assert.equal(
      await field("Review title").inputValue(),
      "FICTIONAL NOTE PROTECTION",
    );
    report("review-drafts-survive-filtering-failure-and-guard-close-restore");

    await nav("Military Symbols");
    await field("Saved Symbol name").fill("RETAIN ON SAVE FAILURE");
    await call("symbols", {
      type: "save-symbol",
      value: { ...symbol, name: "CONCURRENT SAVED VALUE" },
      expected: symbol.contentVersion,
    });
    await button("Save symbol draft").click();
    await page.locator(".symbol-library [role=alert]").waitFor();
    await idle();
    assert.equal(
      await field("Saved Symbol name").inputValue(),
      "RETAIN ON SAVE FAILURE",
    );
    assert.equal(
      await page
        .locator("[data-workspace-dirty]")
        .getAttribute("data-workspace-dirty"),
      "true",
    );
    assert.equal(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: symbol.versionId,
        })
      ).symbol.name,
      "CONCURRENT SAVED VALUE",
    );
    report("failed-save-retains-working-draft");

    await app.evaluate(({ dialog, BrowserWindow }) => {
      globalThis.closeDecisions = [];
      dialog.showMessageBoxSync = (_win, options) => {
        globalThis.closeDecisions.push(options);
        return 0;
      };
      BrowserWindow.getAllWindows()[0].close();
    });
    await app.evaluate(async () => {
      for (let i = 0; !globalThis.closeDecisions.length && i < 100; i++)
        await new Promise((r) => setTimeout(r, 20));
    });
    assert.equal(
      (await app.evaluate(() => globalThis.closeDecisions[0])).buttons[0],
      "Keep editing",
    );
    assert.equal(
      await field("Saved Symbol name").inputValue(),
      "RETAIN ON SAVE FAILURE",
    );
    report("normal-close-cancel-preserves-edits");
    await button("Discard symbol edits").click();
    await page.locator(`[data-symbol-id="${symbol.versionId}"]`).click();
    await idle();

    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("ordo:symbols");
      globalThis.symbolHandler = original;
      ipcMain.removeHandler("ordo:symbols");
      ipcMain.handle("ordo:symbols", async (event, command) => {
        const result = await original(event, command);
        if (command.type === "save-symbol")
          await new Promise((resolve) => {
            globalThis.releaseSaveResponse = resolve;
          });
        return result;
      });
    });
    await field("Saved Symbol name").fill("ACKNOWLEDGED SAVE");
    await button("Save symbol draft").click();
    await page
      .locator('[data-workspace-busy="true"][data-workspace-dirty="true"]')
      .waitFor();
    assert(
      await field("Saved Symbol name").evaluate(
        (el) => !!el.closest("[inert]"),
      ),
    );
    assert.equal(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: symbol.versionId,
        })
      ).symbol.name,
      "ACKNOWLEDGED SAVE",
    );
    await app.evaluate(({ ipcMain }) => {
      globalThis.releaseSaveResponse();
      ipcMain.removeHandler("ordo:symbols");
      ipcMain.handle("ordo:symbols", globalThis.symbolHandler);
    });
    await clean();
    assert.equal(
      await field("Saved Symbol name").inputValue(),
      "ACKNOWLEDGED SAVE",
    );
    report("save-response-acknowledgement-and-edit-lock");

    await nav("Settings");
    await openDialog(null);
    await button("Restore backup").click();
    await idle();
    assert.equal(await page.locator("[data-operation-editor]").count(), 1);
    assert.equal(
      await field("Saved Symbol name").inputValue(),
      "ACKNOWLEDGED SAVE",
    );
    report("restore-cancellation-keeps-editor-session");
    const invalid = path.join(folder, "invalid.db");
    fs.writeFileSync(invalid, "not a database");
    await openDialog(invalid);
    await button("Restore backup").click();
    await page.getByRole("alert").waitFor();
    await idle();
    assert.equal(
      await field("Saved Symbol name").inputValue(),
      "ACKNOWLEDGED SAVE",
    );
    assert.equal(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: symbol.versionId,
        })
      ).symbol.name,
      "ACKNOWLEDGED SAVE",
    );
    report("restore-failure-keeps-data-and-editor-session");

    await app.evaluate(({ dialog }) => {
      globalThis.closeDecisions = [];
      dialog.showMessageBoxSync = (_win, options) => {
        globalThis.closeDecisions.push(options);
        return 0;
      };
      dialog.showOpenDialog = () =>
        new Promise((resolve) => {
          globalThis.cancelRestore = () =>
            resolve({ canceled: true, filePaths: [] });
        });
    });
    await button("Restore backup").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Restoring workspace…" })
      .waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].close();
    });
    await app.evaluate(async () => {
      for (let i = 0; !globalThis.closeDecisions.length && i < 100; i++)
        await new Promise((r) => setTimeout(r, 20));
    });
    assert.deepEqual(
      (await app.evaluate(() => globalThis.closeDecisions[0])).buttons,
      ["Keep editing"],
    );
    await app.evaluate(() => globalThis.cancelRestore());
    await clean();
    report("workspace-restore-cannot-be-discarded-mid-flight");

    await openDialog(backup);
    await button("Restore backup").click();
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await clean();
    assert.equal(await field("Saved Symbol name").count(), 0);
    assert.equal(await field("Saved ORBAT name").count(), 0);
    assert.equal(await field("Doctrine display name").count(), 0);
    assert.equal(await field("Full Designation").count(), 0);
    assert.equal(await page.locator("[data-operation-editor]").count(), 0);
    await nav("Military Symbols");
    await page.locator(`[data-symbol-id="${symbol.versionId}"]`).click();
    await clean();
    assert.equal(await field("Saved Symbol name").inputValue(), symbol.name);
    assert(await button("Undo symbol edit").isDisabled());
    report("successful-restore-remounts-all-editors-and-clears-undo");

    await field("Saved Symbol name").fill("DELIBERATELY DISCARDED");
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    });
    await close(true);
    await launch();
    assert.equal(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: symbol.versionId,
        })
      ).symbol.name,
      symbol.name,
    );
    report("intentional-close-discard-does-not-persist-edits");
    await close();
    await launch();
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
    await close();
    assert.deepEqual(errors, []);
    report("normal-clean-exit-process-termination-and-reopen");
    console.log(folder);
  } catch (error) {
    write(error);
    if (page && !page.isClosed())
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
    // Failed-run cleanup only: never counts as a normal or successful close.
    if (app) {
      await app
        .evaluate(({ dialog }) => {
          globalThis.releaseSaveResponse?.();
          globalThis.releaseProfileList?.();
          globalThis.cancelRestore?.();
          dialog.showMessageBoxSync = () => 1;
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    throw error;
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
