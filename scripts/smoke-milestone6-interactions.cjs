// Normal offline desktop acceptance. No diagnostic startup flags or service changes.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", `milestone6-interactions-${uid()}`),
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
    let op = (
      await call("execute", {
        type: "create",
        name: "FICTIONAL ORBAT INTERACTIONS",
        demo: true,
      })
    ).operation;
    const root = op.units[0].id,
      left = op.units[1].id;
    const extra = (name, parentUnitId) => {
      const unit = {
        ...structuredClone(op.units[0]),
        id: uid(),
        name,
        parentUnitId,
        inTaskOrganization: true,
      };
      op.units.push(unit);
      return unit.id;
    };
    op.units[0].name = "FICTIONAL ROOT";
    op.units[1].name = "FICTIONAL LEFT";
    op.units[1].parentUnitId = root;
    op.units[1].inTaskOrganization = true;
    const right = extra("FICTIONAL RIGHT", root),
      leftChild = extra("FICTIONAL LEFT CHILD", left),
      rightChild = extra("FICTIONAL RIGHT CHILD", right),
      spare = extra("FICTIONAL SPARE", root);
    op.tasks[0].unitId = leftChild;
    op = (
      await call("execute", {
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      })
    ).operation;
    await openOperation(page, op.id);
    await navigateOperation(page, "Task organization");
    await page.getByRole("button", { name: "ORBAT view", exact: true }).click();
    const canvas = page.locator(
        '[aria-label="Interactive ORBAT diagram"]:visible',
      ),
      selection = page.getByLabel("Selected operation unit", { exact: true }),
      button = (name) => page.getByRole("button", { name, exact: true }),
      field = (name) => page.getByLabel(name, { exact: true }),
      parents = () => op.units.map((u) => [u.id, u.parentUnitId]),
      ready = () =>
        canvas
          .locator('.graphic-canvas[aria-busy="false"] > div > svg')
          .waitFor(),
      node = (id) => canvas.locator(`[data-unit-id="${id}"]`).first();
    const save = async () => {
      const revision = op.revision;
      await button("Save revision").click();
      await page.waitForFunction(
        ({ id, revision }) =>
          window.ordo
            .execute({ type: "load", operationId: id })
            .then((s) => s.operation.revision > revision),
        { id: op.id, revision },
      );
      op = (await call("execute", { type: "load", operationId: op.id }))
        .operation;
    };
    await selection.selectOption(left);
    await button("Move Position").click();
    await ready();
    const initialParents = parents();
    await node(left).scrollIntoViewIfNeeded();
    const from = await node(left).boundingBox(),
      to = await node(right).boundingBox();
    assert(from && to);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 5,
    });
    await page.mouse.up();
    assert(Number(await field("Position offset X").inputValue()) !== 0);
    await save();
    assert.deepEqual(parents(), initialParents);
    assert.equal(op.units.length, 6);
    assert.equal(op.units.find((u) => u.id === rightChild).parentUnitId, right);
    report(
      "occupied-move",
      "Pointer drag onto an occupied diagram position preserves all six canonical units and every parent relationship",
    );

    await ready();
    await selection.selectOption(spare);
    const beforeCancel = await field("Position offset X").inputValue();
    await node(spare).scrollIntoViewIfNeeded();
    const cancelAt = await node(spare).boundingBox();
    await page.mouse.move(
      cancelAt.x + cancelAt.width / 2,
      cancelAt.y + cancelAt.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      cancelAt.x + cancelAt.width / 2 + 40,
      cancelAt.y + cancelAt.height / 2,
    );
    await canvas.press("Escape");
    await page.mouse.up();
    assert.equal(await field("Position offset X").inputValue(), beforeCancel);
    await button("Reset unit position").click();
    await canvas.focus();
    await canvas.press("Shift+ArrowRight");
    assert.equal(await field("Position offset X").inputValue(), "1");
    await button("Undo draft edit").click();
    assert.equal(await field("Position offset X").inputValue(), "0");
    await button("Redo draft edit").click();
    assert.equal(await field("Position offset X").inputValue(), "1");
    await save();
    assert.deepEqual(parents(), initialParents);
    report(
      "cancel-keyboard-history",
      "Escape cancels pointer movement; fine keyboard movement and undo/redo change only saved layout",
    );

    await selection.selectOption(left);
    await button("Reparent").click();
    await field("New ORBAT parent").selectOption(right);
    await button("Apply parent relationship").click();
    await save();
    assert.equal(op.units.length, 6);
    assert.equal(op.units.find((u) => u.id === left).parentUnitId, right);
    assert.equal(op.units.find((u) => u.id === leftChild).parentUnitId, left);
    assert.equal(op.units.find((u) => u.id === rightChild).parentUnitId, right);
    const afterReparent = parents();
    await selection.selectOption(right);
    await field("New ORBAT parent").selectOption(leftChild);
    await button("Apply parent relationship").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "ORBAT hierarchy cycle" })
      .waitFor();
    assert.deepEqual(
      (
        await call("execute", { type: "load", operationId: op.id })
      ).operation.units.map((u) => [u.id, u.parentUnitId]),
      afterReparent,
    );
    assert(await button("Delete selected leaf unit").isDisabled());
    report(
      "reparent-cycle",
      "Explicit reparent preserves both subtrees; descendant cycle is rejected and non-leaf deletion stays disabled",
    );

    await field("Fold descendants").check();
    await save();
    await ready();
    assert.equal(
      await canvas.locator(`[data-unit-id="${leftChild}"]`).count(),
      0,
    );
    assert.equal(await canvas.locator(`[data-unit-id="${right}"]`).count(), 2);
    await canvas.locator(`[data-unit-id="${right}"]`).last().click();
    assert.equal(await selection.inputValue(), right);
    assert.equal(op.units.length, 6);
    assert.deepEqual(parents(), afterReparent);
    await field("Fold descendants").uncheck();
    await save();
    await ready();
    assert.equal(
      await canvas.locator(`[data-unit-id="${leftChild}"]`).count(),
      1,
    );
    report(
      "fold-selection",
      "Synthetic fold selects its canonical parent; folding hides graphics without deleting units or changing hierarchy",
    );

    await selection.selectOption(leftChild);
    await button("Delete selected leaf unit").click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Unit deletion is blocked by a reference" })
      .waitFor();
    assert.equal(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .units.length,
      6,
    );
    await selection.selectOption(spare);
    await button("Move Position").click();
    await canvas.focus();
    await canvas.press("ArrowLeft");
    await button("Delete selected leaf unit").click();
    await save();
    assert.equal(op.units.length, 5);
    assert(!op.units.some((u) => u.id === spare));
    assert(!op.orbatLayout.hints.some((h) => h.nodeId === spare));
    assert.equal(op.tasks[0].unitId, leftChild);
    await button("Tree view").click();
    const leftIndex = op.units.findIndex((u) => u.id === left),
      card = page
        .locator(".entity")
        .filter({ has: field(`Unit name ${leftIndex + 1}`) });
    assert.equal(
      await card.getByLabel("Parent unit", { exact: true }).inputValue(),
      right,
    );
    report(
      "reference-delete-tree",
      "Referenced leaf deletion is blocked; unreferenced deletion cleans layout hints; Tree view shows the same reparented canonical unit",
    );

    await nav("ORBATs");
    await field("New ORBAT name").fill("FICTIONAL INTERACTION LIBRARY");
    await button("Create inline ORBAT").click();
    const selectedLibrary = field("Selected ORBAT unit");
    await selectedLibrary.waitFor();
    const libRoot = await selectedLibrary.inputValue();
    await button("Add inline child").click();
    const libChild = await selectedLibrary.inputValue();
    assert.notEqual(libChild, libRoot);
    await field("ORBAT unit display name").fill("FICTIONAL LIBRARY CHILD");
    await button("Add inline child").click();
    await field("ORBAT unit display name").fill("FICTIONAL LIBRARY DESCENDANT");
    await selectedLibrary.selectOption(libRoot);
    await button("Add inline child").click();
    const libTarget = await selectedLibrary.inputValue();
    await field("ORBAT unit display name").fill("FICTIONAL OCCUPIED TARGET");
    await button("Add inline child").click();
    await field("ORBAT unit display name").fill("FICTIONAL TARGET DESCENDANT");
    await selectedLibrary.selectOption(libChild);
    await button("Edit symbol override").click();
    await field("SIDC").fill("130610000012110000000000000000");
    await button("Reparent").click();
    await field("New ORBAT parent").selectOption(libTarget);
    await button("Apply parent relationship").click();
    await button("Save ORBAT draft").click();
    const versions = await call("symbols", {
      type: "browse",
      kind: "ORBAT",
      query: {
        search: "FICTIONAL INTERACTION LIBRARY",
        status: "DRAFT",
        offset: 0,
        limit: 10,
      },
    });
    const versionId = versions.page.items[0].versionId;
    let library = (
      await call("symbols", { type: "get", kind: "ORBAT", id: versionId })
    ).orbat;
    assert.equal(library.nodes.length, 5);
    assert.equal(
      library.nodes.find((n) => n.nodeId === libChild).parentNodeId,
      libTarget,
    );
    assert.equal(
      library.nodes.filter((n) => n.parentNodeId === libTarget).length,
      2,
    );
    assert.equal(
      library.nodes.find((n) => n.nodeId === libChild).symbolOverride.definition
        .code.sidc,
      "130610000012110000000000000000",
    );
    await button("Publish ORBAT").click();
    await button("Retire ORBAT version").waitFor();
    assert(await field("ORBAT unit display name").isDisabled());
    assert(await button("Move Position").isDisabled());
    assert(await button("Reparent").isDisabled());
    report(
      "library-preservation",
      "Saved ORBAT symbol override and reparent preserve five identities and both subtrees; published authoring controls are read-only",
    );

    await close();
    await launch();
    const restored = (
      await call("execute", { type: "load", operationId: op.id })
    ).operation;
    assert.deepEqual(restored.units, op.units);
    assert.deepEqual(restored.orbatLayout, op.orbatLayout);
    library = (
      await call("symbols", { type: "get", kind: "ORBAT", id: versionId })
    ).orbat;
    assert.equal(library.status, "PUBLISHED");
    assert.equal(library.nodes.length, 5);
    assert.deepEqual(errors, []);
    await close();
    report(
      "normal-reopen",
      "Canonical edits and library publication survive normal close/reopen with no renderer errors",
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
            "M6 operation and Saved ORBAT interaction subset; does not close provenance or visual gates.",
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
