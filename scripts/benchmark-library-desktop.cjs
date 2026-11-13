// Isolated, fictional desktop workload. Timings and coverage run separately.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");

(async () => {
  const folder = path.resolve(
    ".test-data",
    "optimization-library-" + randomUUID(),
  );
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const evidence = {
    label: process.argv[2] || "measurement",
    measurements: {},
    checks: [],
    errors: [],
    buildFiles: fs
      .readdirSync("out", { recursive: true })
      .filter((p) => fs.statSync(path.join("out", p)).isFile())
      .sort()
      .map((p) => ({
        path: p,
        sha256: createHash("sha256")
          .update(fs.readFileSync(path.join("out", p)))
          .digest("hex"),
      })),
  };
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "measurement.json"),
      JSON.stringify(evidence, null, 2),
    );
  const summary = (samples) => {
    const sorted = [...samples].sort((a, b) => a - b),
      middle = Math.floor(sorted.length / 2);
    return {
      samples,
      median:
        sorted.length % 2
          ? sorted[middle]
          : (sorted[middle - 1] + sorted[middle]) / 2,
    };
  };
  let app, page;
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const coverage = async (action) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.startPreciseCoverage", {
      callCount: true,
      detailed: false,
    });
    await action();
    const { result } = await cdp.send("Profiler.takePreciseCoverage");
    await cdp.send("Profiler.stopPreciseCoverage");
    await cdp.detach();
    return result
      .flatMap((r) => r.functions)
      .filter((f) =>
        /^(canonical(?:\$\d+)?|organizationDiagram|symbols|renderGraphic|cancelGraphic|projectReadableOrder|renderDocumentHtml)$/.test(
          f.functionName,
        ),
      )
      .map((f) => ({ function: f.functionName, calls: f.ranges[0].count }));
  };
  const pass = (name) => {
    evidence.checks.push(name);
    write();
    console.log("PASS " + name);
  };
  try {
    app = await electron.launch({
      env,
      args: [path.resolve("out/main/index.js")],
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
    const symbols = [];
    for (let i = 0; i < 30; i++)
      symbols.push(
        (
          await call("symbols", {
            type: "new",
            kind: "SYMBOL",
            name: "Fictional library symbol " + String(i).padStart(2, "0"),
          })
        ).symbol,
      );
    await nav("Symbols & ORBATs");
    const list = page.getByRole("region", { name: "Saved symbols list" });
    await list.locator("button").nth(29).waitFor({ state: "attached" });
    const first = list.locator("button").first();
    await first.locator("svg").waitFor();
    const firstId = await first.getAttribute("data-symbol-id");
    const originalSvg = await first
      .locator("svg")
      .evaluate((el) => el.outerHTML);
    const scrollAway = async () => {
      // Placeholder heights can change as cards load. Keep the last card in view.
      for (let i = 0; i < 30; i++) {
        await list.locator("button").last().scrollIntoViewIfNeeded();
        if (await list.locator("button").last().locator("svg").count()) break;
        await page.waitForTimeout(100);
      }
      await list.locator("button").last().locator("svg").waitFor();
      await page.waitForTimeout(250); // Allow visibility observers/debounce to settle.
    };
    const returnToFirst = async () => {
      await list.evaluate((el) => {
        window.__libraryReturnStarted = performance.now();
        el.scrollTop = 0;
      });
      await page.waitForFunction(
        () =>
          !!document.querySelector(
            ".workbench-symbol-list button:first-child svg",
          ),
        {},
        { polling: "raf" },
      );
      await paint();
      return page.evaluate(
        () => performance.now() - window.__libraryReturnStarted,
      );
    };
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await scrollAway();
      samples.push(await returnToFirst());
    }
    evidence.measurements.savedSymbolReturnMs = summary(samples);
    evidence.symbolScrollCoverage = await coverage(async () => {
      for (let i = 0; i < 3; i++) {
        await scrollAway();
        await returnToFirst();
      }
    });
    assert.equal(
      await first.locator("svg").evaluate((el) => el.outerHTML),
      originalSvg,
    );
    pass(
      "Previously viewed saved symbols return with identical artwork after repeated independent-list scrolling",
    );
    const updated = (
      await call("symbols", { type: "get", kind: "SYMBOL", id: firstId })
    ).symbol;
    updated.definition.appearance.fillColor = "#ff00ff";
    await call("symbols", {
      type: "save-symbol",
      value: updated,
      expected: updated.contentVersion,
    });
    await nav("Dashboard");
    await nav("Symbols & ORBATs");
    await first.locator("svg").waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector(".workbench-symbol-list button:first-child svg")
        ?.outerHTML.includes("#ff00ff"),
    );
    pass(
      "A saved definition change invalidates the thumbnail when the library refreshes",
    );

    let tree = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional large organization",
      })
    ).orbat;
    tree.nodes = Array.from({ length: 255 }, (_, i) =>
      fixtureOrbatUnit(
        i ? randomUUID() : tree.rootNodeId,
        "Fictional unit " + i,
      ),
    );
    tree.nodes.forEach((n, i) => {
      n.parentNodeId = i ? tree.nodes[Math.floor((i - 1) / 2)].nodeId : null;
      n.unit.symbol = { definition: symbols[0].definition, source: null };
    });
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    let organization = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "Fictional performance organization",
      })
    ).profile;
    organization.orbatWorkspace = {
      orbatId: tree.versionId,
      profiles: tree.nodes.slice(1).map((n) => {
        const sectionId = randomUUID();
        return {
          orbatId: tree.versionId,
          nodeId: n.nodeId,
          identity: n.unit.identity,
          staff: {
            sections: [
              {
                sectionId,
                name: "Headquarters",
                description: "Fictional benchmark staff",
              },
            ],
            positions: Array.from({ length: 8 }, (_, i) => ({
              positionId: randomUUID(),
              sectionId,
              title: "Fictional role " + i,
              shortTitle: "",
              functionalRole: null,
              defaultForRole: false,
              description: "Fictional personnel record",
              notes: "",
              rankGrade: "",
              incumbent: null,
            })),
          },
        };
      }),
    };
    organization = await call("organizations", {
      type: "save",
      profile: organization,
      expectedContentVersion: organization.contentVersion,
    });
    await nav("Organizations");
    await page
      .locator(
        `[data-unit-profile-version="${organization.unitProfileVersionId}"]`,
      )
      .click();
    const tab = (name) =>
      page
        .getByRole("group", { name: "Organization pages" })
        .getByRole("button", { name, exact: true });
    const switchTab = async (name) => {
      const elapsed = await tab(name).evaluate(async (el) => {
        const start = performance.now();
        el.click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return performance.now() - start;
      });
      assert.equal(await tab(name).getAttribute("aria-pressed"), "true");
      return elapsed;
    };
    const tabSamples = [];
    for (let i = 0; i < 12; i++)
      tabSamples.push(await switchTab(i % 2 ? "Identity" : "Defaults"));
    evidence.measurements.organizationTabMs = summary(tabSamples);
    evidence.organizationTabCoverage = await coverage(async () => {
      for (let i = 0; i < 6; i++)
        await switchTab(i % 2 ? "Identity" : "Defaults");
    });
    assert(await button("Save organization").isDisabled());
    await page
      .getByLabel("Full Designation", { exact: true })
      .filter({ visible: true })
      .fill("");
    await page
      .getByRole("alert")
      .filter({ hasText: /Full|Designation|small|character/i })
      .first()
      .waitFor();
    await button("Discard edits").click();
    await clean();
    pass(
      "Organization tab changes retain a clean draft; actual invalid edits still show validation and discard correctly",
    );
    await tab("ORBAT").click();
    const diagram = page.locator(
      '.organization-orbat-map .graphic-canvas[aria-busy="false"] [data-unit-id]',
    );
    await diagram.nth(254).waitFor({ state: "attached" });
    const selectionSamples = [];
    for (const n of tree.nodes.slice(1, 13))
      selectionSamples.push(
        await page.evaluate(async (id) => {
          const start = performance.now();
          document
            .querySelector(`.organization-orbat-map [data-unit-id="${id}"]`)
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
          return performance.now() - start;
        }, n.nodeId),
      );
    evidence.measurements.organizationSelectionMs = summary(selectionSamples);
    evidence.selectionAttributeWrites = await page.evaluate(
      async (ids) => {
        const canvas = document.querySelector(
          ".organization-orbat-map .graphic-canvas",
        );
        let writes = 0;
        const observer = new MutationObserver((records) => {
          writes += records.filter((r) =>
            r.target.hasAttribute("data-unit-id"),
          ).length;
        });
        observer.observe(canvas, {
          attributes: true,
          subtree: true,
          attributeFilter: ["role", "aria-label", "aria-pressed", "tabindex"],
        });
        for (const id of ids) {
          canvas
            .querySelector(`[data-unit-id="${id}"]`)
            .dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        }
        observer.disconnect();
        return writes;
      },
      tree.nodes.slice(20, 26).map((n) => n.nodeId),
    );
    const map = page.locator(".organization-orbat-map");
    assert.equal(
      await map.locator('[data-unit-id][aria-pressed="true"]').count(),
      1,
    );
    assert.equal(await map.locator('[data-unit-id][tabindex="0"]').count(), 1);
    await map.locator('[data-unit-id][tabindex="0"]').press("Home");
    assert.equal(
      await map.locator("[data-unit-id]").first().getAttribute("aria-pressed"),
      "true",
    );
    await map.locator("[data-unit-id]").first().press("End");
    assert.equal(
      await map.locator("[data-unit-id]").last().getAttribute("aria-pressed"),
      "true",
    );
    pass(
      "Repeated ORBAT selections preserve one selected keyboard stop and Home/End navigation",
    );
    await button("Expand diagram").click();
    await map
      .locator(`[data-unit-id="${tree.nodes[26].nodeId}"]`)
      .dispatchEvent("click");
    await paint();
    assert.equal(
      await map
        .locator('[data-unit-id][aria-pressed="true"]')
        .getAttribute("data-unit-id"),
      tree.nodes[26].nodeId,
    );
    await button("Compact diagram").click();
    await paint();
    assert.equal(
      await map
        .locator('[data-unit-id][tabindex="0"]')
        .getAttribute("data-unit-id"),
      tree.nodes[26].nodeId,
    );
    assert.equal(await map.locator("[data-unit-hit-area]").count(), 255);
    pass(
      "Expanding and restoring the diagram rebuilds hit areas and preserves selected-unit keyboard focus",
    );
    await page
      .locator(
        `.organization-orbat-map [data-unit-id="${tree.nodes[3].nodeId}"]`,
      )
      .dispatchEvent("click");
    await page
      .getByRole("region", { name: "Selected unit profile" })
      .getByRole("heading", { name: "Fictional unit 3", exact: true })
      .waitFor();
    await page.getByRole("tab", { name: "Staff & roles", exact: true }).click();
    await button("Edit staff & roles").click();
    const inspector = page.getByRole("region", {
      name: "Selected unit profile",
    });
    const section = inspector
      .locator(".staff-section > .staff-disclosure-heading")
      .first();
    if ((await section.getAttribute("aria-expanded")) === "false")
      await section.click();
    const position = inspector
      .locator(".staff-position > .staff-disclosure-heading")
      .first();
    if ((await position.getAttribute("aria-expanded")) === "false")
      await position.click();
    const positionTitle = page
      .getByLabel("Position title", { exact: true })
      .filter({ visible: true });
    const editStaffTitle = (value) =>
      positionTitle.evaluate(async (el, value) => {
        const start = performance.now();
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return performance.now() - start;
      }, value);
    const staffSamples = [];
    for (let i = 0; i < 12; i++)
      staffSamples.push(await editStaffTitle("Fictional commander " + i));
    evidence.measurements.organizationStaffEditMs = summary(staffSamples);
    evidence.staffEditCoverage = await coverage(async () => {
      for (let i = 0; i < 5; i++)
        await editStaffTitle("Updated fictional commander " + i);
    });
    await button("Save organization").click();
    await clean();
    const stored = await call("organizations", {
      type: "get",
      id: organization.unitProfileVersionId,
    });
    assert.equal(
      stored.orbatWorkspace.profiles.find(
        (p) => p.nodeId === tree.nodes[3].nodeId,
      ).staff.positions[0].title,
      "Updated fictional commander 4",
    );
    assert.equal(
      stored.orbatWorkspace.profiles.find(
        (p) => p.nodeId === tree.nodes[4].nodeId,
      ).staff.positions[0].title,
      "Fictional role 0",
    );
    pass(
      "A 255-unit ORBAT selects the correct profile and saves staff edits without altering another unit",
    );
    await button("View in ORBAT").click();
    await page
      .locator(
        '.organization-orbat-map .graphic-canvas[aria-busy="false"] [data-unit-id]',
      )
      .nth(254)
      .waitFor({ state: "attached" });
    const readOnlyStaff = page.locator(".organization-staff-view");
    await readOnlyStaff
      .getByText("Updated fictional commander 4", { exact: true })
      .waitFor();
    assert.equal(
      await readOnlyStaff
        .locator('input,textarea,select,[contenteditable="true"]')
        .count(),
      0,
    );
    pass(
      "Staff editing retains the direct return to the ORBAT and its updated read-only staff summary",
    );
    assert.deepEqual(evidence.errors, []);
  } catch (e) {
    evidence.failure = String(e);
    write();
    if (page)
      fs.writeFileSync(
        path.join(folder, "failure.html"),
        await page.content().catch(() => ""),
      );
    if (page)
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
    throw e;
  } finally {
    if (app) {
      const proc = app.process();
      await app.close();
      evidence.exitCode = proc.exitCode;
    }
    write();
    console.log(path.join(folder, "measurement.json"));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
