// Normal offline desktop acceptance. No diagnostic startup flags or service changes.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", `milestone6-catalog-ui-${uid()}`),
    packaged = process.argv.includes("--packaged");
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
    env,
    timeout: 60000,
    ...(packaged
      ? {
          executablePath:
            process.env.ORDO_PACKAGED_PATH ||
            path.resolve(
              "release",
              require("../package.json").version,
              "win-unpacked/Ordo.exe",
            ),
          args: [],
        }
      : { args: [path.resolve("out/main/index.js")] }),
  };
  let app, page;
  const checks = [],
    errors = [];
  const report = (step, note) => {
    checks.push({ step, note });
    console.log(`PASS ${step}: ${note}`);
  };
  const launch = async () => {
    app = await electron.launch(options);
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.context().setOffline(true);
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), packaged);
    assert(
      !app
        .process()
        .spawnargs.some((a) =>
          /NetworkService|NetworkChange|Defer.*Network/i.test(a),
        ),
    );
  };
  const close = async () => {
    // Discarding editor content may still leave recovery cleanup or a render
    // response pending. Close only after the full workspace acknowledges it.
    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    const process = app.process();
    await app.close();
    assert.equal(process.exitCode, 0);
    app = null;
  };
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const nav = async (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();

  try {
    await launch();
    const startupAssets = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((r) => r.name),
    );
    assert(
      !startupAssets.some((a) =>
        /SymbolEditor|MilitarySymbolsWorkspace|OrbatWorkspace|OrbatCanvas|flag-resources/.test(
          a,
        ),
      ),
    );
    report(
      "lazy-dashboard",
      "Fresh Dashboard does not request the Symbol/ORBAT editor or flag chunks",
    );
    await nav("Military Symbols");
    const button = (name) => page.getByRole("button", { name, exact: true }),
      field = (name) => page.getByLabel(name, { exact: true });
    await field("New symbol name").fill("FICTIONAL CATALOG ACCEPTANCE");
    await button("Create Saved Symbol").click();
    await field("Saved Symbol name").waitFor();
    const id = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: {
          search: "FICTIONAL CATALOG ACCEPTANCE",
          status: "DRAFT",
          offset: 0,
          limit: 10,
        },
      })
    ).page.items[0].versionId;
    const originalDefinitionId = (
      await call("symbols", { type: "get", kind: "SYMBOL", id })
    ).symbol.definition.definitionId;
    const all = [];
    for (let offset = 0; offset < 453; offset += 100)
      all.push(
        ...(
          await call("symbolCatalog", {
            type: "dictionary",
            search: "",
            category: "",
            offset,
            limit: 100,
          })
        ).dictionary.entries,
      );
    assert.equal(all.length, 453);
    assert.equal(
      all.filter((e) => e.availability === "UNAVAILABLE").length,
      23,
    );
    const unique = (e) => all.filter((x) => x.term === e.term).length === 1;
    const available = all.find((e) => e.availability === "MAPPED" && unique(e)),
      unavailable = all.find(
        (e) => e.availability === "UNAVAILABLE" && unique(e),
      ),
      discrepant = all.find(
        (e) => e.availability === "DISCREPANT" && unique(e),
      );
    assert(available && unavailable && discrepant);
    await button("Open FM dictionary").click();
    const findEntry = async (e) => {
      await field("Search FM dictionary").fill(e.term);
      const row = page.locator(".dictionary-entry").filter({
        has: page.getByRole("heading", {
          name: `${e.term} ${e.availability}`,
          exact: true,
        }),
      });
      await row.waitFor();
      return row;
    };
    let row = await findEntry(unavailable);
    assert(
      await row
        .getByRole("button", { name: "Open Example", exact: true })
        .isDisabled(),
    );
    assert(
      await row
        .getByRole("button", { name: "Apply component", exact: true })
        .isDisabled(),
    );
    row = await findEntry(discrepant);
    const detail = await row.innerText();
    assert(detail.includes(discrepant.citation.provenanceClass));
    for (const note of [
      ...discrepant.notes,
      ...discrepant.editorialIssues,
    ].filter(Boolean))
      assert(detail.includes(note));
    row = await findEntry(available);
    await row
      .getByRole("button", { name: "Open Example", exact: true })
      .click();
    await page.waitForFunction(
      (sidc) =>
        Array.from(document.querySelectorAll("input")).some(
          (e) => e.value === sidc,
        ),
      available.sidc,
    );
    assert.equal(await field("SIDC").inputValue(), available.sidc);
    await button("Close FM dictionary").click();
    report(
      "dictionary-provenance",
      "All 453 rows and 23 unavailable mappings remain; UI disables unavailable examples, displays discrepant notes/citation, and opens an explicitly selected mapped example",
    );

    await field("SIDC").fill("130310000012110000000000000000");
    await page.getByRole("button", { name: /^Common modifier 1:/ }).click();
    await page.locator(".catalog-results button").first().waitFor();
    const catalog = page.locator(".catalog-results button");
    const codes = await catalog.locator("b").allTextContents();
    const index = codes.findIndex((c) => c.length === 3 && c[0] !== "0");
    assert(index >= 0);
    const selected = codes[index];
    await catalog.nth(index).click();
    const numeric = await field("SIDC").inputValue();
    assert.equal(numeric[20], selected[0]);
    assert.equal(numeric.slice(16, 18), selected.slice(1));
    assert.equal(numeric.slice(21), "000000000");
    await page
      .locator("summary")
      .filter({ hasText: /^Appearance and compatibility marks$/ })
      .click();
    await field("Stack count").fill("2");
    await field("General stars").fill("1");
    await page
      .getByRole("combobox", { name: /^Reinforcement/ })
      .selectOption("+");
    await page.getByRole("combobox", { name: /^Signature/ }).selectOption("!");
    const flag = page.getByRole("combobox", { name: /^Flag(?:\s+None|$)/ });
    await flag.locator("option").nth(1).waitFor({ state: "attached" });
    const flagOptions = await flag
      .locator("option")
      .evaluateAll((es) =>
        es.map((e) => ({ id: e.value, name: e.textContent })),
      );
    const licensedFlag =
      flagOptions.find((f) => f.id && /United States|\bUS\b/i.test(f.name)) ||
      flagOptions.find((f) => f.id);
    assert(licensedFlag);
    await flag.selectOption(licensedFlag.id);
    await field("Designation").fill("FICTIONAL CATALOG UNIT");
    await button("Save symbol draft").click();
    await page
      .getByText("Saved structured symbol definition.", { exact: true })
      .waitFor();
    const saved = (await call("symbols", { type: "get", kind: "SYMBOL", id }))
      .symbol;
    assert.equal(saved.definition.definitionId, originalDefinitionId);
    assert.equal(saved.definition.compatibility.stack, 2);
    assert.equal(saved.definition.compatibility.flagId, licensedFlag.id);
    assert.equal(saved.definition.code.sidc, numeric);
    await page
      .locator('.graphic-canvas[aria-busy="false"] > div > svg')
      .waitFor();
    report(
      "numeric-compatibility",
      "Three-digit common modifier edits preserve split suffix positions; explicit stack, stars, reinforcement, signature and replacement flag remain structured fields under the same definition identity",
    );

    await page
      .getByRole("combobox", { name: /^Code form/ })
      .selectOption("LETTER");
    const legacyCode = "SFGPUCI-----USG";
    await field("SIDC").fill(legacyCode);
    await field("Legacy function").fill("U");
    assert.equal(await field("SIDC").inputValue(), legacyCode);
    await button("Apply Legacy function").click();
    await page
      .getByRole("region", { name: "Legacy symbol controls" })
      .getByRole("alert")
      .waitFor();
    assert.equal(await field("SIDC").inputValue(), legacyCode);
    await field("Legacy function").fill("UCI---");
    await field("Legacy identity").fill("H");
    await button("Apply Legacy identity").click();
    assert.equal(
      (await field("SIDC").inputValue()).slice(10),
      legacyCode.slice(10),
    );
    await page
      .locator("summary")
      .filter({ hasText: /^Legacy function catalog$/ })
      .click();
    const groups = page.getByRole("combobox", { name: /^Legacy group/ });
    assert.equal(await groups.locator("option").count(), 7);
    await page.locator(".catalog-row").first().waitFor();
    await page
      .locator(".catalog-row")
      .first()
      .getByRole("button", { name: "Apply legacy function", exact: true })
      .click();
    assert.equal(
      (await field("SIDC").inputValue()).slice(10),
      legacyCode.slice(10),
    );
    report(
      "legacy-fields",
      "Incomplete legacy edits remain local until Apply; invalid input is rejected; seven non-SOF groups are available and function/identity edits preserve suffix bytes",
    );

    const crosswalk = require("../src/application/legacy-crosswalk-v1.json");
    assert(crosswalk.entries.every((e) => /^S-[PAGSU]-/.test(e.key)));
    for (const status of ["DISCREPANT", "UNVERIFIED"]) {
      const source = crosswalk.entries.find(
        (e) =>
          e.status === status &&
          e.key.startsWith("S-") &&
          "PAGSU".includes(e.key[2]),
      );
      const code = `${source.key[0]}F${source.key[2]}P${source.key.slice(4)}--USG`;
      await field("SIDC").fill(code);
      await button("Inspect numeric crosswalk").click();
      const inspection = page.getByRole("region", {
        name: "Crosswalk inspection",
      });
      await inspection
        .getByText(`${status} · source ${code}`, { exact: true })
        .waitFor();
      assert(
        (await inspection.innerText()).includes(
          "Numeric candidate: Unavailable",
        ),
      );
      assert((await inspection.innerText()).includes(source.sourceRowHash));
      assert.equal(await field("SIDC").inputValue(), code);
    }
    report(
      "crosswalk-no-conversion",
      "In-scope discrepant and unverified rows retain original codes and evidence with no candidate or conversion; all six ambiguous weather rows remain outside this adapter and unresolved",
    );
    await button("Discard symbol edits").click();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll(".authoring-toolbar")).some((e) =>
          e.textContent.includes("Unsaved changes"),
        ),
    );
    assert.deepEqual(errors, []);
    await close();
    await launch();
    assert.deepEqual(
      (await call("symbols", { type: "get", kind: "SYMBOL", id })).symbol,
      saved,
    );
    await close();
    report(
      "normal-reopen",
      "Source inspection never replaces the saved numeric definition; exact structured fields survive normal close/reopen",
    );
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          success: true,
          packaged,
          checks,
          rendererErrors: errors,
          coverage:
            "M6 FM dictionary, numeric/legacy selector and compatibility UI subset; mappings remain unresolved and visual parity is not asserted.",
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        success: true,
        packaged,
        folder,
        checks: checks.length,
      }),
    );
  } catch (e) {
    fs.writeFileSync(path.join(folder, "failure.txt"), String(e));
    if (page)
      try {
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    if (page) {
      const discard = page.getByRole("button", {
        name: "Discard symbol edits",
        exact: true,
      });
      if ((await discard.isVisible()) && (await discard.isEnabled())) {
        await discard.click();
        await page.waitForFunction(
          () =>
            !Array.from(document.querySelectorAll(".authoring-toolbar")).some(
              (e) => e.textContent.includes("Unsaved changes"),
            ),
        );
      }
    }
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
