// Isolated fictional fixture. Measures dispatch-to-paint, excluding debounce.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
(async () => {
  const reuse = process.env.ORDO_BENCHMARK_FIXTURE;
  const folder = reuse
    ? path.resolve(reuse)
    : path.resolve(".test-data", "connected-capacity-" + randomUUID());
  assert(folder.startsWith(path.resolve(".test-data") + path.sep));
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const executable = process.argv[2];
  const evidence = {
    hardware: {
      cpu: os.cpus()[0].model,
      cores: os.cpus().length,
      memoryGiB: os.totalmem() / 1024 ** 3,
    },
    executable: executable ?? "development",
    checks: [],
    samples: [],
    errors: [],
  };
  const record = () =>
    fs.writeFileSync(
      path.join(folder, "result.json"),
      JSON.stringify(evidence, null, 2),
    );
  let app, page;
  const saveVisible = async () => {
    const button = page
      .getByRole("button", { name: "Save revision", exact: true })
      .filter({ visible: true });
    if ((await button.count()) && (await button.isEnabled())) {
      await button.click();
      await page
        .locator("[data-operation-editor]:not([hidden]) .save-state")
        .filter({ hasText: "Saved" })
        .waitFor();
    }
  };
  const saveAll = async () => {
    const ids = await page
      .locator("[data-open-operation-id]")
      .filter({ visible: true })
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.openOperationId));
    for (const id of ids) {
      await page
        .locator(`[data-open-operation-id="${id}"] .open-operation-name`)
        .filter({ visible: true })
        .click();
      await saveVisible();
    }
  };
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
    await page.setViewportSize({ width: 1500, height: 1000 });
    evidence.runtime = await app.evaluate(() => ({ ...process.versions }));
    const call = (method, ...args) =>
      page.evaluate(({ method, args }) => window.ordo[method](...args), {
        method,
        args,
      });
    const base = await call("execute", { type: "load" });
    const config = base.configurations.find((c) => !c.doctrine.catalog),
      ids = [];
    if (reuse)
      ids.push(
        ...base.operations
          .filter((o) => /^(Fictional|Working) capacity/.test(o.name))
          .sort(
            (a, b) =>
              Number(a.name.match(/capacity (\d+)/)[1]) -
              Number(b.name.match(/capacity (\d+)/)[1]),
          )
          .map((o) => o.id),
      );
    for (let n = 0; !reuse && n < 50; n++) {
      const s = await call("execute", {
        type: "create",
        name: `Fictional capacity ${String(n).padStart(2, "0")}`,
        demo: true,
        configuration: {
          id: config.doctrine.id,
          version: config.doctrine.version,
        },
      });
      const template = s.operation.tasks[0];
      s.operation.tasks = Array.from({ length: 500 }, (_, i) => ({
        ...structuredClone(template),
        id: randomUUID(),
        name: `Fictional task ${n} ${i}`,
        purpose: `Readiness Equipe ${n} objective ${i} reception provision planning summary content.`,
      }));
      await call("execute", {
        type: "save",
        operation: s.operation,
        expectedRevision: s.operation.revision,
      });
      ids.push(s.operation.id);
      if (n % 10 === 9) console.log("Seeded operations " + (n + 1));
    }
    for (let batch = 0; !reuse && batch < 40; batch++) {
      await page.evaluate(async (batch) => {
        for (let i = 0; i < 25; i++)
          await window.ordo.symbols({
            type: "new",
            kind: "SYMBOL",
            name: `Fictional catalog ${batch * 25 + i}`,
          });
      }, batch);
      if (batch % 10 === 9) console.log("Seeded catalog " + (batch + 1) * 25);
    }
    assert.equal(ids.length, 50);
    evidence.index = await app.evaluate(
      ({ app }, file) => {
        const req = process
            .getBuiltinModule("module")
            .createRequire(app.getAppPath() + "/package.json"),
          db = new (req("better-sqlite3"))(file, { readonly: true });
        try {
          return {
            entries: db.prepare("SELECT count(*) n FROM search_documents").get()
              .n,
            owners: db.prepare("SELECT count(*) n FROM search_owners").get().n,
            bytes: db
              .prepare(
                "SELECT sum(pgsize) n FROM dbstat WHERE name LIKE 'search_%'",
              )
              .get().n,
          };
        } finally {
          db.close();
        }
      },
      path.join(folder, "workspace", "ordo.db"),
    );
    assert(evidence.index.entries >= 50000);
    record();
    await page.reload();
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    const nav = page.getByRole("navigation", { name: "Global navigation" });
    for (let i = 0; i < 10; i++) {
      await nav
        .getByRole("button", { name: "Operations", exact: true })
        .click();
      await page
        .getByLabel("Search operations", { exact: true })
        .fill(
          reuse
            ? base.operations.find((o) => o.id === ids[i]).name
            : `Fictional capacity ${String(i).padStart(2, "0")}`,
        );
      await page.locator(`[data-operation-id="${ids[i]}"]`).click();
      await page
        .getByRole("navigation", { name: "Operation navigation" })
        .getByRole("button", { name: "Overview", exact: true })
        .click();
      await page
        .getByLabel("Operation name", { exact: true })
        .filter({ visible: true })
        .fill(
          `Working capacity ${String(i).padStart(2, "0")} run ${Date.now()}`,
        );
    }
    assert.equal(await page.locator("[data-operation-editor]").count(), 10);
    await nav.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.keyboard.press("Control+k");
    const dialog = page.locator('[aria-label="Search Ordo"]');
    const queries = [
      "Readiness",
      "fictional task 12",
      "equipe 25",
      "catalog 95",
      "working capacity",
      "reception provision",
      "task 49 499",
      "no-match-sentinel",
    ];
    for (let n = 0; n < 40; n++) {
      await page.evaluate(() =>
        performance.clearMeasures("ordo-search-render"),
      );
      await dialog
        .getByLabel("Find in Ordo", { exact: true })
        .fill(queries[n % queries.length]);
      await page.waitForFunction(
        () => performance.getEntriesByName("ordo-search-render").length > 0,
        null,
        { polling: "raf" },
      );
      const ms = await page.evaluate(
        () =>
          performance.getEntriesByName("ordo-search-render").at(-1).duration,
      );
      if (n >= 8)
        evidence.samples.push({ query: queries[n % queries.length], ms });
    }
    const samples = evidence.samples.map((s) => s.ms).sort((a, b) => a - b);
    evidence.p95Ms = samples[Math.ceil(samples.length * 0.95) - 1];
    evidence.medianMs = samples[Math.floor(samples.length / 2)];
    evidence.checks.push(
      "50 operations, 50000+ entries, 1000 catalog items, 10 dirty open tabs",
    );
    record();
    await dialog
      .getByLabel("Find in Ordo", { exact: true })
      .fill("working capacity");
    await page.waitForFunction(
      () => document.querySelectorAll(".search-result").length === 10,
    );
    assert.match(
      await dialog.locator(".search-result").first().innerText(),
      /Working/,
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await nav.getByRole("button", { name: "Settings", exact: true }).click();
    const selector = page.getByLabel("Color theme", { exact: true });
    evidence.themes = await selector
      .locator("option")
      .evaluateAll((nodes) => nodes.map((n) => n.value));
    for (const theme of evidence.themes) {
      await selector.selectOption(theme);
      await page.keyboard.press("Control+k");
      await dialog
        .getByLabel("Find in Ordo", { exact: true })
        .fill("working capacity");
      await dialog.locator(".search-result").first().waitFor();
      await page.screenshot({ path: path.join(folder, `search-${theme}.png`) });
      assert(
        (await dialog.evaluate((el) => el.getBoundingClientRect().width)) > 800,
      );
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    }
    evidence.checks.push(
      "All eight themes render the full-width search dialog",
    );
    await saveAll();
    // Separate large-card editor fixture, seeded through the regular save API.
    const large = await call("execute", {
      type: "create",
      name: "Fictional large cards",
      demo: true,
      configuration: {
        id: config.doctrine.id,
        version: config.doctrine.version,
      },
    });
    const op = large.operation,
      definitionId = randomUUID(),
      stamp = new Date().toISOString();
    op.planningCards = {
      schemaVersion: 1,
      definitions: Array.from({ length: 1000 }, (_, i) => ({
        id: randomUUID(),
        title: `Fictional card ${i}`,
        mode: "linked",
        source: {
          kind: "entity",
          entityKind: "task",
          entityId: op.tasks[0].id,
        },
        fields: ["name", "purpose"],
      })),
    };
    op.modules = {
      schemaVersion: 1,
      assets: [],
      instances: [
        {
          moduleInstanceId: randomUUID(),
          operationId: op.id,
          productInstanceId: op.orderId,
          moduleDefinitionId: null,
          origin: "OPERATION",
          position: 0,
          layoutState: "ACTIVE",
          createdAt: stamp,
          updatedAt: stamp,
          localDefinition: {
            moduleDefinitionId: definitionId,
            stableKey: `module-${definitionId}`,
            moduleType: "PLANNING_CARDS",
            title: "Planning cards",
            description: "",
            guidance: "",
            position: 0,
            required: false,
            defaultVisible: true,
            configuration: {},
            provenance: {
              sourceClass: "ORDO_DEFAULT",
              sourceReferences: [],
              notes: "Fictional qualification fixture",
            },
          },
          content: {
            type: "PLANNING_CARDS",
            message: "Planning cards require the current document renderer.",
            placements: Array.from({ length: 2000 }, (_, i) => ({
              id: randomUUID(),
              cardId: op.planningCards.definitions[i % 1000].id,
              layout: "compact",
            })),
          },
        },
      ],
    };
    await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    await nav.getByRole("button", { name: "Operations", exact: true }).click();
    await page.getByLabel("Search operations", { exact: true }).fill(op.name);
    await page.locator(`[data-operation-id="${op.id}"]`).click();
    const started = Date.now();
    await page
      .getByRole("navigation", { name: "Operation navigation" })
      .getByRole("button", { name: "Base order", exact: false })
      .click();
    await page.locator(".planning-card").first().waitFor();
    evidence.largeCards = {
      definitions: 1000,
      placements: 2000,
      rendered: await page.locator(".planning-card").count(),
      openMs: Date.now() - started,
    };
    assert.equal(evidence.largeCards.rendered, 20);
    await page.getByRole("button", { name: "More cards", exact: true }).click();
    await page
      .getByRole("heading", { name: "Fictional card 20", exact: true })
      .waitFor();
    assert.equal(await page.locator(".planning-card").count(), 20);
    evidence.checks.push(
      "1000 definitions and 2000 placements render only 20 cards per page",
    );
    for (const theme of evidence.themes) {
      await nav.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByLabel("Color theme", { exact: true }).selectOption(theme);
      await page
        .locator(`[data-open-operation-id="${op.id}"] .open-operation-name`)
        .filter({ visible: true })
        .click();
      await page.locator(".planning-card").first().waitFor();
      await page.screenshot({ path: path.join(folder, `cards-${theme}.png`) });
    }
    assert.deepEqual(evidence.errors, []);
    assert(
      evidence.p95Ms <= 200,
      `Search p95 ${evidence.p95Ms.toFixed(1)}ms exceeds 200ms`,
    );
    console.log(
      JSON.stringify({
        p95Ms: evidence.p95Ms,
        medianMs: evidence.medianMs,
        index: evidence.index,
        largeCards: evidence.largeCards,
      }),
    );
  } catch (e) {
    evidence.failure = String(e.stack ?? e);
    console.error(e);
    process.exitCode = 1;
  } finally {
    record();
    if (app) {
      await saveAll();
      const proc = app.process();
      await app.close();
      evidence.exitCode = proc.exitCode;
      assert.equal(proc.exitCode, 0);
      record();
    }
    console.log(folder);
  }
})();
