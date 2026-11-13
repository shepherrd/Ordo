const {
  currentState,
  openOperation,
  createDemo,
  navigateOperation,
} = require("./smoke-global.cjs");
const { _electron: electron } = require("playwright");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
(async () => {
  const folder = resolve(".test-data", `smoke-${randomUUID()}`);
  mkdirSync(folder, { recursive: true });
  const packaged = process.argv.includes("--packaged");
  // Exported files live beside, not inside, the protected workspace directory.
  const dataDirectory = join(folder, "workspace");
  const env = {
    ...process.env,
    ORDO_DATA_DIR: dataDirectory,
    ORDO_HEADLESS: "1",
  };
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
    const base64 = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      )
        .toPNG()
        .toString("base64"),
    );
    writeFileSync(join(folder, name), Buffer.from(base64, "base64"));
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const nav = (name) => navigateOperation(page, name);
  const notice = async (text) =>
    page.getByRole("status").filter({ hasText: text }).waitFor();
  const state = () => currentState(page); // Read-only verification through real IPC.
  const save = async () => {
    await button("Save revision").click();
    await notice("Planning revision saved");
  };
  const generate = async () => {
    await button("Generate export").click();
    await notice("Export generated");
  };
  const preview = async (contains, excludes = []) => {
    await page.locator("iframe").waitFor();
    for (const text of contains)
      await page.waitForFunction(
        (text) => document.querySelector("iframe")?.srcdoc.includes(text),
        text,
      );
    const html = await page.locator("iframe").getAttribute("srcdoc");
    for (const text of excludes)
      assert(!html.includes(text), `Preview must exclude ${text}`);
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "");
    return html;
  };
  const fullPreview = async () => {
    await nav("Base order");
    await button("Full OPORD preview").click();
  };
  const saveDialog = async (filePath) =>
    app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, filePath);
  try {
    await launch();
    await createDemo(page, "DEMO OPERATION", false);
    await page
      .getByRole("heading", { name: "DEMO OPERATION", exact: true })
      .first()
      .waitFor();
    await capture("00-overview.png");
    await nav("Signal data");
    await page
      .getByLabel("Channel / frequency 1", { exact: true })
      .fill("DEMO REVIEW CHANNEL");
    await save();
    assert.equal((await state()).operation.revision, 2);
    await page
      .getByLabel("Channel / frequency 1", { exact: true })
      .scrollIntoViewIfNeeded();
    await capture("01-authoritative-signal.png");
    report(1, "Source Signal channel edited and saved as revision 2");

    const signal = (await state()).operation.signal;
    const detail = [
      signal.architecture,
      signal.spectrumNotes,
      signal.maintenanceNotes,
    ];
    assert(detail.every(Boolean));
    await fullPreview();
    await preview(["DEMO REVIEW CHANNEL", ...detail]);
    await capture("02-full-opord.png");
    await page
      .frameLocator("iframe")
      .getByRole("heading", { name: "Network architecture", exact: true })
      .scrollIntoViewIfNeeded();
    await capture("02-signal-details.png");
    report(
      2,
      "Full OPORD includes the shared channel and detailed Signal notes",
    );

    await nav("Export studio");
    await preview(["DEMO REVIEW CHANNEL"], detail);
    await capture("03-live-card.png");
    report(
      3,
      "Read-only Communications Card includes the shared channel and excludes detailed notes",
    );

    await page
      .getByRole("checkbox", { name: "Channel", exact: true })
      .uncheck();
    await page.waitForFunction(
      () =>
        !document
          .querySelector("iframe")
          .srcdoc.includes("DEMO REVIEW CHANNEL"),
    );
    await generate();
    const excluded = (await state()).exports[0];
    assert.equal(excluded.profile.version, 2);
    assert(!excluded.profile.inclusion.netFields.includes("channel"));
    assert(!excluded.html.includes("DEMO REVIEW CHANNEL"));
    const excludedHtml = join(folder, "card-excluded-channel.html");
    await saveDialog(excludedHtml);
    await page
      .getByRole("button", { name: "Save HTML", exact: true })
      .first()
      .click();
    await notice("Saved");
    assert.equal(readFileSync(excludedHtml, "utf8"), excluded.html);
    await page.locator(".export-toolbar").scrollIntoViewIfNeeded();
    await capture("04-channel-excluded.png");
    report(
      4,
      "Channel excluded in preview, profile v2, frozen export, and saved HTML",
    );

    await page.getByRole("checkbox", { name: "Channel", exact: true }).check();
    await page
      .getByRole("group", { name: "Audience", exact: true })
      .getByRole("checkbox", { name: "DEMO UNIT A", exact: true })
      .check();
    await page
      .getByRole("group", { name: "Phases", exact: true })
      .getByRole("checkbox", { name: "DEMO PHASE I", exact: true })
      .check();
    await generate();
    const scoped = (await state()).exports[0];
    assert.equal(scoped.profile.version, 3);
    const current = (await state()).operation;
    assert.deepEqual(scoped.profile.inclusion.audienceUnitIds, [
      current.units[0].id,
    ]);
    assert.deepEqual(scoped.profile.inclusion.phaseIds, [current.phases[0].id]);
    assert(scoped.html.includes("DEMO CMD NET 1"));
    assert(!scoped.html.includes("DEMO SUPPORT NET"));
    for (const key of [
      "projectionVersion",
      "rendererVersion",
      "renderTemplateId",
      "renderTemplateVersion",
      "generatedAt",
      "actor",
      "sourceRevision",
    ])
      assert(scoped[key], key);
    assert.deepEqual(scoped.config.doctrine.id, current.doctrineRef.id);
    assert.equal(scoped.config.doctrine.version, current.doctrineRef.version);
    await capture("05-scoped-card.png");
    report(
      5,
      "UNIT A / PHASE I filtering and exact profile/config/projection/renderer/template provenance verified",
    );

    await nav("Validation");
    await page
      .getByText(/DEMO UNIT B.*absent from task organization/)
      .waitFor();
    await capture("06-validation-before.png");
    await nav("Task organization");
    await page
      .getByRole("checkbox", {
        name: "Included in task organization",
        exact: true,
      })
      .nth(1)
      .check();
    await save();
    await nav("Validation");
    await page
      .getByText("✓ No findings from the configured rules.", { exact: true })
      .waitFor();
    report(
      6,
      "Explainable UNIT B finding resolved by editing authoritative Task Organization",
    );

    await nav("Overview");
    await page
      .getByLabel("Workflow status", { exact: true })
      .selectOption("approved");
    await save();
    await nav("Publications");
    assert(await button("Publish OPORD snapshot").isDisabled());
    await page
      .getByLabel("Revision approval note")
      .fill("Fictional acceptance demonstration");
    await page.getByRole("button", { name: /^Approve Revision / }).click();
    await notice("explicitly approved");
    const approved = await state(),
      approval = approved.approvals[0];
    assert.equal(approval.sourceRevision, approved.operation.revision);
    assert.equal(approval.origin, "explicit-approval");
    assert.equal(approval.note, "Fictional acceptance demonstration");
    await capture("07-explicit-approval.png");
    report(
      7,
      "Explicit local approval bound to the exact revision with actor, timestamp, scope, and note",
    );

    await button("Publish OPORD snapshot").click();
    await notice("Immutable OPORD baseline published");
    const published = (await state()).publications[0];
    assert.equal(published.approvalId, approval.id);
    assert.equal(published.sourceRevision, approval.sourceRevision);
    assert.equal(published.version, 1);
    assert(published.publishedAt);
    assert.deepEqual(published.config, approved.config);
    await capture("08-publication.png");
    report(
      8,
      "Publication freezes source revision, configuration, exact approval, timestamp, and content",
    );

    await nav("Signal data");
    await page
      .getByLabel("Channel / frequency 1", { exact: true })
      .fill("DEMO AFTER PUBLICATION");
    await save();
    await fullPreview();
    await preview(
      ["DEMO AFTER PUBLICATION", ...detail],
      ["DEMO REVIEW CHANNEL"],
    );
    await nav("Export studio");
    await preview(["DEMO AFTER PUBLICATION"], detail);
    const updated = await state();
    assert.equal(updated.operation.metadata.statusId, "draft");
    assert(
      !updated.approvals.some(
        (a) => a.sourceRevision === updated.operation.revision,
      ),
    );
    assert.deepEqual(updated.approvals, [approval]);
    assert.deepEqual(updated.publications, [published]);
    assert.equal(
      updated.exports.find((e) => e.id === scoped.id).staleness.outdated,
      true,
    );
    assert.equal(
      updated.exports.find((e) => e.id === excluded.id).staleness.outdated,
      false,
    );
    await capture("09-selective-staleness.png");
    await nav("Publications");
    assert(await button("Publish OPORD snapshot").isDisabled());
    await button("View snapshot").click();
    await preview(["DEMO REVIEW CHANNEL"], ["DEMO AFTER PUBLICATION"]);
    await capture("09-frozen-publication.png");
    report(
      9,
      "New draft has no inherited approval; both live products update; publication/approval stay frozen; only included Channel artifact is outdated",
    );

    const backupPath = join(folder, "acceptance-backup.db"),
      beforeBackup = await state();
    await nav("Configuration");
    await saveDialog(backupPath);
    await button("Back up workspace").click();
    await notice("Backup saved");
    await nav("Overview");
    await page
      .getByLabel("Operation name", { exact: true })
      .fill("DEMO AFTER BACKUP");
    await save();
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, backupPath);
    await nav("Configuration");
    await button("Restore backup").click();
    await notice("Workspace restored");
    assert.deepEqual(await state(), beforeBackup);
    await capture("10-restored-workspace.png");
    await app.close();
    app = null;
    await launch();
    await openOperation(page);
    await page
      .getByRole("heading", { name: "DEMO OPERATION", exact: true })
      .first()
      .waitFor();
    assert.deepEqual(await state(), beforeBackup);
    report(
      10,
      "Backup/restore returns planning, publication/export/approval histories and exact state persists after reopening",
    );

    await nav("Timeline");
    assert(
      (await page.locator(".resolved-time").allTextContents()).some((t) =>
        t.includes("14:00"),
      ),
    );
    await page
      .getByLabel("Absolute time (UTC)", { exact: true })
      .fill("2026-10-01T18:00");
    await save();
    const times = await page.locator(".resolved-time").allTextContents();
    assert(times.some((t) => t.includes("18:00")));
    assert(times.some((t) => t.includes("19:00")));
    await capture("11-canonical-timeline.png");
    await fullPreview();
    await preview(["2026-10-01T18:00:00.000Z", "2026-10-01T19:00:00.000Z"]);
    await nav("Publications");
    await button("View snapshot").click();
    await preview(
      ["2026-10-01T14:00:00.000Z", "2026-10-01T15:00:00.000Z"],
      ["2026-10-01T18:00:00.000Z"],
    );
    report(
      "canonical-event",
      "Changing H-HOUR once updates Timeline, relative event, and live OPORD; published time remains frozen",
    );

    await nav("Export studio");
    await generate();
    const membershipArtifact = (await state()).exports[0];
    assert.equal(membershipArtifact.staleness.outdated, false);
    await nav("Signal data");
    await button("+ Add net").click();
    await page
      .getByLabel("Net name 3", { exact: true })
      .fill("DEMO NEW MATCHING NET");
    await page
      .getByLabel("Channel / frequency 3", { exact: true })
      .fill("DEMO NEW CHANNEL");
    const net = page
      .locator(".entity")
      .filter({ has: page.getByLabel("Net name 3", { exact: true }) });
    await net
      .getByRole("group", { name: "Participants", exact: true })
      .getByRole("checkbox", { name: "DEMO UNIT A", exact: true })
      .check();
    await net
      .getByRole("group", { name: "Applicable phases", exact: true })
      .getByRole("checkbox", { name: "DEMO PHASE I", exact: true })
      .check();
    await save();
    await nav("Export studio");
    await preview(["DEMO NEW MATCHING NET"]);
    const membership = (await state()).exports.find(
      (e) => e.id === membershipArtifact.id,
    );
    assert(membership.staleness.changedPaths.includes("selection/radio-nets"));
    await capture("12-membership-change.png");
    report(
      "dynamic-membership",
      "Previously current UNIT A / PHASE I artifact becomes outdated when a newly matching net is added",
    );

    const security = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert.equal(security.contextIsolation, true);
    assert.equal(security.nodeIntegration, false);
    assert.equal(security.sandbox, true);
    assert.equal(security.webSecurity, true);
    assert.deepEqual(
      await page.evaluate(() => Object.keys(window.ordo).sort()),
      [
        "backup",
        "cancelGraphic",
        "cancelLibraryImport",
        "commitLibraryImport",
        "copySidc",
        "deleteItem",
        "documents",
        "execute",
        "exportGraphic",
        "files",
        "graphicExports",
        "graphicStaleness",
        "libraryImportReceipt",
        "previewLibraryImport",
        "recovery",
        "renderGraphic",
        "restore",
        "reviews",
        "saveGraphic",
        "saveHtml",
        "saveReviewReport",
        "symbolCatalog",
        "symbols",
        "workspace",
        "workspaceInfo",
      ],
    );
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    assert(
      (
        await page
          .locator('meta[http-equiv="Content-Security-Policy"]')
          .getAttribute("content")
      ).includes("default-src 'self'"),
    );
    await assert.rejects(
      page.evaluate(() =>
        window.ordo.execute({ type: "load", unexpected: "reject" }),
      ),
    );
    const windowsBefore = app.windows().length;
    await page.evaluate(() => window.open("https://example.com"));
    assert.equal(app.windows().length, windowsBefore);
    assert.deepEqual(failures, []);
    report(
      "desktop-security",
      "Real offline Electron/SQLite; sandbox, context isolation, Node isolation, narrow bridge, CSP, IPC validation, and window blocking verified",
    );
    writeFileSync(
      join(folder, "final-state.json"),
      JSON.stringify(await state(), null, 2),
    );
    const result = {
      success: true,
      packaged,
      runtimeInfo,
      dataDirectory,
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
      if (succeeded) await app.close();
      else {
        try {
          await app.evaluate(({ dialog }) => {
            dialog.showMessageBoxSync = () => 1;
          });
          await app.close();
        } catch {
          app.process().kill();
        }
      }
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
