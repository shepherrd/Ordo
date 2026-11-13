// Normal offline Electron, isolated fictional data, real snapshots and documents.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: id, createHash } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(".test-data", "whiteboard-desktop-" + id());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const executable = process.argv[2],
    evidence = {
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
  let app, page, operationId, state, boardId, retained;
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
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1600, height: 1100 });
    evidence.lifecycle.push({ stage: "ready", pid: app.process().pid });
  };
  const close = async () => {
    const p = app.process();
    await app.close();
    app = null;
    evidence.lifecycle.push({
      stage: "exit",
      pid: p.pid,
      exitCode: p.exitCode,
    });
    record();
    assert.equal(p.exitCode, 0);
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
    await page
      .locator("main.workspace:visible")
      .evaluate((e) => (e.scrollTop = 0));
    await page.screenshot({
      path: path.join(folder, name + ".png"),
      fullPage: true,
    });
    evidence.screenshots.push(name + ".png");
    record();
  };
  const settings = () =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
  const openTab = () =>
    page
      .locator(`[data-open-operation-id="${operationId}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
  const fileDialog = (output) =>
    app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, output);
  const editItem = async () => {
    if (
      !(await page
        .getByRole("dialog", { name: "Edit item", exact: true })
        .isVisible())
    )
      await button("Edit item").click();
  };
  const position = async (x, y, w, h) => {
    await editItem();
    for (const [k, v] of Object.entries({ x, y, width: w, height: h }))
      await label("Item " + k).fill(String(v));
    await button("Done").click();
  };
  const coordinate = (key) =>
    page
      .locator(".whiteboard-hit.selected")
      .evaluate(
        (e, k) =>
          Math.round(
            parseFloat(e.style[k]) /
              new DOMMatrix(
                getComputedStyle(document.querySelector(".whiteboard-drawing"))
                  .transform,
              ).a,
          ),
        key,
      );
  const pickItem = async (name) => {
    await button("Find item").click();
    await label("Find whiteboard item").fill(name);
    await page
      .locator(".whiteboard-item-list")
      .getByRole("button", { name: new RegExp(name) })
      .first()
      .click();
  };
  try {
    await launch();
    const initial = await call("execute", { type: "load" }),
      config = initial.configurations.find((c) => !c.doctrine.catalog);
    state = await call("execute", {
      type: "create",
      name: "Fictional whiteboard delivery",
      demo: true,
      configuration: {
        id: config.organization.id,
        version: config.organization.version,
      },
    });
    operationId = state.operation.id;
    const originalFacts = JSON.stringify({
      units: state.operation.units,
      tasks: state.operation.tasks,
      objectives: state.operation.objectives,
      phases: state.operation.phases,
      events: state.operation.events,
    });
    state.operation.metadata.documentLayout = {
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
        centre: "Relief planning",
        right: "Planning",
        pageNumbers: true,
      },
    };
    state = await call("execute", {
      type: "save",
      operation: state.operation,
      expectedRevision: state.operation.revision,
    });
    let symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional Relief Division",
      })
    ).symbol;
    symbol.definition.code.sidc = "130310002112110200000000000000";
    symbol = (
      await call("symbols", {
        type: "save-symbol",
        value: symbol,
        expected: symbol.contentVersion,
      })
    ).symbol;
    const graphic = await call("exportGraphic", {
      source: {
        kind: "OPERATION",
        operationId,
        revision: state.operation.revision,
        publicationId: null,
      },
      profile: {
        schemaVersion: 1,
        id: id(),
        version: 1,
        name: "Fictional task organization",
        product: "ORBAT",
        format: "SVG",
        scale: 1,
        background: "WHITE",
        size: 40,
        foldPolicy: "EXPANDED",
        ancestorPolicy: "BOUNDARY",
        selectedUnitIds: null,
        renderProfile: { id: "ordo-symbol", version: 1 },
      },
    });
    await openOperation(page, operationId);
    await navigateOperation(page, "Whiteboards");
    await button("New whiteboard").click();
    await label("Whiteboard name").fill("Relief planning board");
    await button("Add note").click();
    await label("Write on board").fill("Confirm the assembly area");
    await label("Write on board").press("Control+Enter");
    await page.locator(".whiteboard-hit.selected").dblclick();
    assert.equal(
      await label("Write on board").inputValue(),
      "Confirm the assembly area",
    );
    await label("Write on board").press("Escape");
    await position(60, 60, 320, 180);
    await button("Insert…").click();
    await button("Add shape").click();
    await editItem();
    await label("Shape").selectOption("diamond");
    await label("Item text").fill("Decision");
    await position(500, 60, 280, 200);
    await button("Insert…").click();
    await button("Add text").click();
    await label("Write on board").fill("FICTIONAL EXERCISE · Planning options");
    await position(60, 10, 700, 60);
    await button("Insert…").click();
    await button("Add symbol").click();
    await label("Search symbols").fill(symbol.name);
    await page.locator(".symbol-browse-row").first().click();
    await button("Use symbol").click();
    await position(950, 70, 350, 230);
    await page.waitForFunction(() =>
      document
        .querySelector(".whiteboard-drawing image")
        ?.getAttribute("href")
        ?.startsWith("data:"),
    );
    await button("Insert…").click();
    await button("Add planning card").click();
    await label("Search whiteboard content").fill(
      state.operation.tasks[0].name,
    );
    await page
      .locator(".planning-card-sources")
      .getByRole("button", { name: new RegExp(state.operation.tasks[0].name) })
      .first()
      .click();
    await button("Add linked content").click();
    await position(60, 350, 480, 450);
    await button("Insert…").click();
    await label("Saved whiteboard graphic").selectOption(graphic.id);
    await button("Add saved graphic").click();
    await position(640, 370, 850, 400);
    await pickItem("Confirm the assembly");
    const beforeX = await coordinate("left");
    const note = page.locator(".whiteboard-hit.selected");
    await note.scrollIntoViewIfNeeded();
    const box = await note.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 65, box.y + 45, { steps: 8 });
    await page.mouse.up();
    assert((await coordinate("left")) > beforeX);
    await button("Undo").click();
    assert.equal(await coordinate("left"), beforeX);
    const box2 = await note.boundingBox();
    await page.mouse.move(box2.x + 30, box2.y + 30);
    await page.mouse.down();
    await page.mouse.move(box2.x + 80, box2.y + 50, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    assert.equal(await coordinate("left"), beforeX);
    const handle = await button("Resize selected item").boundingBox();
    await page.mouse.move(handle.x + 6, handle.y + 6);
    await page.mouse.down();
    await page.mouse.move(handle.x + 35, handle.y + 20, { steps: 5 });
    await page.mouse.up();
    assert((await coordinate("width")) > 320);
    await button("Undo").click();
    await editItem();
    await label("Lock position").check();
    await button("Done").click();
    await note.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await coordinate("left"), beforeX);
    await editItem();
    await label("Lock position").uncheck();
    await button("Done").click();
    await note.focus();
    await page.keyboard.press("Shift+ArrowRight");
    assert.equal(await coordinate("left"), beforeX + 20);
    await button("Undo").click();
    await button("Connect").click();
    await page
      .locator(".whiteboard-hit")
      .filter({ hasText: "" })
      .nth(0)
      .click();
    await page.locator(".whiteboard-hit").nth(1).click();
    await editItem();
    await label("Connector label").fill("Confirm before decision");
    await button("Done").click();
    await button("Select / move").click();
    await save();
    boardId = state.operation.whiteboards.boards[0].id;
    assert.equal(state.operation.whiteboards.boards[0].items.length, 6);
    assert.equal(state.operation.whiteboards.boards[0].connectors.length, 1);
    assert.equal(
      JSON.stringify({
        units: state.operation.units,
        tasks: state.operation.tasks,
        objectives: state.operation.objectives,
        phases: state.operation.phases,
        events: state.operation.events,
      }),
      originalFacts,
    );
    pass(
      "Create notes, text, shape, symbol, linked card and retained ORBAT; drag, resize, cancel, lock, keyboard nudge and undo; connectors remain visual",
    );
    await navigateOperation(page, "Overview");
    await page.keyboard.press("Control+k");
    await label("Find in Ordo").fill("Confirm the assembly area");
    await page.locator(".search-result").first().click();
    await page
      .locator('[aria-label="Search preview"]')
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await editItem();
    await label("Item text").waitFor();
    assert.equal(
      await label("Item text").inputValue(),
      "Confirm the assembly area",
    );
    await button("Done").click();
    pass("Unified search opens the exact whiteboard note");
    await page.setViewportSize({ width: 1495, height: 912 });
    const surface = page.locator(".whiteboard-canvas");
    await page.waitForFunction(() => {
      const canvas = document.querySelector(".whiteboard-canvas"),
        main = document.querySelector(".whiteboard-page");
      if (!canvas || !main) return false;
      const r = canvas.getBoundingClientRect();
      return (
        r.width > main.clientWidth * 0.85 &&
        r.height > main.clientHeight * 0.62 &&
        r.bottom <= innerHeight
      );
    });
    const normal = await surface.boundingBox();
    await shot("whiteboard-composition");
    await button("Expand board").click();
    await button("Exit expanded board").waitFor();
    await page.waitForFunction(
      (w) =>
        document.querySelector(".whiteboard-canvas").getBoundingClientRect()
          .width > w,
      normal.width,
    );
    await button("Exit expanded board").click();
    await page.setViewportSize({ width: 1600, height: 1100 });
    pass(
      "Canvas fills the board workspace at 1495 × 912 and expands further on request",
    );
    await button("Snapshots").click();
    await button("Create snapshot").click();
    await page
      .getByText("Saved snapshot: Relief planning board.", { exact: true })
      .waitFor({ timeout: 60000 });
    retained = (await call("whiteboards", { type: "list", operationId }))
      .records[0];
    for (const format of ["PNG", "SVG"]) {
      const output = path.join(folder, "whiteboard." + format.toLowerCase());
      await fileDialog(output);
      await button("Save " + format)
        .first()
        .click();
      await page.getByText("Saved " + format + ".", { exact: true }).waitFor();
      assert(fs.statSync(output).size > 1000);
    }
    const data = (
      await call("whiteboards", { type: "preview", id: retained.id })
    ).data;
    const pixels = await page.evaluate(async (data) => {
      const i = new Image();
      i.src = data;
      await i.decode();
      const c = document.createElement("canvas");
      c.width = i.width;
      c.height = i.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(i, 0, 0);
      const region = ctx.getImageData(950, 70, 350, 200).data;
      let colored = 0;
      for (let n = 0; n < region.length; n += 4)
        if (region[n] < 220 && region[n + 1] > 120 && region[n + 2] > 100)
          colored++;
      return { width: i.width, height: i.height, colored };
    }, data);
    assert.equal(pixels.width, 1600);
    assert(pixels.colored > 500);
    evidence.pixels = pixels;
    pass(
      "Real PNG and SVG snapshots include the military symbol, ORBAT and all board content",
    );
    await button("Preview snapshot").first().click();
    await page
      .getByRole("dialog", { name: "Whiteboard snapshot preview" })
      .waitFor();
    await page.screenshot({ path: path.join(folder, "snapshot-preview.png") });
    await button("Close preview").click();
    await button("Insert snapshot").first().click();
    await page
      .getByText(
        "Snapshot inserted. Save the operation to keep the new image.",
        { exact: true },
      )
      .waitFor();
    await button("Done").click();
    await save();
    assert(
      state.operation.modules.instances.some(
        (m) =>
          m.content.type === "IMAGE" &&
          m.content.image.caption.includes("saved whiteboard snapshot"),
      ),
    );
    const profile = state.profiles.find((p) => p.product === "opord");
    state = await call("execute", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      profileRef: { id: profile.id, version: profile.version },
      publicationId: null,
    });
    const source = state.exports[0];
    assert(source.html.includes("saved whiteboard snapshot"));
    fs.writeFileSync(path.join(folder, "order.html"), source.html);
    const doc = await call("documents", {
      type: "generate",
      operationId,
      exportId: source.id,
      options: { paper: "A4", orientation: "portrait" },
    });
    await fileDialog(path.join(folder, "order.pdf"));
    await call("documents", { type: "save", id: doc.record.id });
    const word = await call("office", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      source: {
        kind: "order",
        exportId: source.id,
        options: { paper: "A4", orientation: "portrait" },
      },
    });
    await fileDialog(path.join(folder, "order.docx"));
    await call("office", { type: "save", id: word.record.id });
    pass(
      "Insert an independent snapshot into an order and generate HTML, PDF, and DOCX",
    );
    await pickItem("Confirm the assembly");
    await page.locator(".whiteboard-hit.selected").dblclick();
    await label("Write on board").fill("Recovered board note");
    await page.waitForFunction(async () => {
      const r = await window.ordo.recovery({ type: "list" });
      return r.drafts?.some((d) => d.kind === "operation");
    });
    await app.evaluate(
      ({ BrowserWindow }) =>
        new Promise((resolve) => {
          const c = BrowserWindow.getAllWindows()[0].webContents;
          c.once("render-process-gone", () => resolve());
          c.forcefullyCrashRenderer();
        }),
    );
    await close();
    await launch();
    await openOperation(page, operationId);
    await button("Recover working copy").click();
    await navigateOperation(page, "Whiteboards");
    await pickItem("Recovered board note");
    await page.locator(".whiteboard-hit.selected").dblclick();
    assert.equal(
      await label("Write on board").inputValue(),
      "Recovered board note",
    );
    await save();
    assert.equal(
      (await call("whiteboards", { type: "list", operationId })).records[0]
        .status,
      "Outdated",
    );
    assert.equal(
      (await call("whiteboards", { type: "preview", id: retained.id })).data,
      data,
    );
    pass(
      "Working-copy recovery survives renderer failure; snapshots and embedded images remain unchanged after later edits",
    );
    await page.locator(".whiteboard-hit.selected").dblclick();
    await label("Write on board").fill(
      "Text that must not be clipped. ".repeat(100),
    );
    await save();
    await button("Snapshots").click();
    await button("Create snapshot").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Text does not fit" })
      .waitFor();
    assert.equal(
      (await call("whiteboards", { type: "list", operationId })).records.length,
      1,
    );
    await button("Done").click();
    await page.locator(".whiteboard-hit.selected").dblclick();
    await label("Write on board").fill("Recovered board note");
    await save();
    pass(
      "Snapshot creation rejects overflowing content without retaining a clipped image",
    );
    await settings();
    const themes = await label("Color theme")
      .locator("option")
      .evaluateAll((a) => a.map((o) => o.value));
    assert.equal(themes.length, 8);
    for (const theme of themes) {
      await label("Color theme").selectOption(theme);
      await openTab();
      await navigateOperation(page, "Whiteboards");
      await shot("whiteboard-" + theme);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await settings();
    }
    await label("Color theme").selectOption(themes[0]);
    await openTab();
    await page.setViewportSize({ width: 1050, height: 850 });
    await navigateOperation(page, "Whiteboards");
    await shot("whiteboard-narrow");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1600, height: 1100 });
    pass(
      "All eight themes and a narrow desktop fit the whiteboard controls without page overflow",
    );
    const backup = path.join(folder, "whiteboard-backup.db");
    await settings();
    await fileDialog(backup);
    await button("Back up workspace").click();
    await page.getByText("Backup saved:", { exact: false }).waitFor();
    await openTab();
    await navigateOperation(page, "Whiteboards");
    await label("Whiteboard name").fill("After backup");
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
    assert.equal(
      state.operation.whiteboards.boards[0].name,
      "Relief planning board",
    );
    assert.equal(
      (await call("whiteboards", { type: "preview", id: retained.id })).data,
      data,
    );
    pass(
      "Backup and restore preserve boards, snapshot provenance and exact image bytes",
    );
    const largeId = id();
    state.operation.whiteboards.boards.push({
      id: largeId,
      name: "Fictional 300-item board",
      width: 1600,
      height: 2400,
      background: "#ffffff",
      items: Array.from({ length: 300 }, (_, n) => ({
        id: id(),
        kind: "note",
        x: (n % 10) * 150,
        y: Math.floor(n / 10) * 70,
        width: 140,
        height: 60,
        locked: false,
        text: "Item " + n,
        fontSize: 14,
        fill: "#fff1a8",
        ink: "#172c30",
      })),
      connectors: [],
    });
    state = await call("execute", {
      type: "save",
      operation: state.operation,
      expectedRevision: state.operation.revision,
    });
    await close();
    await launch();
    await openOperation(page, operationId);
    await navigateOperation(page, "Whiteboards");
    assert.equal(
      await label("Whiteboard name").inputValue(),
      "Relief planning board",
    );
    const start = Date.now();
    await button("Boards").click();
    await label("Choose whiteboard").selectOption(largeId);
    await page.waitForFunction(
      () => document.querySelectorAll(".whiteboard-hit").length === 300,
    );
    evidence.largeBoardMs = Date.now() - start;
    assert(evidence.largeBoardMs < 5000);
    await pickItem("Item 299");
    const selectedLarge = page.locator(".whiteboard-hit.selected");
    await selectedLarge.scrollIntoViewIfNeeded();
    await selectedLarge.focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await coordinate("left"), 1351);
    await button("Undo").click();
    await button("Boards").click();
    await button("Remove board").click();
    await save();
    pass(
      "A 300-item board opens within five seconds, supports indexed selection, keyboard movement and undo",
    );
    await close();
    assert.deepEqual(evidence.errors, []);
    pass(
      "Normal restart reopens the saved board; all renderer processes exit cleanly",
    );
  } catch (e) {
    evidence.failure = String(e.stack ?? e);
    console.error(e);
    process.exitCode = 1;
    if (page)
      try {
        await page.screenshot({
          path: path.join(folder, "failure.png"),
          fullPage: true,
        });
        fs.writeFileSync(
          path.join(folder, "failure.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
  } finally {
    if (app) {
      await app
        .evaluate(({ dialog }) => {
          dialog.showMessageBox = async () => ({
            response: 1,
            checkboxChecked: false,
          });
        })
        .catch(() => {});
    }
    if (app) await close().catch((e) => evidence.errors.push(String(e)));
    record();
    console.log(folder);
  }
})();
