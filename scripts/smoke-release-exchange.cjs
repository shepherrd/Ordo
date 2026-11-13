// Run the release executable against independent sender and recipient workspaces.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { _electron: electron } = require("playwright");
const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");
const { version } = require("../package.json");

(async () => {
  const executablePath = path.resolve(
    process.argv[2] || `release/${version}/win-unpacked/Ordo.exe`,
  );
  fs.mkdirSync(path.resolve(".test-data"), { recursive: true });
  const folder = fs.mkdtempSync(
    path.resolve(".test-data", "release-exchange-"),
  );
  const doctrineFile = path.join(folder, "exercise.ordo-doctrine");
  const errors = [];
  let app, page;
  const launch = async (workspace) => {
    const env = {
      ...process.env,
      ORDO_DATA_DIR: path.join(folder, workspace),
      ORDO_HEADLESS: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath, env, args: [] });
    assert.equal(
      await app.evaluate(({ app }) => app.isPackaged && app.getVersion()),
      version,
    );
    page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
  };
  const close = async () => {
    const process = app.process();
    await app.close();
    app = null;
    assert.equal(process.exitCode, 0);
  };
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const selectFile = (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
  const importTree = async (file) => {
    await selectFile(file);
    const preview = await call(
      "previewLibraryImport",
      randomUUID(),
      "REUSE_EXACT",
    );
    assert(
      preview.canCommit,
      JSON.stringify(preview.fields.filter((f) => f.action === "INVALID")),
    );
    const result = await call("commitLibraryImport", preview.token, true);
    const target = result.targets.find((t) => t.kind === "ORBAT");
    const { orbat } = await call("symbols", {
      type: "get",
      kind: "ORBAT",
      id: target.versionId,
    });
    assert.equal(orbat.nodes.length, 2);
    assert.equal(
      orbat.nodes.find((n) => n.nodeId !== orbat.rootNodeId).parentNodeId,
      orbat.rootNodeId,
    );
    return orbat;
  };
  try {
    await launch("sender");
    assert.equal(
      (await call("execute", { type: "load" })).operations.length,
      0,
    );
    await page.getByRole("button", { name: "Create Testify example" }).click();
    const active = page
      .getByLabel("Active operation", { exact: true })
      .filter({ visible: true });
    await active.waitFor();
    const id = await active.inputValue();
    const first = await call("execute", { type: "load", operationId: id });
    assert.equal(first.operation.name, "Operation Testify");
    assert.equal(first.operation.tasks.length, 24);
    assert.equal(first.operation.events.length, 20);
    assert.equal(first.operation.attachments.length, 181);
    const other = (await call("execute", { type: "create-testify-example" }))
      .operation;
    assert.notEqual(other.id, id);
    assert.notEqual(other.units[0].id, first.operation.units[0].id);
    assert(
      other.tasks.every((t) => other.units.some((u) => u.id === t.unitId)),
    );
    const profile = first.profiles.find((p) => p.product === "opord");
    const order = await call("execute", {
      type: "generate",
      operationId: id,
      expectedRevision: first.operation.revision,
      profileRef: { id: profile.id, version: profile.version },
      publicationId: null,
    });
    assert.equal(order.exports.length, 1);
    console.log(
      "PASS Optional Testify copies, planning links, and order generation",
    );

    const doctrine = await call("execute", {
      type: "doctrine-create",
      name: "Release exchange exercise",
      versionLabel: "1.0.0",
      newFamily: true,
      empty: true,
    });
    await selectFile(doctrineFile);
    await call("files", {
      type: "doctrine-export",
      id: doctrine.selectedDoctrineId,
    });
    const externalFile = path.join(folder, "external.json");
    fs.writeFileSync(
      externalFile,
      JSON.stringify({
        options: { sidc: "130310000012110000000000000000" },
        subOrganizations: [],
      }),
    );
    await selectFile(externalFile);
    await assert.rejects(
      call("previewLibraryImport", randomUUID(), "REUSE_EXACT"),
      /Choose an Ordo JSON/,
    );
    const symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Exercise symbol",
      })
    ).symbol;
    let tree = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Exercise ORBAT",
      })
    ).orbat;
    tree.nodes = [
      fixtureOrbatUnit(tree.rootNodeId, "Exercise HQ"),
      fixtureOrbatUnit(randomUUID(), "Exercise company"),
    ];
    tree.nodes[1].parentNodeId = tree.rootNodeId;
    for (const node of tree.nodes)
      node.unit.symbol = { definition: symbol.definition, source: null };
    tree = (
      await call("symbols", {
        type: "save-orbat",
        expected: tree.contentVersion,
        value: tree,
      })
    ).orbat;
    for (const [product, item] of [
      ["SYMBOL", symbol],
      ["ORBAT", tree],
    ]) {
      const command = {
        source: {
          kind: "SAVED_" + product,
          versionId: item.versionId,
          expectedContentVersion: item.contentVersion,
        },
        profile: {
          schemaVersion: 1,
          id: randomUUID(),
          version: 1,
          name: "Exercise ORBAT",
          product,
          format: "JSON",
          jsonMode: "NATIVE_EXCHANGE",
          scale: 1,
          background: "TRANSPARENT",
          size: 30,
          foldPolicy: "AS_SHOWN",
          ancestorPolicy: "BOUNDARY",
          selectedUnitIds: null,
          renderProfile: { id: "ordo-symbol", version: 1 },
        },
      };
      const record = await call("exportGraphic", command);
      await selectFile(path.join(folder, product + ".json"));
      await call("saveGraphic", record.id, false);
    }
    await close();
    await launch("recipient");
    await selectFile(doctrineFile);
    const imported = await call("files", { type: "doctrine-import" });
    const installed = imported.state.doctrines.find(
      (d) => d.doctrineVersionId === imported.doctrineId,
    );
    assert.equal(installed?.displayName, "Release exchange exercise");
    const draft = await call("execute", {
      type: "create",
      name: "Doctrine check",
      demo: false,
      configuration: { id: installed.doctrineVersionId, version: 1 },
    });
    assert.equal(draft.config.doctrine.name, installed.config.doctrine.name);
    await importTree(path.join(folder, "ORBAT.json"));
    await selectFile(path.join(folder, "SYMBOL.json"));
    const p = await call("previewLibraryImport", randomUUID(), "REUSE_EXACT");
    assert(p.canCommit);
    const copy = await call("commitLibraryImport", p.token, false);
    const restored = (
      await call("symbols", {
        type: "get",
        kind: "SYMBOL",
        id: copy.targets[0].versionId,
      })
    ).symbol;
    assert.equal(restored.definition.code.sidc, symbol.definition.code.sidc);
    assert.notEqual(restored.versionId, symbol.versionId);
    console.log(
      "PASS Doctrine transfer, native ORBAT and symbol JSON round trips, and unsupported file rejection",
    );
    if (process.argv[3]) {
      const prior = path.resolve(process.argv[3]);
      const backup = path.join(folder, "prior-workspace.db");
      fs.copyFileSync(path.join(prior, "ordo.db"), backup);
      await selectFile(backup);
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      });
      const previous = await call("restore");
      assert(previous.operations.length > 0);
      assert((await call("graphicExports")).length >= 2);
      const olderNativeFile = path.join(
        path.dirname(prior),
        "NATIVE_EXCHANGE.json",
      );
      await importTree(olderNativeFile);
      console.log(
        "PASS Restored previous workspace, verified archived exports and receipts, and imported previous native ORBAT JSON",
      );
    }
    await close();
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close();
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
