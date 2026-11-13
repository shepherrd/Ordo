// Fictional isolated data. Renderer failure is an explicit recovery test; all
// reported normal lifecycle checks use ordinary startup, close, and reopen.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
const {
  createDemo,
  navigateOperation,
  openOperation,
} = require("./smoke-global.cjs");
(async () => {
  const packaged = process.argv.includes("--packaged"),
    version = require("../package.json").version;
  const folder = path.resolve(".test-data", "essentials-" + uid()),
    data = path.join(folder, "workspace");
  fs.mkdirSync(data, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: data, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const checks = [],
    errors = [],
    events = [],
    documents = [];
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
          documents,
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
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
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
    app
      .process()
      .once("exit", (code, signal) => event("process-exit", { code, signal }));
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
  const close = async (fault = false) => {
    if (!fault) await clean();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    event(fault ? "close-after-injected-renderer-failure" : "normal-close", {
      pids,
    });
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
  const saveTo = (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () =>
        file ? { canceled: false, filePath: file } : { canceled: true };
    }, file);
  const waitDraft = async (kind, id) => {
    await page.waitForFunction(
      async ({ kind, id }) =>
        (
          await window.ordo.recovery({
            type: "get",
            key: { kind, id, scope: null },
          })
        ).draft !== null,
      { kind, id },
    );
    await idle();
  };
  try {
    await launch();
    assert.equal((await call("recovery", { type: "list" })).drafts.length, 0);
    report("fresh-offline-launch-and-empty-recovery");
    await createDemo(page, "FICTIONAL ESSENTIALS PLAN", false);
    await clean();
    let state = await call("execute", { type: "load" });
    let op = state.operations[0];
    state = await call("execute", { type: "load", operationId: op.id });
    op = state.operation;
    const savedRevision = op.revision;
    await navigateOperation(page, "Base order");
    const narrative = "UNFINISHED RECOVERY TEXT — fictional planning only";
    await field("Situation").fill(narrative);
    await waitDraft("operation", op.id);
    assert.notEqual(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .sections[0].summary,
      narrative,
    );
    report("operation-working-copy-does-not-save-a-revision");
    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL RECOVERY SYMBOL",
      })
    ).symbol;
    await nav("Military Symbols");
    await page.locator(`[data-symbol-id="${symbol.versionId}"]`).click();
    await field("Saved Symbol name").fill("UNFINISHED SYMBOL NAME");
    await waitDraft("symbol", symbol.versionId);
    report("symbol-working-copy-keeps-exact-source-version");
    event("injected-renderer-failure");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(),
    );
    await close(true);
    await launch();
    assert.equal(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .revision,
      savedRevision,
    );
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
    report("renderer-failure-preserves-copies-without-auto-application");
    await page
      .getByRole("region", { name: "Recover unfinished work" })
      .locator(".browse-row")
      .filter({ hasText: "operation ·" })
      .getByRole("button", { name: "Open working-copy source" })
      .click();
    await page
      .locator('[data-recovery-kind="operation"]')
      .getByRole("button", { name: "Recover working copy" })
      .filter({ visible: true })
      .click();
    await navigateOperation(page, "Base order");
    assert.equal(await field("Situation").inputValue(), narrative);
    await button("Save revision").click();
    await clean();
    assert.equal(
      (
        await call("recovery", {
          type: "get",
          key: { kind: "operation", id: op.id, scope: op.id },
        })
      ).draft,
      null,
    );
    report("explicit-recovery-and-normal-save-clear-only-acknowledged-copy");
    await nav("Dashboard");
    await page
      .getByRole("region", { name: "Recover unfinished work" })
      .locator(".browse-row")
      .filter({ hasText: "symbol ·" })
      .getByRole("button", { name: "Open working-copy source" })
      .click();
    await page
      .locator('[data-recovery-kind="symbol"]')
      .getByRole("button", { name: "Recover working copy" })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Saved Symbol name"]')?.value ===
        "UNFINISHED SYMBOL NAME",
    );
    await idle();
    assert.equal(
      await field("Saved Symbol name").inputValue(),
      "UNFINISHED SYMBOL NAME",
    );
    await button("Save symbol draft").click();
    await clean();
    report("library-recovery-opens-correct-editor-and-version");
    await nav("Dashboard");
    await openOperation(page, op.id);
    await navigateOperation(page, "Tasks & objectives");
    await button("+ Add task").click();
    await navigateOperation(page, "Validation");
    await page
      .getByRole("button")
      .filter({ hasText: "incomplete draft: assign a unit" })
      .click();
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Assigned unit",
    );
    const added = page
      .locator(".task-record-editor")
      .filter({ has: page.getByLabel("Assigned unit", { exact: true }) })
      .last();
    await added
      .getByLabel("Assigned unit", { exact: true })
      .selectOption(op.units[0].id);
    await added
      .getByLabel("Purpose", { exact: true })
      .fill("Fictional essentials routing test");
    await button("Save revision").click();
    await clean();
    report("validation-routes-to-the-correct-task-field");
    state = await call("execute", { type: "load", operationId: op.id });
    op = state.operation;
    op.sections[0].summary =
      Array.from(
        { length: 42 },
        (_, i) =>
          `PARAGRAPH ${i + 1}: Fictional document layout verification. This narrative checks that a long order flows completely across paper pages without losing source content or clipping the final sentence.`,
      ).join("\n\n") + "\nDOCUMENT END MARKER";
    op.units.forEach((u) => {
      u.inTaskOrganization = true;
    });
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
      note: "Fictional essentials approval",
    });
    state = await call("execute", {
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    });
    const publication = state.publications.at(-1);
    assert(publication);
    report("saved-validation-approval-and-publication-route");
    const profiles = [
      state.profiles.find((p) => p.product === "opord"),
      state.profiles.find((p) => p.product === "communications-card"),
    ];
    for (const profile of profiles) {
      state = await call("execute", {
        type: "generate",
        operationId: op.id,
        expectedRevision: op.revision,
        profileRef: { id: profile.id, version: profile.version },
        publicationId: publication.id,
      });
      const source = state.exports.find((e) => e.profile.id === profile.id);
      for (const paper of ["Letter", "A4"]) {
        const record = (
          await call("documents", {
            type: "generate",
            operationId: op.id,
            exportId: source.id,
            options: {
              paper,
              orientation:
                profile.product === "opord" ? "portrait" : "landscape",
            },
          })
        ).record;
        const file = path.join(folder, profile.product + "-" + paper + ".pdf");
        await saveTo(file);
        assert.equal(
          (await call("documents", { type: "save", id: record.id })).path,
          file,
        );
        const bytes = fs.readFileSync(file);
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          record.contentHash,
        );
        assert(bytes.subarray(0, 5).equals(Buffer.from("%PDF-")));
        documents.push({ file, record });
      }
    }
    report(
      "opord-and-communications-card-pdfs-retain-exact-bytes-and-provenance",
    );
    const first = documents[0];
    await saveTo(null);
    assert.equal(
      (await call("documents", { type: "save", id: first.record.id })).path,
      null,
    );
    assert.equal(
      (await call("documents", { type: "list", operationId: op.id })).records
        .length,
      4,
    );
    report("canceled-pdf-save-retains-artifact");
    await saveTo(path.join(data, "ordo.db"));
    await assert.rejects(
      call("documents", { type: "save", id: first.record.id }),
      /outside Ordo/,
    );
    report("document-save-cannot-overwrite-active-workspace");
    const imageFile = path.join(folder, "fictional-figure.png");
    const imageBytes = await app.evaluate(
      ({ nativeImage }, file) =>
        nativeImage
          .createFromPath(file)
          .resize({ width: 256, height: 256 })
          .toPNG()
          .toString("base64"),
      path.resolve("build/icon.ico"),
    );
    fs.writeFileSync(imageFile, Buffer.from(imageBytes, "base64"));
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, imageFile);
    const asset = (
      await call("files", {
        type: "asset-import",
        owner: { kind: "operation", id: op.id },
      })
    ).asset;
    op = (await call("execute", { type: "load", operationId: op.id }))
      .operation;
    const def = (type, position, configuration = {}) => {
      const id = uid();
      return {
        moduleDefinitionId: id,
        stableKey: `module-${id}`,
        moduleType: type,
        title: `FICTIONAL ${type}`,
        description: "",
        guidance: "",
        position,
        required: false,
        defaultVisible: true,
        configuration,
        provenance: {
          sourceClass: "ORDO_DEFAULT",
          sourceReferences: [],
          notes: "Fictional document acceptance",
        },
      };
    };
    const module = (definition, content) => ({
      moduleInstanceId: uid(),
      operationId: op.id,
      productInstanceId: op.orderId,
      moduleDefinitionId: null,
      localDefinition: definition,
      origin: "OPERATION",
      content,
      position: definition.position,
      layoutState: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const columns = ["ROW NUMBER", "FICTIONAL DESCRIPTION"].map((label, i) => ({
      id: uid(),
      stableKey: `column-${i}`,
      label,
      help: "",
      type: "LONG_TEXT",
      required: false,
      options: [],
    }));
    op.modules = {
      schemaVersion: 1,
      assets: [asset],
      instances: [
        module(def("TASK_ORGANIZATION", 0), {
          type: "TASK_ORGANIZATION",
          presentation: {
            schemaVersion: 1,
            mode: "BOTH",
            ancestorPolicy: "BOUNDARY",
            foldPolicy: "AS_SHOWN",
            symbolSize: 35,
          },
        }),
        module(def("IMAGE", 1), {
          type: "IMAGE",
          image: {
            id: uid(),
            assetId: asset.assetId,
            title: "Fictional figure",
            caption: "IMAGE CAPTION END MARKER",
            alt: "Ordo application mark used only as a document fixture",
            width: "small",
            alignment: "center",
          },
        }),
        module(def("TABLE", 2, { columns, allowColumnOverride: true }), {
          type: "TABLE",
          rows: Array.from({ length: 95 }, (_, i) => ({
            id: uid(),
            cells: {
              [columns[0].id]: String(i + 1),
              [columns[1].id]:
                `Fictional row ${i + 1}. Readable wrapped table content without clipped columns.`,
            },
          })),
        }),
      ],
    };
    op.units.forEach((u) => {
      u.symbol = {
        schemaVersion: 1,
        base: { definition: structuredClone(symbol.definition), source: null },
        override: null,
        labels: {
          uniqueDesignation: { kind: "UNIT_NAME" },
          higherFormation: { kind: "DEFINITION" },
        },
      };
    });
    state = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    op = state.operation;
    const orderProfile = state.profiles.find((p) => p.product === "opord");
    state = await call("execute", {
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: orderProfile.id, version: orderProfile.version },
      publicationId: null,
    });
    const graphical = state.exports.find(
      (e) =>
        e.sourceRevision === op.revision && e.profile.id === orderProfile.id,
    );
    assert.equal(graphical.projectionVersion, 5);
    assert(graphical.html.includes("<svg"));
    assert(graphical.html.includes("data:image/png"));
    for (const orientation of ["portrait", "landscape"]) {
      const record = (
        await call("documents", {
          type: "generate",
          operationId: op.id,
          exportId: graphical.id,
          options: { paper: "Letter", orientation },
        })
      ).record;
      const file = path.join(folder, `graphical-order-${orientation}.pdf`);
      await saveTo(file);
      await call("documents", { type: "save", id: record.id });
      documents.push({ file, record });
    }
    report(
      "graphical-order-image-and-multipage-table-use-authoritative-projection-v5",
    );
    await clean();
    await page.reload();
    await openOperation(page, op.id);
    await navigateOperation(page, "Export studio");
    const output = page
      .locator(".document-output")
      .filter({ visible: true })
      .first();
    await output.locator("summary").click();
    await output
      .getByLabel("Saved export paper", { exact: true })
      .selectOption("Letter");
    await output
      .getByRole("button", { name: "Generate PDF", exact: true })
      .click();
    await output
      .getByText("PDF created. Save a copy to review it before printing.", {
        exact: true,
      })
      .waitFor();
    const uiFile = path.join(folder, "ui-order.pdf");
    await saveTo(uiFile);
    await output
      .getByRole("button", { name: "Save PDF", exact: true })
      .first()
      .click();
    await output.getByText(`Saved ${uiFile}`, { exact: true }).waitFor();
    assert(fs.readFileSync(uiFile).subarray(0, 5).equals(Buffer.from("%PDF-")));
    report("pdf-generation-and-save-through-retained-export-ui");
    await app.evaluate(({ app }) => {
      app.once("browser-window-created", (_event, win) => {
        win.webContents.print = (options, callback) => {
          globalThis.essentialsPrintOptions = options;
          callback(false, "Print job canceled");
        };
      });
    });
    await output
      .getByRole("button", { name: "Print document", exact: true })
      .first()
      .click();
    await output.getByText("Printing canceled.", { exact: true }).waitFor();
    const printOptions = await app.evaluate(
      () => globalThis.essentialsPrintOptions,
    );
    assert.equal(printOptions.silent, false);
    assert.equal(printOptions.pageSize, "Letter");
    report(
      "print-port-options-and-cancellation-feedback-without-submitting-a-printer-job",
    );
    const key = { kind: "operation", id: op.id, scope: op.id },
      beforeRestore = await call("recovery", { type: "list" });
    const source = JSON.stringify(op),
      recoveryValue = JSON.stringify({
        ...op,
        name: "FICTIONAL BACKUP WORKING COPY",
      });
    const draft = (
      await call("recovery", {
        type: "put",
        token: beforeRestore.token,
        key,
        source,
        value: recoveryValue,
        label: "Backup working copy",
        expected: 0,
      })
    ).draft;
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    assert.equal(await call("restore"), null);
    assert.equal(
      (await call("recovery", { type: "list" })).token,
      beforeRestore.token,
    );
    const invalid = path.join(folder, "invalid-backup.db");
    fs.writeFileSync(invalid, "Not an Ordo database");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, invalid);
    await assert.rejects(call("restore"));
    assert.equal(
      (await call("recovery", { type: "list" })).token,
      beforeRestore.token,
    );
    assert.equal(
      (await call("recovery", { type: "get", key })).draft.value,
      recoveryValue,
    );
    report(
      "canceled-and-invalid-restore-preserve-working-copy-and-session-token",
    );
    const backup = path.join(folder, "workspace-backup.db");
    await saveTo(backup);
    await call("backup");
    assert(fs.existsSync(backup));
    await call("recovery", {
      type: "put",
      token: beforeRestore.token,
      key,
      source,
      value: JSON.stringify({ ...op, name: "Later copy" }),
      label: "Later copy",
      expected: draft.sequence,
    });
    report("backup-includes-retained-documents-and-working-copy-store");
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
    const restored = await call("documents", {
      type: "list",
      operationId: op.id,
    });
    assert.equal(restored.records.length, 7);
    const recovered = await call("recovery", { type: "get", key });
    assert.notEqual(recovered.token, beforeRestore.token);
    assert.equal(recovered.draft.value, recoveryValue);
    assert.equal(recovered.compatible, true);
    await assert.rejects(
      call("recovery", {
        type: "remove",
        key,
        token: beforeRestore.token,
        expected: recovered.draft.sequence,
      }),
      /workspace changed/,
    );
    assert.equal(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .name,
      op.name,
    );
    report(
      "successful-restore-keeps-backup-working-copy-explicit-and-rejects-old-session",
    );
    await saveTo(path.join(folder, "restored.pdf"));
    await call("documents", { type: "save", id: first.record.id });
    assert(
      fs
        .readFileSync(path.join(folder, "restored.pdf"))
        .equals(fs.readFileSync(first.file)),
    );
    report("restore-verifies-pdf-bytes-and-remounts-workspace");
    await nav("Settings");
    await page.getByText("Workspace database", { exact: true }).waitFor();
    const info = await call("workspaceInfo");
    assert.equal(info.appVersion, version);
    assert(documents.every((d) => d.record.environment.appVersion === version));
    assert.equal(info.databasePath, path.join(data, "ordo.db"));
    report("settings-explain-application-data-and-upgrade-locations");
    await close();
    await launch();
    assert.equal(
      (await call("documents", { type: "list", operationId: op.id })).records
        .length,
      7,
    );
    await close();
    report("normal-clean-exit-process-tree-and-reopen");
    assert.deepEqual(errors, []);
    write();
    console.log("Essentials acceptance: " + folder);
  } catch (e) {
    write(e);
    console.error(e);
    if (page)
      try {
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
