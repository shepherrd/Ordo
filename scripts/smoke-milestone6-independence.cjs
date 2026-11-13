// Normal offline desktop acceptance. No diagnostic startup flags or service changes.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", `milestone6-independence-${uid()}`),
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

  try {
    await launch();
    let symbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL INDEPENDENCE SYMBOL",
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
    let source = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "FICTIONAL SHARED SOURCE",
      })
    ).orbat;
    source.nodes[0].symbolOverride = {
      definition: pin.definition,
      source: {
        familyId: pin.familyId,
        versionId: pin.versionId,
        contentHash: pin.contentHash,
      },
    };
    const child = structuredClone(source.nodes[0]);
    child.nodeId = uid();
    child.parentNodeId = source.rootNodeId;
    child.nameOverride = "FICTIONAL CHILD";
    source.nodes.push(child);
    source = (
      await call("symbols", {
        type: "save-orbat",
        value: source,
        expected: source.contentVersion,
      })
    ).orbat;
    source = (
      await call("symbols", {
        type: "publish",
        kind: "ORBAT",
        id: source.versionId,
        expected: source.contentVersion,
      })
    ).orbat;
    const importInto = async (name) => {
      const op = (await call("execute", { type: "create", name, demo: false }))
        .operation;
      return (
        await call("symbols", {
          type: "import-orbat",
          operationId: op.id,
          expectedRevision: op.revision,
          orbatVersionId: source.versionId,
          importId: uid(),
          parentUnitId: null,
          confirmDuplicate: false,
          replaceLayout: true,
        })
      ).operation;
    };
    let first = await importInto("FICTIONAL INDEPENDENT ONE");
    const second = await importInto("FICTIONAL INDEPENDENT TWO");
    assert.equal(first.units.length, 2);
    assert.equal(second.units.length, 2);
    assert(!first.units.some((u) => second.units.some((v) => v.id === u.id)));
    for (const op of [first, second]) {
      const root = op.units.find((u) => u.parentUnitId === null),
        child = op.units.find((u) => u.parentUnitId !== null);
      assert.equal(child.parentUnitId, root.id);
      assert.deepEqual(root.symbol.base.definition, pin.definition);
    }
    report(
      "independent-materialization",
      "One published ORBAT imports into two operations with disjoint canonical unit IDs, local parent links and exact independent symbol snapshots",
    );
    await openOperation(page, first.id);
    await navigateOperation(page, "Task organization");
    await page.getByRole("button", { name: "ORBAT view", exact: true }).click();
    const root = first.units.find((u) => u.parentUnitId === null);
    await page
      .getByLabel("Selected operation unit", { exact: true })
      .filter({ visible: true })
      .selectOption(root.id);
    await page
      .getByLabel("Canonical operation unit name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL FIRST ONLY");
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page.waitForFunction(
      ({ id, r }) =>
        window.ordo
          .execute({ type: "load", operationId: id })
          .then((s) => s.operation.revision > r),
      { id: first.id, r: first.revision },
    );
    first = (await call("execute", { type: "load", operationId: first.id }))
      .operation;
    assert.deepEqual(
      (await call("execute", { type: "load", operationId: second.id }))
        .operation,
      second,
    );
    await nav("Dashboard");
    await openOperation(page, second.id);
    await navigateOperation(page, "Task organization");
    await page.getByRole("button", { name: "ORBAT view", exact: true }).click();
    const secondRoot = second.units.find((u) => u.parentUnitId === null);
    await page
      .getByLabel("Selected operation unit", { exact: true })
      .filter({ visible: true })
      .selectOption(secondRoot.id);
    assert.equal(
      await page
        .getByLabel("Canonical operation unit name", { exact: true })
        .filter({ visible: true })
        .inputValue(),
      secondRoot.name,
    );
    let newer = (
      await call("symbols", {
        type: "derive",
        kind: "ORBAT",
        id: source.versionId,
        versionLabel: "1.0.1",
        newFamily: false,
      })
    ).orbat;
    newer.nodes[0].nameOverride = "FICTIONAL LATER GLOBAL NAME";
    await call("symbols", {
      type: "save-orbat",
      value: newer,
      expected: newer.contentVersion,
    });
    await call("symbols", {
      type: "retire",
      kind: "SYMBOL",
      id: symbol.versionId,
    });
    assert.deepEqual(
      (await call("execute", { type: "load", operationId: first.id }))
        .operation,
      first,
    );
    assert.deepEqual(
      (await call("execute", { type: "load", operationId: second.id }))
        .operation,
      second,
    );
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "ORBAT",
          id: source.versionId,
        })
      ).orbat,
      source,
    );
    report(
      "independent-edit",
      "Renaming through the first operation's ORBAT UI leaves the second visible name unchanged; later global ORBAT edits and symbol retirement mutate neither operation",
    );
    assert.deepEqual(errors, []);
    await close();
    await launch();
    for (const op of [first, second])
      assert.deepEqual(
        (await call("execute", { type: "load", operationId: op.id })).operation,
        op,
      );
    await close();
    report(
      "normal-reopen",
      "Both independent operation snapshots survive normal close/reopen exactly",
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
            "M6 independent two-operation ORBAT materialization and UI rename demonstration.",
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
