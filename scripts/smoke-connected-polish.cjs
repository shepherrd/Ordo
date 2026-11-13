// Integration checks use isolated fictional data and the normal offline desktop.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: id, createHash } = require("node:crypto");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(".test-data", "connected-polish-desktop-" + id());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const executable = process.argv[2];
  const evidence = {
    executable: executable ?? "development build",
    checks: [],
    errors: [],
    screenshots: [],
    lifecycle: [],
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
  const pass = (s) => {
    evidence.checks.push(s);
    record();
    console.log("PASS " + s);
  };
  let app, page;
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const label = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const shot = async (name) => {
    await page.screenshot({
      path: path.join(folder, name + ".png"),
      fullPage: true,
    });
    evidence.screenshots.push(name + ".png");
    record();
  };
  const clean = () =>
    page
      .locator('[data-workspace-dirty="false"][data-workspace-busy="false"]')
      .filter({ visible: true })
      .waitFor();
  const search = async () => {
    await page.keyboard.press("Control+k");
    const d = page.locator('[aria-label="Search Ordo"]');
    await d
      .getByRole("textbox", { name: "Find in Ordo" })
      .fill("Polish reception task");
    await d.locator(".search-result").first().waitFor();
    await d.getByRole("button", { name: "Used in", exact: true }).click();
    await d
      .getByRole("button", { name: "Open saved order", exact: true })
      .first()
      .waitFor();
    return d;
  };
  const settings = () =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Settings", exact: true })
      .click();
  const tab = (op) =>
    page
      .locator(`[data-open-operation-id="${op}"] .open-operation-name`)
      .filter({ visible: true })
      .click();
  try {
    app = await electron.launch({
      ...(executable
        ? { executablePath: path.resolve(executable), args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1600, height: 1100 });
    evidence.lifecycle.push({ stage: "ready", pid: app.process().pid });
    const initial = await call("execute", { type: "load" }),
      config = initial.configurations.find((c) => !c.doctrine.catalog);
    let state = await call("execute", {
      type: "create",
      name: "Fictional connected polish",
      demo: true,
      configuration: {
        id: config.doctrine.id,
        version: config.doctrine.version,
      },
    });
    const op = state.operation,
      operationId = op.id,
      task = op.tasks[0],
      c = id(),
      independent = id(),
      deckId = id(),
      boardId = id();
    task.name = "Polish reception task";
    task.purpose = "Saved violet reception purpose";
    op.planningCards = {
      schemaVersion: 1,
      definitions: [
        {
          id: c,
          title: "Reception purpose",
          mode: "linked",
          source: { kind: "entity", entityKind: "task", entityId: task.id },
          fields: ["purpose"],
        },
        {
          id: independent,
          title: "Historical task copy",
          mode: "independent",
          fields: ["purpose"],
          values: [{ key: "purpose", label: "Purpose", value: task.purpose }],
          scope: { unitIds: [], phaseIds: [] },
          origin: {
            target: { kind: "entity", entityKind: "task", entityId: task.id },
            contentHash: "0".repeat(64),
            state: { kind: "saved", revision: op.revision },
          },
        },
      ],
    };
    op.briefings = {
      schemaVersion: 1,
      decks: [
        {
          id: deckId,
          name: "Reception briefing",
          footer: "Fictional training",
          slides: [
            {
              id: id(),
              title: "Reception",
              layout: "cards",
              body: "",
              notes: "Fictional presenter note",
              cardIds: [c],
              graphic: null,
            },
          ],
        },
      ],
    };
    op.whiteboards = {
      schemaVersion: 1,
      boards: [
        {
          id: boardId,
          name: "Reception board",
          width: 1200,
          height: 700,
          background: "#ffffff",
          items: [
            {
              id: id(),
              kind: "card",
              cardId: c,
              x: 60,
              y: 60,
              width: 500,
              height: 250,
              locked: false,
            },
          ],
          connectors: [],
        },
      ],
    };
    state = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    state = await call("execute", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      profileRef: {
        id: state.profiles.find((p) => p.product === "opord").id,
        version: state.profiles.find((p) => p.product === "opord").version,
      },
      publicationId: null,
    });
    const order = state.exports[0];
    await call("whiteboards", {
      type: "generate",
      operationId,
      boardId,
      expectedRevision: state.operation.revision,
      revision: state.operation.revision,
      publicationId: null,
    });
    assert.equal(await page.evaluate(() => "briefings" in window.ordo), false);
    await assert.rejects(
      call("office", {
        type: "generate",
        operationId,
        expectedRevision: state.operation.revision,
        source: {
          kind: "briefing",
          deckId,
          revision: state.operation.revision,
          publicationId: null,
        },
      }),
      /Only Word orders/,
    );
    await call("office", {
      type: "generate",
      operationId,
      expectedRevision: state.operation.revision,
      source: {
        kind: "order",
        exportId: order.id,
        options: { paper: "Letter", orientation: "portrait" },
      },
    });
    const other = (
      await call("execute", {
        type: "create",
        name: "Fictional support operation",
        demo: false,
        configuration: {
          id: config.doctrine.id,
          version: config.doctrine.version,
        },
      })
    ).operation;
    const copiedCard = structuredClone(op.planningCards.definitions[1]);
    copiedCard.id = id();
    copiedCard.title = "Support operation copy";
    copiedCard.origin.operationId = operationId;
    other.planningCards = { schemaVersion: 1, definitions: [copiedCard] };
    await call("execute", {
      type: "save",
      operation: other,
      expectedRevision: other.revision,
    });
    await openOperation(page, operationId);
    assert.equal(await button("Briefings").count(), 0);
    let dialog = await search();
    assert.equal(
      await dialog.getByText("Recent briefing PDFs", { exact: true }).count(),
      0,
    );
    for (const name of [
      "Open saved order",
      "Open saved snapshot",
      "Open saved Word export",
    ]) {
      const opener = (
        name === "Open saved Word export"
          ? dialog.locator(".retained-usage-record").filter({ hasText: "DOCX" })
          : dialog
      )
        .getByRole("button", { name, exact: true })
        .first();
      await opener.click();
      const modal = page.locator(".retained-product-preview");
      await modal.waitFor();
      if (name === "Open saved snapshot")
        await modal.locator("img").evaluate((img) => {
          if (!img.complete)
            return new Promise((resolve) =>
              img.addEventListener("load", resolve, { once: true }),
            );
        });
      else
        await modal
          .frameLocator("iframe")
          .getByText("Saved violet reception purpose", { exact: false })
          .first()
          .waitFor();
      if (name === "Open saved Word export") {
        const output = path.join(folder, "used-in.docx");
        await app.evaluate(({ dialog }, filePath) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        }, output);
        await modal
          .getByRole("button", { name: "Save DOCX", exact: true })
          .click();
        await modal.getByRole("status").filter({ hasText: "Saved " }).waitFor();
        assert(fs.statSync(output).size > 1000);
      }
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      assert(await opener.evaluate((el) => document.activeElement === el));
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    pass(
      "Used in opens retained order, snapshot and Word previews; Office saving and Escape focus restoration work",
    );
    await navigateOperation(page, "Base order");
    await label("Module type").selectOption("PLANNING_CARDS");
    await button("Add operation module").click();
    await label("Reuse planning card").selectOption(c);
    await button("Save revision").click();
    await clean();
    assert.equal(
      await page
        .getByRole("navigation", { name: "Operation navigation" })
        .getByRole("button", { name: "Alternative plans", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => "alternatives" in window.ordo),
      false,
    );
    dialog = await search();
    await dialog
      .getByText("Independent copy: Support operation copy", { exact: true })
      .first()
      .waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await navigateOperation(page, "Export studio");
    const history = page
      .locator(".word-exports .history-row")
      .filter({ visible: true });
    await history.first().waitFor();
    assert.equal(await history.count(), 1);
    assert.deepEqual(
      (await call("execute", { type: "load", operationId })).operation
        .briefings,
      op.briefings,
    );
    assert(
      (await history.filter({ hasText: "DOCX" }).innerText()).includes(
        "Outdated",
      ),
    );
    pass(
      "Cross-operation independent copy usage and saved-state Office freshness are visible",
    );
    if (process.env.ORDO_POLISH_VISUAL === "1") {
      await settings();
      const themes = await label("Color theme")
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.value));
      assert.equal(themes.length, 8);
      const pages = [
        "Timeline",
        "Planning progress",
        "Export studio",
        "Whiteboards",
      ];
      for (const theme of themes) {
        await label("Color theme").selectOption(theme);
        await tab(operationId);
        for (const name of pages) {
          await navigateOperation(page, name);
          await page
            .locator("main.workspace:visible")
            .evaluate((e) => (e.scrollTop = 0));
          await shot(theme + "-" + name.toLowerCase().replaceAll(" ", "-"));
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
          );
        }
        dialog = await search();
        await shot(theme + "-search-usage");
        await dialog
          .getByRole("button", {
            name: "Open saved Word export",
            exact: true,
          })
          .first()
          .click();
        await page
          .locator(".retained-product-preview")
          .frameLocator("iframe")
          .getByText("Saved violet reception purpose", { exact: false })
          .first()
          .waitFor();
        // Wait for Chromium to paint the newly attached document iframe.
        await page.waitForTimeout(250);
        await shot(theme + "-retained-output");
        await button("Close preview").click();
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await settings();
      }
      await label("Color theme").selectOption(themes[0]);
      await tab(operationId);
      await page.setViewportSize({ width: 1050, height: 850 });
      for (const name of pages) {
        await navigateOperation(page, name);
        await shot("narrow-" + name.toLowerCase().replaceAll(" ", "-"));
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
      }
      pass(
        "All six delivery pages, search usage and retained previews fit eight themes; narrow desktop pages have no horizontal overflow",
      );
    }
    assert.deepEqual(evidence.errors, []);
    const proc = app.process();
    await app.close();
    app = null;
    evidence.lifecycle.push({
      stage: "exit",
      pid: proc.pid,
      exitCode: proc.exitCode,
    });
    assert.equal(proc.exitCode, 0);
    record();
    console.log(folder);
  } catch (error) {
    evidence.failure = String(error);
    record();
    console.error(error);
    console.error(folder);
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png"), fullPage: true })
        .catch(() => {});
    if (app) {
      await page
        ?.getByRole("button", { name: "Close preview", exact: true })
        .click({ timeout: 2000 })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    process.exitCode = 1;
  }
})();
