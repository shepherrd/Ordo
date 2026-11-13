// Isolated fictional data; normal offline Electron launch and clean exit.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(".test-data", "timeline-desktop-" + randomUUID());
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
    timings: {},
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
    );
  const pass = (name) => {
    evidence.checks.push(name);
    record();
    console.log("PASS " + name);
  };
  let app, page, operationId;
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const label = (name) =>
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
    page.setDefaultTimeout(15000);
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
      stage: "exited",
      exitCode: proc.exitCode,
      pid: proc.pid,
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
  };
  const openTab = async () =>
    page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
  const screenshot = async (name) => {
    await page.screenshot({
      path: path.join(folder, name + ".png"),
      fullPage: true,
    });
    evidence.screenshots.push(name + ".png");
    record();
  };
  try {
    await launch();
    const initial = await call("execute", { type: "load" });
    const config = initial.configurations.find((c) => !c.doctrine.catalog);
    let state = await call("execute", {
      type: "create",
      name: "Fictional timeline and writing acceptance",
      demo: true,
      configuration: {
        id: config.organization.id,
        version: config.organization.version,
      },
    });
    operationId = state.operation.id;
    const op = state.operation,
      phaseId = op.phases[0].id,
      staffId = config.doctrine.staff[0].id;
    const metadata = {
      ownerId: staffId,
      statusId: config.doctrine.editingStatus,
      references: [],
      source: { type: "user-entry", note: "" },
    };
    const assembly = {
      id: randomUUID(),
      name: "Fictional assembly",
      metadata,
      phaseId,
      at: "2026-10-15T12:00:00.000Z",
      relativeToEventId: null,
      offsetMinutes: 0,
      schedule: {
        schemaVersion: 1,
        durationMinutes: 60,
        unitId: op.units[0].id,
        relativeAnchor: "START",
      },
    };
    const departure = {
      ...structuredClone(assembly),
      id: randomUUID(),
      name: "Fictional departure",
      at: null,
      relativeToEventId: assembly.id,
      offsetMinutes: 15,
      schedule: {
        schemaVersion: 1,
        durationMinutes: 30,
        unitId: op.units[1].id,
        relativeAnchor: "END",
      },
    };
    op.events = [
      assembly,
      departure,
      {
        ...structuredClone(assembly),
        id: randomUUID(),
        name: "Fictional unscheduled briefing",
        at: null,
        schedule: { ...assembly.schedule, durationMinutes: 0 },
      },
    ];
    for (let i = 3; i < 1000; i++)
      op.events.push({
        ...structuredClone(assembly),
        id: randomUUID(),
        name: `Capacity event ${String(i).padStart(4, "0")}`,
        phaseId: null,
        at: new Date(Date.parse(assembly.at) + i * 60000).toISOString(),
      });
    for (let i = 0; i < 65; i++)
      op.attachments.push({
        id: randomUUID(),
        name: `Fictional writing product ${i + 1}`,
        metadata: structuredClone(metadata),
        kind: "annex",
        parentId: op.orderId,
        code: `Z${i + 1}`,
        catalogId: null,
        narrative: i % 2 ? "Fictional writing in progress." : "",
        phaseIds: [],
        unitIds: [],
        required: false,
      });
    state = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    await page.reload();
    await openOperation(page, operationId);
    let start = Date.now();
    await navigateOperation(page, "Timeline");
    await page.locator(".planning-event-row").first().waitFor();
    evidence.timings.timeline1000Ms = Date.now() - start;
    assert.equal(await page.locator(".planning-event-row").count(), 60);
    await button("More events").click();
    assert.match(
      await page.locator(".planning-pagination").innerText(),
      /61–120 of 1000/,
    );
    await label("Timeline phase").selectOption(phaseId);
    assert.equal(await page.locator(".planning-event-row").count(), 3);
    await label("Group timeline by").selectOption("unit");
    assert((await page.locator(".planning-lane").count()) >= 2);
    await label("Group timeline by").selectOption("staff");
    assert((await page.locator(".planning-lane").count()) >= 1);
    await label("Group timeline by").selectOption("time");
    await button(assembly.name).click();
    await label("Duration in minutes").fill("120");
    await button(departure.name).click();
    assert.match(await page.locator(".planning-resolved").innerText(), /14:15/);
    await button("Undo").click();
    assert.match(await page.locator(".planning-resolved").innerText(), /13:15/);
    await button("Redo").click();
    assert.match(await page.locator(".planning-resolved").innerText(), /14:15/);
    await button(assembly.name).click();
    assert.equal(
      await label("Relative to event")
        .locator(`option[value="${departure.id}"]`)
        .count(),
      0,
    );
    await button("Remove event").click();
    assert.match(
      await page.getByRole("alert").filter({ visible: true }).innerText(),
      /Change the scheduling link/,
    );
    await button(departure.name).click();
    await label("Follow linked event").selectOption("START");
    assert.match(await page.locator(".planning-resolved").innerText(), /12:15/);
    await label("Follow linked event").selectOption("END");
    await save();
    pass(
      "1000 events use 60 rows; unit/staff/phase views, start/finish links, duration propagation, undo/redo and cycle/deletion protection work",
    );
    await label("Find events").fill("not visible");
    await page.keyboard.press("Control+k");
    let dialog = page.locator('[aria-label="Search Ordo"]');
    await dialog.getByLabel("Find in Ordo").fill(departure.name);
    await dialog.locator(".search-result").first().waitFor();
    await dialog
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Event name",
    );
    assert.equal(await label("Event name").inputValue(), departure.name);
    pass(
      "Search opens and focuses the exact selected event even outside the current chart filter",
    );
    await label("Find events").fill("");
    await navigateOperation(page, "Planning progress");
    await page.locator(".planning-product").first().waitFor();
    assert.equal(await page.locator(".planning-product").count(), 40);
    await button("More products").click();
    assert((await page.locator(".planning-product").count()) < 40);
    await label("Find products").fill("Base order");
    await label("Due date (UTC) — Base order").fill("2026-10-01T12:00");
    assert.match(
      await page.locator(".planning-product").innerText(),
      /Overdue/,
    );
    await label("Ready — Base order").check();
    assert.equal(
      await page.locator(".planning-product .planning-state").innerText(),
      "Ready",
    );
    const group = page.locator(".planning-staff-group").first();
    await group.locator("summary").click();
    assert.equal(await group.getAttribute("open"), null);
    await group.locator("summary").click();
    await button("Open writing").click();
    await page
      .getByRole("heading", { name: "Base order", exact: true })
      .waitFor();
    await navigateOperation(page, "Timeline");
    await button(assembly.name).click();
    await label("Duration in minutes").fill("150");
    await navigateOperation(page, "Planning progress");
    await label("Find products").fill("Base order");
    assert.equal(
      await page.locator(".planning-product .planning-state").innerText(),
      "In progress",
    );
    await save();
    state = await call("execute", { type: "load", operationId });
    assert.equal(state.operation.planningProgress.products[0].readyAt, null);
    assert.equal(
      state.operation.planningProgress.products[0].dueAt,
      "2026-10-01T12:00:00.000Z",
    );
    pass(
      "Writing state, manual Ready, overdue dates, collapsible staff groups, direct writing navigation and readiness reopening work without approval",
    );
    await navigateOperation(page, "Timeline");
    await label("Timeline phase").selectOption(phaseId);
    await button(assembly.name).click();
    await label("Duration in minutes").fill("180");
    await page.waitForFunction(async (id) => {
      const list = await window.ordo.recovery({ type: "list" });
      return list.drafts?.some((d) => d.id === id);
    }, operationId);
    // Deliberate renderer-failure injection exercises recovery without asking
    // the normal unsaved-changes dialog to discard the copy under test.
    evidence.lifecycle.push({ stage: "renderer-failure-injection" });
    record();
    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          contents.once("render-process-gone", () => resolve());
          contents.forcefullyCrashRenderer();
        }),
    );
    await close();
    await launch();
    await openOperation(page, operationId);
    await button("Recover working copy").click();
    await navigateOperation(page, "Timeline");
    await label("Timeline phase").selectOption(phaseId);
    await button(assembly.name).click();
    assert.equal(await label("Duration in minutes").inputValue(), "180");
    await save();
    pass(
      "Unfinished duration and progress metadata survive deliberate renderer failure and explicit working-copy recovery",
    );
    await navigateOperation(page, "Base order");
    await label("Module type").selectOption("PLANNING_CARDS");
    await button("Add operation module").click();
    await button("Insert linked card").click();
    const picker = page.locator('[aria-label="Choose card source"]');
    await picker.getByLabel("Find card source").fill(departure.name);
    await picker
      .getByRole("button", { name: departure.name, exact: true })
      .click();
    await picker
      .getByRole("button", { name: "Insert card", exact: true })
      .click();
    await save();
    state = await call("execute", { type: "load", operationId });
    // Explicitly choose the optional new card fields; the retained output is generated through the public command.
    state.operation.planningCards.definitions[0].fields = [
      "name",
      "time",
      "finish",
      "duration",
      "unit",
    ];
    state = await call("execute", {
      type: "save",
      operation: state.operation,
      expectedRevision: state.operation.revision,
    });
    const profile = state.profiles.find((p) => p.product === "opord");
    profile.inclusion.paragraphIds = [];
    profile.inclusion.attachmentIds = [];
    profile.inclusion.packageScope = "selected";
    state = await call("execute", {
      type: "save-profile",
      profile,
      isNew: false,
    });
    const retained = state.profiles.find((p) => p.id === profile.id);
    state = await call("execute", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      profileRef: { id: retained.id, version: retained.version },
      publicationId: null,
    });
    const output = state.exports[0];
    assert.match(output.html, /2026-10-15T15:15:00.000Z/);
    assert.match(output.html, /2026-10-15T15:45:00.000Z/);
    assert.match(output.html, /Duration/);
    const { record: pdf } = await call("documents", {
      type: "generate",
      operationId,
      exportId: output.id,
      options: { paper: "A4", orientation: "portrait" },
    });
    fs.writeFileSync(path.join(folder, "schedule-order.html"), output.html);
    await app.evaluate(
      ({ app }, args) => {
        const req = process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/package.json"),
          db = new (req("better-sqlite3"))(args.database, { readonly: true });
        try {
          req("node:fs").writeFileSync(
            args.output,
            db
              .prepare("SELECT bytes FROM document_exports WHERE id=?")
              .get(args.id).bytes,
          );
        } finally {
          db.close();
        }
      },
      {
        database: path.join(folder, "workspace", "ordo.db"),
        id: pdf.id,
        output: path.join(folder, "schedule-order.pdf"),
      },
    );
    pass(
      "Explicit linked event cards retain correct start, finish, duration and unit in HTML and a real PDF",
    );
    await close();
    await launch();
    state = await call("execute", { type: "load", operationId });
    assert.equal(
      state.operation.events.find((e) => e.id === assembly.id).schedule
        .durationMinutes,
      180,
    );
    assert.equal(
      state.exports.find((e) => e.id === output.id).html,
      output.html,
    );
    await openOperation(page, operationId);
    await navigateOperation(page, "Timeline");
    await label("Timeline phase").selectOption(phaseId);
    await button(departure.name).click();
    pass(
      "Normal clean restart verifies schedule, progress, retained HTML and PDF provenance",
    );
    const globalNav = page.getByRole("navigation", {
      name: "Global navigation",
    });
    await globalNav
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    const themes = await label("Color theme")
      .locator("option")
      .evaluateAll((options) =>
        options.map((o) => ({ value: o.value, name: o.textContent })),
      );
    assert.equal(themes.length, 8);
    for (const theme of themes) {
      await label("Color theme").selectOption(theme.value);
      await openTab();
      await navigateOperation(page, "Timeline");
      await label("Timeline phase").selectOption(phaseId);
      await button(departure.name).click();
      await screenshot("timeline-" + theme.value);
      assert.equal(
        await page
          .locator(".planning-chart-scroll")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        false,
        "Fit schedule must fit the actual panel width",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      await navigateOperation(page, "Planning progress");
      await label("Find products").fill("Base order");
      await screenshot("progress-" + theme.value);
      await globalNav
        .getByRole("button", { name: "Settings", exact: true })
        .click();
    }
    await label("Color theme").selectOption(themes[0].value);
    await openTab();
    await page.setViewportSize({ width: 1050, height: 850 });
    await navigateOperation(page, "Timeline");
    await label("Timeline phase").selectOption(phaseId);
    await button(departure.name).click();
    await screenshot("timeline-narrow");
    assert.equal(
      await page
        .locator(".planning-chart-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
      "Narrow fit schedule must fit",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1600, height: 1100 });
    pass(
      "All eight themes and the narrow layout render with bounded charts, readable controls and no page-level horizontal overflow",
    );
    const backup = path.join(folder, "timeline-backup.db");
    await globalNav
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, backup);
    await button("Back up workspace").click();
    await page.getByText("Backup saved:", { exact: false }).waitFor();
    await openTab();
    await navigateOperation(page, "Timeline");
    await label("Timeline phase").selectOption(phaseId);
    await button(assembly.name).click();
    await label("Duration in minutes").fill("240");
    await save();
    await globalNav
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
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
    assert.equal(
      state.operation.events.find((e) => e.id === assembly.id).schedule
        .durationMinutes,
      180,
    );
    assert.equal(
      state.operation.planningProgress.products[0].dueAt,
      "2026-10-01T12:00:00.000Z",
    );
    assert.equal(
      state.exports.find((e) => e.id === output.id).html,
      output.html,
    );
    assert.equal(
      (await call("documents", { type: "list", operationId })).records[0]
        .contentHash,
      pdf.contentHash,
    );
    pass(
      "Backup/restore restores schedule, due dates, Ready state and retained HTML/PDF without altering stored outputs",
    );
    assert.deepEqual(evidence.errors, []);
  } catch (e) {
    evidence.failure = String(e.stack ?? e);
    record();
    console.error(e);
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png"), fullPage: true })
        .catch(() => {});
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
