// Focused UI regression: saved-symbol scrolling and unit task groups.
// Fictional data only; normal offline launch, clean exit and reopen.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "unit-library-polish-" + uid());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const checks = [],
    measurements = [],
    errors = [],
    events = [];
  const buildFiles = fs
    .readdirSync("out", { recursive: true })
    .filter((p) => fs.statSync(path.join("out", p)).isFile())
    .sort()
    .map((p) => ({
      path: p,
      sha256: createHash("sha256")
        .update(fs.readFileSync(path.join("out", p)))
        .digest("hex"),
    }));
  let app, page;
  const write = (failure) =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          version: require("../package.json").version,
          packaged: false,
          checks,
          measurements,
          errors,
          events,
          buildFiles,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const pass = (name) => {
    checks.push(name);
    write();
    console.log("PASS " + name);
  };
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const nav = () =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Symbols & ORBATs", exact: true })
      .click();
  const current = () => page.locator(".workbench-current");
  const launch = async () => {
    events.push({ stage: "launch", at: new Date().toISOString() });
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(25000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    events.push({
      stage: "ready",
      at: new Date().toISOString(),
      pid: app.process().pid,
    });
  };
  const close = async () => {
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    await app.close();
    app = null;
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
    events.push({ stage: "fully-exited", at: new Date().toISOString(), pids });
  };

  const { openOperation, navigateOperation } = require("./smoke-global.cjs");
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const navGlobal = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const editor = () => page.locator("[data-operation-editor]:not([hidden])");
  const save = async () => {
    await editor()
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  };
  const load = (id) => call("execute", { type: "load", operationId: id });
  const capture = async (name) => {
    await page.screenshot({ path: path.join(folder, name + ".png") });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Page overflow",
    );
  };
  try {
    await launch();
    await page.setViewportSize({ width: 1500, height: 960 });
    const initial = await load();
    const army = initial.doctrines.find((d) =>
      /US Army Orders/i.test(d.displayName),
    );
    assert(army);
    const modern = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL UNIT TASK POLISH",
        demo: true,
        configuration: { id: army.doctrineVersionId, version: 1 },
      })
    ).operation;
    const legacy = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL STARTER NAVIGATION",
        demo: true,
      })
    ).operation;
    const op = structuredClone(modern),
      unitA = op.units[0],
      unitB = op.units[1];
    op.tasks[0].unitId = unitA.id;
    op.tasks.push({
      ...structuredClone(op.tasks[0]),
      id: uid(),
      name: "Fictional second unit task",
    });
    op.tasks[1].unitId = unitB.id;
    op.tasks[1].objectiveId = op.tasks[0].objectiveId;
    const shared = op.tasks[0].objectiveId;
    assert(shared);
    op.tasks.push({
      ...structuredClone(op.tasks[0]),
      id: uid(),
      name: "Fictional unassigned task",
      unitId: null,
      objectiveId: null,
    });
    op.objectives.push({
      ...structuredClone(op.objectives[0]),
      id: uid(),
      name: "Fictional unassigned objective",
    });
    await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    for (let i = 0; i < 18; i++)
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional saved symbol " + String(i + 1).padStart(2, "0"),
      });
    await nav();
    const list = () => page.getByRole("region", { name: "Saved symbols list" });
    await list().locator("button").first().click();
    await current()
      .locator('.graphic-canvas[aria-busy="false"] > div > svg')
      .waitFor();
    assert.equal(
      await page
        .locator("summary")
        .filter({ hasText: "Preview details" })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByText(
          "Select to edit. Drag onto an ORBAT unit to use its symbol.",
          { exact: true },
        )
        .count(),
      0,
    );
    for (const size of [
      { width: 1500, height: 960 },
      { width: 1120, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await list().evaluate((el) => (el.scrollTop = 0));
      const before = await current().boundingBox();
      const b = await list().boundingBox();
      assert(b.height >= 100, "Saved list lost usable height");
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.wheel(0, 450);
      await page.waitForFunction(
        () => document.querySelector(".workbench-symbol-list").scrollTop > 0,
      );
      const after = await current().boundingBox();
      assert(
        Math.abs(before.y - after.y) < 1,
        "Saved list scroll moved current preview",
      );
      const geometry = await list().evaluate((el) => ({
        height: el.clientHeight,
        scroll: el.scrollHeight,
        top: el.scrollTop,
        footer: el.parentElement.querySelector("small").getBoundingClientRect()
          .bottom,
        rail: el.closest("aside").getBoundingClientRect().bottom,
      }));
      assert(geometry.scroll > geometry.height);
      assert(
        geometry.footer <= geometry.rail + 1,
        "Saved symbol count clipped",
      );
      measurements.push({ size, geometry });
      await page.waitForFunction(() => {
        const list = document.querySelector(".workbench-symbol-list"),
          bounds = list.getBoundingClientRect();
        return [...list.querySelectorAll("button")]
          .filter((card) => {
            const b = card.getBoundingClientRect();
            return b.top < bounds.bottom && b.bottom > bounds.top;
          })
          .every((card) => card.querySelector("svg"));
      });
      await capture("symbols-" + size.width);
    }
    pass(
      "Preview details and clipped instruction removed; saved symbols scroll independently at desktop and shorter window sizes",
    );
    await page.setViewportSize({ width: 1500, height: 960 });
    await navGlobal("Dashboard");
    await openOperation(page, modern.id);
    assert(
      (await page
        .getByText("Libertas Optima Rerum", { exact: true })
        .filter({ visible: true })
        .count()) > 0,
    );
    const original = await load(modern.id);
    await navigateOperation(page, "Task organization");
    assert.equal(
      await editor()
        .getByRole("heading", { name: "Units & relationships", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await editor()
        .getByRole("navigation", { name: "Operation navigation" })
        .getByRole("button", { name: /^(?:A )?Task organization$/i })
        .count(),
      1,
    );
    await editor()
      .getByRole("button", { name: "ORBAT view", exact: true })
      .click();
    await editor().locator(".orbat-canvas-workspace").waitFor();
    await editor()
      .getByRole("button", { name: "Tree view", exact: true })
      .click();
    const afterNav = await load(modern.id);
    assert.deepEqual(afterNav.operation, original.operation);
    await capture("annex-task-organization");
    pass(
      "Task Organization appears once in the annex list; Tree and ORBAT views use one units editor without changing applicability or the saved operation",
    );
    await navigateOperation(page, "Tasks & objectives");
    const group = (id) => editor().locator('[data-task-unit-id="' + id + '"]');
    const task = (id) => editor().locator('[data-entity-id="' + id + '"]');
    await editor()
      .getByRole("heading", { name: "Tasks & objectives by unit", exact: true })
      .waitFor();
    await button("Expand all units").click();
    assert.equal(
      await group(unitA.id)
        .locator('[data-entity-id="' + op.tasks[0].id + '"]')
        .count(),
      1,
    );
    assert.equal(
      await group(unitB.id)
        .locator('[data-entity-id="' + op.tasks[1].id + '"]')
        .count(),
      1,
    );
    assert(await group("unassigned").isVisible());
    assert(await group("objectives").isVisible());
    await button("Collapse all units").click();
    assert.equal(await group(unitA.id).getAttribute("open"), null);
    assert.equal(await group(unitB.id).getAttribute("open"), null);
    await capture("unit-tasks-collapsed");
    await group(unitA.id).locator("summary").click();
    await group(unitA.id)
      .getByRole("button", { name: "Add task for " + unitA.name, exact: true })
      .click();
    const newTask = group(unitA.id).getByLabel("Task", { exact: true }).last();
    await newTask.fill("Fictional per-unit task");
    await group(unitA.id)
      .getByLabel("Assigned unit", { exact: true })
      .last()
      .selectOption(unitB.id);
    assert.equal(
      await group(unitA.id)
        .locator('section[aria-label^="Tasks for "] .task-record-summary')
        .count(),
      op.tasks.filter((t) => t.unitId === unitA.id).length,
    );
    assert(
      (
        await group(unitB.id)
          .getByLabel("Task", { exact: true })
          .evaluateAll((nodes) => nodes.map((n) => n.value))
      ).includes("Fictional per-unit task"),
    );
    await group(unitA.id)
      .locator('[data-entity-id="' + shared + '"] .task-record-summary')
      .click();
    await group(unitA.id)
      .locator('[data-entity-id="' + shared + '"]')
      .getByLabel("Objective name", { exact: true })
      .fill("Fictional shared objective revised");
    assert.equal(
      await group(unitB.id)
        .locator('[data-entity-id="' + shared + '"]')
        .locator(".task-record-summary span")
        .innerText(),
      "Fictional shared objective revised",
    );
    await save();
    const saved = (await load(modern.id)).operation;
    assert.equal(saved.objectives.length, op.objectives.length);
    assert.equal(saved.objectives.filter((o) => o.id === shared).length, 1);
    assert.equal(
      saved.tasks.find((t) => t.name === "Fictional per-unit task").unitId,
      unitB.id,
    );
    assert.equal(saved.tasks.length, op.tasks.length + 1);
    await page.setViewportSize({ width: 1120, height: 900 });
    await editor()
      .locator(".workspace")
      .evaluate((el) => el.scrollTo(0, 0));
    await capture("unit-tasks-expanded-1120");
    pass(
      "Unit task groups collapse independently; adding and reassigning tasks preserves IDs and shared objectives edit one canonical record",
    );
    await navGlobal("Dashboard");
    await openOperation(page, legacy.id);
    await navigateOperation(page, "Task organization");
    await editor()
      .getByLabel("Unit name 1", { exact: true })
      .fill("Fictional starter renamed");
    await editor()
      .getByRole("heading", { name: "Units & relationships", exact: true })
      .waitFor();
    await save();
    assert.equal(
      (await load(legacy.id)).operation.units[0].name,
      "Fictional starter renamed",
    );
    pass(
      "Legacy starter operations retain one usable Task Organization entry; unit edits do not leave the annex",
    );
    await close();
    await launch();
    await openOperation(page, modern.id);
    await navigateOperation(page, "Tasks & objectives");
    await button("Expand all units").click();
    assert.equal(
      await editor()
        .locator('section[aria-label^="Objectives for "] .task-record-summary')
        .filter({ hasText: "Fictional shared objective revised" })
        .count(),
      2,
    );
    assert.equal(
      (await load(modern.id)).operation.tasks.find(
        (t) => t.name === "Fictional per-unit task",
      ).unitId,
      unitB.id,
    );
    assert.equal(
      (await call("symbols", { type: "get", kind: "ORBAT", id: mapId })).orbat
        .layout.commandLevels,
      1,
    );
    await close();
    assert.deepEqual(errors, []);
    pass(
      "Normal offline clean exit and reopen preserve imported ORBAT settings and unit-grouped tasks with no renderer errors",
    );
  } catch (e) {
    write(e);
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
    throw e;
  } finally {
    if (app) await app.close();
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
