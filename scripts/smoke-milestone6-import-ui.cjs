// Normal offline desktop acceptance. No diagnostic startup flags or service changes.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", `milestone6-import-ui-${uid()}`),
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
  const profile = (product, format = "SVG") => ({
    schemaVersion: 1,
    id: uid(),
    version: 1,
    name: `Fictional ${product} ${format}`,
    product,
    format,
    scale: 1,
    background: "TRANSPARENT",
    size: 30,
    foldPolicy: "AS_SHOWN",
    ancestorPolicy: "BOUNDARY",
    selectedUnitIds: null,
    renderProfile: { id: "ordo-symbol", version: 1 },
  });
  const saveTo = async (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, file);
  const chooseFile = async (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);

  try {
    await launch();
    let symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL PINNED IMPORT SOURCE",
      })
    ).symbol;
    symbol = (
      await call("symbols", {
        type: "publish",
        kind: "SYMBOL",
        id: symbol.versionId,
        expected: symbol.contentVersion,
      })
    ).symbol;
    const pin = (
      await call("symbols", { type: "symbol-pin", id: symbol.versionId })
    ).pin;
    let unitProfile = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "FICTIONAL IMPORT PROFILE",
      })
    ).profile;
    unitProfile = (
      await call("workspace", {
        type: "unit-profile-save",
        profile: { ...unitProfile, schemaVersion: 2, defaultSymbol: pin },
        expectedContentVersion: unitProfile.contentVersion,
      })
    ).profile;
    unitProfile = (
      await call("workspace", {
        type: "unit-profile-publish",
        id: unitProfile.unitProfileVersionId,
        expectedContentVersion: unitProfile.contentVersion,
      })
    ).profile;
    const original = (
      await call("symbols", {
        type: "orbat-from-profile",
        id: unitProfile.unitProfileVersionId,
        name: "FICTIONAL IMPORT ORBAT",
      })
    ).orbat;
    const native = await call("exportGraphic", {
      source: {
        kind: "SAVED_ORBAT",
        versionId: original.versionId,
        expectedContentVersion: original.contentVersion,
      },
      profile: { ...profile("ORBAT", "JSON"), jsonMode: "NATIVE_EXCHANGE" },
    });
    const nativeFile = path.join(folder, "closed-orbat.json");
    await saveTo(nativeFile);
    await call("saveGraphic", native.id, false);
    await call("symbols", {
      type: "retire",
      kind: "SYMBOL",
      id: symbol.versionId,
    });
    await nav("ORBATs");
    const visibleImport = () =>
        page.locator("details.library-import:visible").filter({
          has: page.locator("summary", {
            hasText: /^Import Ordo JSON$/,
          }),
        }),
      button = (name) => page.getByRole("button", { name, exact: true }),
      browse = (kind, search = "") =>
        call("symbols", {
          type: "browse",
          kind,
          query: { search, status: "", offset: 0, limit: 30 },
        });
    let panel = visibleImport();
    await panel.locator("summary").click();
    await chooseFile(nativeFile);
    await panel
      .getByRole("button", { name: "Choose JSON and preview", exact: true })
      .click();
    await panel
      .getByRole("alert")
      .filter({ hasText: "Import needs a correction" })
      .waitFor();
    assert(
      await panel
        .getByRole("button", { name: /^Import \d+ new drafts$/ })
        .isDisabled(),
    );
    await panel
      .getByRole("combobox", { name: /^Report filter/ })
      .selectOption("CONFLICT");
    assert((await panel.locator("tbody").innerText()).includes("CONFLICT"));
    assert.equal((await browse("ORBAT")).page.total, 1);
    await panel
      .getByRole("combobox", { name: /^Dependency handling/ })
      .selectOption("DETACHED_COPIES");
    const ack = panel.getByRole("checkbox", { name: /I reviewed the omitted/ });
    await ack.waitFor();
    assert(
      await panel
        .getByRole("button", { name: "Import 1 new drafts", exact: true })
        .isDisabled(),
    );
    await panel
      .getByRole("button", { name: "Cancel import", exact: true })
      .click();
    assert.equal((await browse("ORBAT")).page.total, 1);
    await panel
      .getByRole("button", { name: /^Import \d+ new drafts$/ })
      .waitFor({ state: "detached" });
    report(
      "conflict-cancel",
      "UI blocks reuse of a retired exact dependency, shows CONFLICT fields, automatically revalidates a changed policy and binds loss review to the new preview, and cancels without writing drafts",
    );

    await chooseFile(nativeFile);
    await panel
      .getByRole("button", { name: "Choose JSON and preview", exact: true })
      .click();
    await ack.waitFor();
    await ack.check();
    await panel
      .getByRole("button", { name: "Import 1 new drafts", exact: true })
      .click();
    await page
      .locator("summary:visible")
      .filter({ hasText: /^Retained import evidence$/ })
      .waitFor();
    const rows = (await browse("ORBAT")).page.items;
    assert.equal(rows.length, 2);
    const imported = (
      await call("symbols", {
        type: "get",
        kind: "ORBAT",
        id: rows.find((r) => r.versionId !== original.versionId).versionId,
      })
    ).orbat;
    assert.equal(imported.status, "DRAFT");
    assert.notEqual(imported.familyId, original.familyId);
    assert.notEqual(imported.rootNodeId, original.rootNodeId);
    assert.equal(imported.nodes[0].unit.kind, "INLINE_UNIT");
    assert.equal(imported.nodes[0].unit.symbol.source, null);
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "ORBAT",
          id: original.versionId,
        })
      ).orbat,
      original,
    );
    await page
      .locator("summary:visible")
      .filter({ hasText: /^Retained import evidence$/ })
      .click();
    await page
      .locator("summary:visible")
      .filter({ hasText: /^Original JSON \(read only\)$/ })
      .click();
    assert(
      (await page.locator("pre:visible").first().innerText()).includes(
        "ORDO_LIBRARY_EXCHANGE",
      ),
    );
    const receipt = await call(
      "libraryImportReceipt",
      imported.exchangeOrigin.importId,
    );
    assert.equal(receipt.sourceText, fs.readFileSync(nativeFile, "utf8"));
    assert(receipt.fields.some((f) => f.action === "DETACHED"));
    report(
      "detached-receipt",
      "UI imports only after explicit loss acknowledgement, remaps stable identities, preserves the source, and exposes exact read-only JSON and field evidence",
    );

    await nav("Military Symbols");
    panel = visibleImport();
    await panel.locator("summary").click();
    const beforeInvalid = (await browse("SYMBOL")).page.total;
    const badFile = path.join(folder, "invalid.json");
    fs.writeFileSync(badFile, '{"format":');
    await chooseFile(badFile);
    await panel
      .getByRole("button", { name: "Choose JSON and preview", exact: true })
      .click();
    await panel.getByRole("alert").waitFor();
    assert.equal((await browse("SYMBOL")).page.total, beforeInvalid);
    await panel
      .getByRole("button", { name: /^Import \d+ new drafts$/ })
      .waitFor({ state: "detached" });
    report(
      "invalid-json-ui",
      "Malformed JSON produces a visible error without partial records or a commit control",
    );

    for (let i = 1; i <= 31; i++)
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: `FICTIONAL PAGE ${String(i).padStart(2, "0")}`,
      });
    const search = page.getByLabel("Search Saved Symbols", { exact: true });
    await search.fill("FICTIONAL PAGE");
    await page.locator("[data-symbol-id]:visible").nth(29).waitFor();
    assert.equal(await page.locator("[data-symbol-id]:visible").count(), 30);
    await button("Next symbols").click();
    await page
      .locator("[data-symbol-id]:visible")
      .nth(1)
      .waitFor({ state: "detached" });
    assert.equal(await page.locator("[data-symbol-id]:visible").count(), 1);
    await button("Previous symbols").click();
    await page.locator("[data-symbol-id]:visible").nth(29).waitFor();
    await search.fill("FICTIONAL PAGE 17");
    await page
      .locator("[data-symbol-id]:visible")
      .nth(1)
      .waitFor({ state: "detached" });
    await page.locator("[data-symbol-id]:visible").first().click();
    const beforeRename = (await browse("SYMBOL", "FICTIONAL PAGE 17")).page
      .items[0].versionId;
    await page
      .getByLabel("Saved Symbol name", { exact: true })
      .fill("FICTIONAL RENAMED PAGE");
    await button("Save symbol draft").click();
    await page.waitForFunction(
      (id) =>
        window.ordo
          .symbols({ type: "get", kind: "SYMBOL", id })
          .then((r) => r.symbol.name === "FICTIONAL RENAMED PAGE"),
      beforeRename,
    );
    assert.equal(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: beforeRename }))
        .symbol.versionId,
      beforeRename,
    );
    report(
      "bounded-gallery",
      "Gallery paginates 31 matches as 30 plus 1, search resets the page, and renaming retains the version identity",
    );

    await page
      .getByText("Saved structured symbol definition.", { exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll(".authoring-toolbar")).some((e) =>
          e.textContent.includes("Unsaved changes"),
        ),
    );
    fs.writeFileSync(
      path.join(folder, "before-close-dom.txt"),
      await page.locator("body").innerText(),
    );
    assert.deepEqual(errors, []);
    await close();
    await launch();
    assert.equal(
      (await call("libraryImportReceipt", imported.exchangeOrigin.importId))
        .sourceText,
      receipt.sourceText,
    );
    assert.equal(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: beforeRename }))
        .symbol.name,
      "FICTIONAL RENAMED PAGE",
    );
    await close();
    report(
      "normal-reopen",
      "Import receipts, detached identity, and gallery edits survive normal close/reopen",
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
            "M6 import conflict, loss, cancellation and bounded gallery UI subset; no provenance or visual closure claim.",
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
    throw e;
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
