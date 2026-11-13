// Current development UI matrix in an isolated fictional workspace.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
const { openOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(".test-data", "full-polish-" + uid());
  fs.mkdirSync(folder, { recursive: true });
  const env = {
    ...process.env,
    ORDO_DATA_DIR: path.join(folder, "workspace"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  // Review actual window rendering, including sandboxed document previews.
  delete env.ORDO_HEADLESS;
  const checks = [],
    captures = [],
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
  let app, page, failure;
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          version: require("../package.json").version,
          buildFiles,
          checks,
          captures,
          errors,
          events,
          failure,
        },
        null,
        2,
      ),
    );
  const report = (name) => {
    checks.push(name);
    write();
    console.log("PASS " + name);
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
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const resize = async (width) => {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setContentSize(width, 900),
      width,
    );
  };
  const capture = async (name, width, bottom = false) => {
    await resize(width);
    await page.evaluate(async (bottom) => {
      await document.fonts.ready;
      for (const el of document.querySelectorAll(
        ".workspace,.main-content,.content-area",
      ))
        if (el.getBoundingClientRect().width)
          el.scrollTop = bottom ? el.scrollHeight : 0;
    }, bottom);
    if (name === "operation-large-orbat")
      await page
        .locator(".orbat-canvas-workspace:visible")
        .scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    const metrics = await page.evaluate(() => {
      const visible = (e) =>
        e.getBoundingClientRect().width && e.getBoundingClientRect().height;
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        filters: [...document.querySelectorAll(".browse-filters")]
          .filter(visible)
          .map((group) =>
            [...group.querySelectorAll("label.field")].map((l) => {
              const r = l.getBoundingClientRect(),
                c = l.querySelector("input,select")?.getBoundingClientRect();
              return {
                label: l.textContent.trim(),
                labelTop: r.top,
                inputTop: c?.top,
                inputBottom: c?.bottom,
              };
            }),
          ),
        overflow: [
          ...document.querySelectorAll(
            "input,select,button,.panel,.symbol-authoring",
          ),
        ]
          .filter(visible)
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return (
              r.right > innerWidth + 2 &&
              !e.closest(
                ".table-scroll,.graphic-canvas,.exchange-table,.builder-product-list",
              )
            );
          })
          .map((e) => ({
            text: (
              e.getAttribute("aria-label") ||
              e.textContent ||
              e.className
            ).slice(0, 100),
            right: e.getBoundingClientRect().right,
          }))
          .slice(0, 30),
      };
    });
    for (const group of metrics.filters)
      for (const a of group)
        for (const b of group)
          if (Math.abs(a.labelTop - b.labelTop) < 2)
            assert(
              Math.abs(a.inputTop - b.inputTop) < 2,
              "Filter alignment: " + a.label + " / " + b.label,
            );
    await app.evaluate(async ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      }),
    );
    const bytes = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      ).toPNG(),
    );
    const file = `${name}-${width}${bottom ? "-bottom" : ""}.png`;
    fs.writeFileSync(path.join(folder, file), Buffer.from(bytes));
    captures.push({ file, ...metrics });
    write();
  };
  const both = async (name) => {
    for (const width of [1500, 1120]) await capture(name, width);
    if (
      /^(organization-|doctrine-|military-symbols|symbol-appearance|saved-orbat|operation-configuration|operation-export)/.test(
        name,
      )
    )
      await capture(name, 1120, true);
  };
  const launch = async () => {
    events.push({ stage: "launch", at: new Date().toISOString() });
    write();
    app = await electron.launch({
      env,
      args: [path.resolve("out/main/index.js")],
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
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
    await clean();
    const proc = app.process(),
      pids = await app.evaluate(({ app }) =>
        app.getAppMetrics().map((m) => m.pid),
      );
    events.push({ stage: "normal-close", at: new Date().toISOString(), pids });
    await app.close();
    assert.equal(proc.exitCode, 0);
    app = null;
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
    events.push({ stage: "fully-exited", at: new Date().toISOString() });
    write();
  };
  try {
    await launch();
    const initial = await call("execute", { type: "load" });
    const config = initial.configurations.find((c) => /army/i.test(c.name));
    const army = initial.doctrines.find((d) =>
      /US Army Orders/i.test(d.displayName),
    );
    fs.writeFileSync(
      path.join(folder, "seed-options.json"),
      JSON.stringify(
        {
          configurations: initial.configurations.map((c) => ({
            id: c.id,
            name: c.name,
          })),
          doctrines: initial.doctrines.map((d) => ({
            id: d.doctrineVersionId,
            name: d.displayName,
          })),
        },
        null,
        2,
      ),
    );
    let op = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL Operation Testify — full visual review",
        demo: true,
        ...(army
          ? { configuration: { id: army.doctrineVersionId, version: 1 } }
          : config
            ? { configuration: { id: config.id, version: config.version } }
            : {}),
      })
    ).operation;
    const first = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL 38th Mobile Infantry Division",
      })
    ).symbol;
    first.definition.amplifiers.uniqueDesignation =
      "38th Mobile Infantry Division";
    await call("symbols", {
      type: "save-symbol",
      value: first,
      expected: first.contentVersion,
    });
    await call("symbols", {
      type: "new",
      kind: "SYMBOL",
      name: "FICTIONAL Medical Support Battalion — long gallery label",
    });
    const org = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "FICTIONAL 38th Mobile Infantry Division",
      })
    ).profile;
    // Populate a large canonical organization without adding another hierarchy.
    const template = structuredClone(op.units[0]);
    for (let i = 0; i < 48; i++)
      op.units.push({
        ...structuredClone(template),
        id: uid(),
        name: `FICTIONAL ${i + 1} ${i % 3 ? "Support Company" : "Long Designation Medical and Relief Coordination Battalion"}`,
        parentUnitId: i < 4 ? template.id : op.units[op.units.length - 4].id,
        inTaskOrganization: true,
      });
    op = (
      await call("execute", {
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      })
    ).operation;
    await nav("Organizations");
    await page
      .locator(`[data-profile-id="${org.unitProfileVersionId}"]`)
      .count()
      .then(async (count) => {
        if (count)
          await page
            .locator(`[data-profile-id="${org.unitProfileVersionId}"]`)
            .click();
        else
          await page.locator(".organizations-area .browse-row").first().click();
      });
    for (const tab of [
      "Identity",
      "Symbol",
      "Structure",
      "Staff",
      "Defaults",
      "Assets",
    ]) {
      await button(tab).click();
      await both("organization-" + tab.toLowerCase());
    }
    await nav("Doctrines");
    await field("New doctrine name").fill("FICTIONAL Reference Doctrine");
    await button("New doctrine").click();
    await clean();
    for (const tab of ["General", "Structure", "Products / Modules", "Staff"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await both("doctrine-" + tab.split(" ")[0].toLowerCase());
    }
    await nav("Military Symbols");
    await page.locator(`[data-symbol-id="${first.versionId}"]`).click();
    await page
      .locator(".symbol-browse-row .saved-symbol-thumbnail svg")
      .first()
      .waitFor();
    assert.equal(await field("SIDC").count(), 0, "Raw code starts collapsed");
    await both("military-symbols");
    await page.locator(".symbol-code-details > summary").click();
    const old = await field("SIDC").inputValue();
    await field("Code form").selectOption("LETTER");
    await button("Keep current symbol").click();
    assert.equal(await field("SIDC").inputValue(), old);
    await button("Reset symbol…").click();
    await page
      .getByRole("dialog", { name: "Reset symbol", exact: true })
      .waitFor();
    await both("symbol-reset-dialog");
    await button("Cancel reset").click();
    await page.locator(".symbol-code-details > summary").click();
    await page
      .locator("summary")
      .filter({ hasText: /^Appearance and markings$/ })
      .click();
    await both("symbol-appearance");
    report("saved-thumbnails-collapsed-code-and-cancel-safe-symbol-actions");
    await button("Browse built-in catalog").click();
    for (const collection of ["NUMERIC", "LEGACY", "FM"]) {
      await field("Catalog collection").selectOption(collection);
      await page
        .locator('.builtin-catalog-results[aria-busy="false"]')
        .waitFor();
      await both("builtin-" + collection.toLowerCase());
    }
    await button("Close built-in catalog").click();

    const savedOrbat = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "FICTIONAL Reference ORBAT",
      })
    ).orbat;
    await nav("ORBATs");
    await page.locator(`[data-orbat-id="${savedOrbat.versionId}"]`).click();
    await both("saved-orbat");
    await button("Replace symbol only").click();
    await page
      .getByRole("dialog", { name: "Choose symbol", exact: true })
      .waitFor();
    await both("symbol-picker");
    await button("Cancel symbol selection").click();
    for (const name of [
      "Dashboard",
      "Operations",
      "Organizations",
      "Doctrines",
      "Military Symbols",
      "ORBATs",
      "Library",
      "Settings",
    ]) {
      await nav(name);
      await both("global-" + name.toLowerCase().replaceAll(" ", "-"));
    }
    await nav("Dashboard");
    await openOperation(page, op.id);
    const opnav = page.getByRole("navigation", {
      name: "Operation navigation",
    });
    for (const name of [
      "Overview",
      "Task organization",
      "Tasks & objectives",
      "Phases",
      "Timeline",
      "Base order",
      "Signal data",
      "Package composer",
      "Export studio",
      "Publications",
      "History & changes",
      "Validation",
    ]) {
      const target = opnav.getByRole("button", {
        name:
          name === "Task organization"
            ? /^(?:A )?Task organization$/i
            : new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      });
      if (!(await target.count())) continue;
      await target.click();
      await both("operation-" + name.toLowerCase().replace(/[^a-z]+/g, "-"));
    }
    await page
      .locator(".operation-sidebar:visible")
      .getByRole("button", { name: /Configuration/ })
      .click();
    await both("operation-configuration");
    const annexes = await opnav.locator(".doctrine-select").allTextContents();
    for (let i = 0; i < annexes.length; i++) {
      await opnav.locator(".doctrine-select").nth(i).click();
      await both("annex-" + String(i + 1).padStart(2, "0"));
    }
    await opnav
      .getByRole("button", { name: /^(?:A )?Task organization$/i })
      .click();
    await button("ORBAT view").click();
    await page
      .locator(
        '.orbat-canvas-workspace:visible .graphic-canvas[aria-busy="false"] svg',
      )
      .waitFor();
    await both("operation-large-orbat");
    await button("Expand diagram").click();
    await button("Show selected unit").click();
    await both("operation-orbat-expanded");
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "Graphic preview", exact: true })
      .waitFor({ state: "hidden" });
    assert(
      await button("Expand diagram").evaluate(
        (e) => e === document.activeElement,
      ),
      "Expanded diagram restores keyboard focus",
    );
    assert(
      captures.every((c) => c.documentWidth <= c.width + 1),
      "Page-level horizontal overflow",
    );
    report(
      "all-global-operation-and-editor-pages-captured-at-two-supported-widths",
    );
    await nav("Dashboard");
    await close();
    await launch();
    await close();
    assert.deepEqual(errors, []);
    report("normal-offline-clean-exit-reopen-and-no-renderer-errors");
  } catch (e) {
    failure = String(e.stack || e);
    write();
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (app)
      try {
        await app.close();
      } catch (e) {
        console.error("Normal cleanup failed", e);
      }
    write();
    console.log(folder);
  }
})();
