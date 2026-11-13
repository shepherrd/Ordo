// Render the main authoring surfaces in an isolated fictional workspace.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");
const { openOperation } = require("./smoke-global.cjs");

(async () => {
  const themes = process.env.ORDO_AUDIT_THEMES?.split(",") || [
    "forest",
    "ocean",
    "sand",
    "plum",
    "midnight",
    "charcoal",
    "pine",
    "ember",
  ];
  const folder = path.resolve(".test-data", "visual-themes-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  console.log(folder);
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const evidence = {
    captures: [],
    errors: [],
    checks: [],
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
  let app, page, currentTheme;
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(evidence, null, 2),
    );
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const nav = (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const scrollTop = () =>
    page.evaluate(() => {
      for (const el of document.querySelectorAll(
        ".global-workspace,.workspace,.work-area",
      ))
        el.scrollTop = 0;
    });
  const capture = async (name, focus, narrow = false, scrolled = false) => {
    for (const width of narrow ? [1440, 1050] : [1440]) {
      await page.setViewportSize({
        width,
        height: width === 1050 ? 820 : 1000,
      });
      await scrollTop();
      if (focus)
        await page
          .locator(focus)
          .filter({ visible: true })
          .first()
          .evaluate((el) => el.scrollIntoView({ block: "start" }));
      if (scrolled)
        await page.locator("main.workspace:visible").evaluate((el) => {
          el.scrollTop = Math.min(240, el.scrollHeight - el.clientHeight);
        });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(160);
      const metrics = await page.evaluate(() => {
        const visible = (el) => {
          if (!el.checkVisibility()) return false;
          const r = el.getBoundingClientRect();
          return r.width && r.height && r.top < innerHeight && r.bottom > 0;
        };
        const describe = (el) => ({
          tag: el.tagName,
          class: el.className,
          text: (el.getAttribute("aria-label") || el.textContent || "")
            .trim()
            .slice(0, 100),
        });
        const rgb = (value) => {
          const components = (value.match(/[\d.]+/g) || []).map(Number);
          return value.startsWith("color(srgb ")
            ? components.map((v, i) => (i < 3 ? v * 255 : v))
            : components;
        };
        const blend = (front, back) =>
          front
            .slice(0, 3)
            .map(
              (v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)),
            );
        const bg = (el) => {
          if (!el) return [255, 255, 255];
          const value = rgb(getComputedStyle(el).backgroundColor);
          return blend(
            value,
            value[3] === 1 || value.length === 3
              ? [255, 255, 255]
              : bg(el.parentElement),
          );
        };
        const lum = (c) =>
          c
            .slice(0, 3)
            .map((v) => v / 255)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const contrast = [];
        for (const el of document.querySelectorAll("body *")) {
          if (
            !(el instanceof HTMLElement) ||
            !visible(el) ||
            el.closest('svg,.graphic-canvas,[disabled],[aria-hidden="true"]')
          )
            continue;
          if (
            ![...el.childNodes].some(
              (n) => n.nodeType === 3 && n.textContent.trim(),
            ) &&
            !el.matches("input,select,textarea")
          )
            continue;
          if (
            el.matches("select option,input[type=checkbox],input[type=color]")
          )
            continue;
          const css = getComputedStyle(el);
          if (css.opacity !== "1") continue;
          const placeholder =
            el.matches("input[placeholder],textarea[placeholder]") && !el.value;
          const textColor = placeholder
            ? getComputedStyle(el, "::placeholder").color
            : css.color;
          const back = bg(el),
            front = blend(rgb(textColor), back);
          const a = lum(front),
            b = lum(back),
            ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          const large =
            parseFloat(css.fontSize) >= 24 ||
            (parseFloat(css.fontSize) >= 18.66 &&
              parseInt(css.fontWeight) >= 700);
          if (ratio < (large ? 3 : 4.5) - 0.02)
            contrast.push({
              ...describe(el),
              ratio: +ratio.toFixed(2),
              foreground: textColor,
              placeholder,
              background: back,
            });
        }
        const overflow = [
          ...document.querySelectorAll(
            "input,select,button,.panel,.field-grid,.two-columns,.button-row,.builder-dialog",
          ),
        ]
          .filter(visible)
          .filter((el) => {
            if (
              el.closest(
                ".table-scroll,.graphic-canvas,.exchange-table,.builder-product-list",
              )
            )
              return false;
            const r = el.getBoundingClientRect();
            return r.right > innerWidth + 2 || r.left < -2;
          })
          .map(describe);
        const filters = [
          ...document.querySelectorAll(".browse-filters,.review-filters"),
        ]
          .filter(visible)
          .map((group) =>
            [...group.querySelectorAll("label.field")].map((el) => ({
              label: el.textContent.trim(),
              top: el.getBoundingClientRect().top,
              inputTop: el
                .querySelector("input,select")
                ?.getBoundingClientRect().top,
            })),
          );
        const covered = [];
        const controls = [
          ...document.querySelectorAll(
            "button,input,select,textarea,[contenteditable=true]",
          ),
        ].filter(visible);
        for (const el of controls) {
          if (el.closest("[inert]") || el.getBoundingClientRect().width < 10)
            continue;
          const r = el.getBoundingClientRect();
          let left = Math.max(r.left, 0),
            right = Math.min(r.right, innerWidth),
            top = Math.max(r.top, 0),
            bottom = Math.min(r.bottom, innerHeight);
          for (
            let parent = el.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent),
              bounds = parent.getBoundingClientRect();
            if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
              left = Math.max(left, bounds.left);
              right = Math.min(right, bounds.right);
            }
            if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
              top = Math.max(top, bounds.top);
              bottom = Math.min(bottom, bounds.bottom);
            }
          }
          if (right - left < 8 || bottom - top < 8) continue;
          const hit = [0.2, 0.5, 0.8]
            .map((fraction) =>
              document.elementFromPoint(
                (left + right) / 2,
                top + (bottom - top) * fraction,
              ),
            )
            .find(
              (target) =>
                target &&
                !el.contains(target) &&
                !target.contains(el) &&
                !target.closest(".modal-backdrop"),
            );
          if (hit)
            covered.push({
              ...describe(el),
              by: describe(hit),
              box: [r.x, r.y, r.width, r.height],
            });
        }
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          overflow,
          contrast,
          filters,
          covered,
        };
      });
      const file = `${currentTheme}-${name}-${width}.png`;
      await page.screenshot({ path: path.join(folder, file) });
      evidence.captures.push({
        file,
        theme: currentTheme,
        page: name,
        ...metrics,
      });
      write();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
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
    const initial = await call("execute", { type: "load" });
    const army = initial.doctrines.find((d) =>
      /US Army Orders/i.test(d.displayName),
    );
    let op = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL Operation Lantern — North Relief Group",
        demo: true,
        ...(army
          ? { configuration: { id: army.doctrineVersionId, version: 1 } }
          : {}),
      })
    ).operation;
    op.tasks[0].purpose =
      "Coordinate the fictional relief effort and confirm personnel readiness.";
    op = (
      await call("execute", {
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      })
    ).operation;
    const sourceState = await call("execute", {
      type: "load",
      operationId: op.id,
    });
    const orderProfile = sourceState.profiles.find(
      (p) => p.product === "opord",
    );
    const generated = await call("execute", {
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: orderProfile.id, version: orderProfile.version },
      publicationId: null,
    });
    await call("office", {
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      source: {
        kind: "order",
        exportId: generated.exports[0].id,
        options: { paper: "Letter", orientation: "portrait" },
      },
    });
    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "38th Mobile Infantry Division — fictional",
      })
    ).symbol;
    symbol.definition.amplifiers.uniqueDesignation =
      "38th Mobile Infantry Division";
    await call("symbols", {
      type: "save-symbol",
      value: symbol,
      expected: symbol.contentVersion,
    });
    let tree = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional North Relief Group",
      })
    ).orbat;
    tree.nodes = Array.from({ length: 7 }, (_, i) =>
      fixtureOrbatUnit(
        i ? randomUUID() : tree.rootNodeId,
        i
          ? `Fictional ${i} ${i % 2 ? "Medical and Relief Coordination Company" : "Infantry Company"}`
          : "Fictional North Division",
      ),
    );
    tree.nodes.forEach((n, i) => {
      n.parentNodeId = i ? tree.rootNodeId : null;
      n.unit.symbol = { definition: symbol.definition, source: null };
    });
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    let org = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "Fictional North Division",
      })
    ).profile;
    org.orbatWorkspace = { orbatId: tree.versionId, profiles: [] };
    org = await call("organizations", {
      type: "save",
      profile: org,
      expectedContentVersion: org.contentVersion,
    });
    await nav("Organizations");
    await page
      .locator(`[data-unit-profile-version="${org.unitProfileVersionId}"]`)
      .click();
    await button("Staff & roles").click();
    await button("Add staff section").click();
    await field("Section name 1").fill(
      "Headquarters personnel and coordination",
    );
    await button(
      "Add position to Headquarters personnel and coordination",
    ).click();
    await field("Position title").fill("Commander");
    await field("Person filling this role").fill("Alex Example");
    await field("Rank / grade").fill("Colonel");
    await field("Position description").fill(
      "Coordinates the fictional formation and its personnel.",
    );
    await button("Save organization").click();
    await clean();
    await nav("Doctrines");
    await field("New doctrine name").fill("Fictional visual review doctrine");
    await button("New doctrine").click();
    await clean();
    for (const id of themes) {
      currentTheme = id;
      console.log("Reviewing " + id);
      await nav("Settings");
      await field("Color theme").selectOption(id);
      await capture("settings", undefined, true);
      await capture(
        "settings-backup",
        ".panel:has-text('Local backup & restore')",
      );
      await nav("Dashboard");
      await capture("dashboard", undefined, true);
      await button("Create operation").click();
      await capture("new-operation-dialog", undefined, true);
      await page.keyboard.press("Escape");
      await nav("Operations");
      await capture("operations", undefined, true);
      await nav("Organizations");
      await page
        .locator(`[data-unit-profile-version="${org.unitProfileVersionId}"]`)
        .click();
      await button("Identity").click();
      await capture("organizations", undefined, true);
      for (const tab of [
        "Identity",
        "ORBAT",
        "Staff & roles",
        "Symbol",
        "Defaults",
        "Assets",
      ]) {
        await page
          .getByRole("group", { name: "Organization pages" })
          .getByRole("button", { name: tab, exact: true })
          .click();
        if (tab === "ORBAT")
          await page
            .locator(
              '.organization-orbat-map .graphic-canvas[aria-busy="false"] svg',
            )
            .first()
            .waitFor();
        if (tab === "Symbol") await button("Choose symbol").waitFor();
        await capture(
          "organization-" + tab.replaceAll(/[^a-z]/gi, "").toLowerCase(),
          ".panel:has(.organization-tabs)",
          true,
        );
        await capture(
          "organization-" +
            tab.replaceAll(/[^a-z]/gi, "").toLowerCase() +
            "-scrolled",
          undefined,
          true,
          true,
        );
        if (tab === "ORBAT") {
          await page
            .getByRole("region", { name: "Selected unit profile" })
            .getByRole("tab", { name: "Staff & roles", exact: true })
            .click();
          await capture(
            "organization-readonly-staff",
            ".organization-unit-profile",
            true,
          );
          await page
            .getByRole("region", { name: "Selected unit profile" })
            .getByRole("tab", { name: "Information", exact: true })
            .click();
        }
      }
      await nav("Doctrines");
      for (const tab of [
        "General",
        "Structure",
        "Products / Modules",
        "Staff",
      ]) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await capture(
          "doctrine-" + tab.split(" ")[0].toLowerCase(),
          undefined,
          true,
        );
      }
      await nav("Symbols & ORBATs");
      await page
        .getByRole("tab", { name: "Symbol editor", exact: true })
        .click();
      await page.locator(`[data-symbol-id="${symbol.versionId}"]`).click();
      await page
        .locator('.workbench-current .graphic-canvas[aria-busy="false"] svg')
        .waitFor();
      await capture("symbol-editor", undefined, true);
      await button(/^Main icon:/).click();
      await page
        .locator('.catalog-results[aria-busy="false"] svg')
        .first()
        .waitFor();
      await capture("symbol-selector", undefined, true);
      await page.keyboard.press("Escape");
      await button("FM Dictionary").click();
      await capture("fm-dictionary", undefined, true);
      await button("Close").click();
      await page.getByRole("tab", { name: "ORBAT maps", exact: true }).click();
      await field("ORBAT map").selectOption(tree.versionId);
      await page
        .locator(
          '[aria-label="Interactive ORBAT diagram"]:visible .graphic-canvas[aria-busy="false"] svg',
        )
        .first()
        .waitFor();
      await capture("orbat", undefined, true);
      await button("Expand diagram").click();
      await capture("orbat-expanded", undefined, true);
      await page.keyboard.press("Escape");
      await button("Import JSON").click();
      await capture("orbat-import", undefined, true);
      await button("Close").click();
      await button("Export").click();
      await capture("orbat-export", undefined, true);
      await button("Close").click();
      await nav("Library");
      await capture("library", undefined, true);
      await nav("Dashboard");
      await openOperation(page, op.id);
      const opnav = page.getByRole("navigation", {
        name: "Operation navigation",
      });
      for (const name of [
        "Overview",
        "Tasks & objectives",
        "Phases",
        "Timeline",
        "Base order",
        "Whiteboards",
        "Planning progress",
        "Signal data",
        "Package composer",
        "Export studio",
        "Publications",
        "History & changes",
        "Validation",
      ]) {
        await opnav
          .getByRole("button", {
            name: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
          })
          .click();
        if (
          name === "Whiteboards" &&
          id === themes[0] &&
          (await button("New whiteboard").count())
        ) {
          await button("New whiteboard").click();
          await button("Add note").click();
          await page.keyboard.press("Escape");
          await button("Save revision").click();
          await clean();
        }
        if (name === "Export studio")
          await page
            .locator(
              "[data-operation-editor]:not([hidden]) iframe.document-frame",
            )
            .waitFor();
        if (name === "Export studio") {
          await field("File format").selectOption("DOCX");
          await capture("word-exports", ".word-exports", true);
          const outputOptions = page
            .locator(".document-output:visible")
            .first();
          if ((await outputOptions.getAttribute("open")) === null)
            await outputOptions.locator("summary").click();
          await capture("saved-export-options", ".document-output", true);
        }
        await capture(
          "operation-" + name.replaceAll(/[^a-z]/gi, "").toLowerCase(),
          undefined,
          true,
        );
        if (name === "History & changes") {
          await button("Current saved vs previous").click();
          const baseline = field("Baseline saved endpoint");
          await baseline.selectOption({
            index: (await baseline.locator("option").count()) - 1,
          });
          await button("Compare saved states").click();
          await page.locator(".review-change").first().waitFor();
          await capture("change-review", ".review-change", true);
          await capture("change-review-scrolled", undefined, true, true);
        }
        if (name === "Overview")
          await capture("operation-inspector", ".inspector", true);
      }
      await page
        .locator(".operation-sidebar:visible")
        .getByRole("button", { name: /Configuration/ })
        .click();
      await capture("operation-configuration", undefined, true);
      await capture("document-header", ".document-layout-fields", true);
      await capture(
        "document-footer",
        ".document-layout-fields:has(legend:text-is('Footer'))",
        true,
      );
      await opnav.locator(".doctrine-select").first().click();
      await capture("task-organization", undefined, true);
      if (await button("ORBAT view").count()) {
        await button("ORBAT view").click();
        await page
          .locator(
            '.orbat-canvas-workspace:visible .graphic-canvas[aria-busy="false"] svg',
          )
          .first()
          .waitFor();
        await capture("operation-orbat", undefined, true);
      }
      // Every annex entry is visited for the first light/dark pair; shared controls
      // and layout are covered by the full route matrix in the remaining palettes.
      if (["forest", "charcoal"].includes(id)) {
        const count = await opnav.locator(".doctrine-select").count();
        for (let i = 1; i < count; i++) {
          await opnav.locator(".doctrine-select").nth(i).click();
          await capture("annex-" + i, undefined, true);
        }
      }
      await nav("Dashboard");
      await clean();
      evidence.checks.push(
        id + ": full route matrix rendered at desktop and narrow widths",
      );
      write();
    }
    assert.deepEqual(evidence.errors, []);
    const proc = app.process();
    await app.close();
    app = null;
    assert.equal(proc.exitCode, 0);
    evidence.checks.push("No renderer errors; normal offline exit");
    if (process.argv.includes("--verify")) {
      assert(
        evidence.captures.every(
          (c) => c.documentWidth <= c.width + 1 && !c.overflow.length,
        ),
        "Unexpected horizontal overflow",
      );
      assert(
        evidence.captures.every((c) => !c.contrast.length),
        "Text contrast regression",
      );
      assert(
        evidence.captures.every((c) => !c.covered.length),
        "Overlapping controls",
      );
      for (const c of evidence.captures)
        for (const group of c.filters)
          for (const a of group)
            for (const b of group)
              if (Math.abs(a.top - b.top) < 2)
                assert(
                  Math.abs(a.inputTop - b.inputTop) < 2,
                  "Filter misalignment in " + c.file,
                );
      evidence.checks.push(
        "No horizontal overflow, overlapping controls, misaligned filter rows or low-contrast visible text across the captured matrix",
      );
    }
  } catch (e) {
    evidence.failure = String(e.stack || e);
    console.error(e);
    process.exitCode = 1;
    if (page) {
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
      await page
        .locator("body")
        .innerText()
        .then((text) =>
          fs.writeFileSync(path.join(folder, "failure.txt"), text),
        )
        .catch(() => {});
    }
  } finally {
    if (app) await app.close();
    write();
    console.log(folder);
  }
})();
