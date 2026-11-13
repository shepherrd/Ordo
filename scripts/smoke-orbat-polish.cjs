// Normal offline desktop acceptance. No diagnostic startup flags or service changes.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", `polish-orbat-${uid()}`),
    packaged = process.argv.includes("--packaged");
  fs.mkdirSync(folder, { recursive: true });
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
    const sampleSymbol = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "FICTIONAL DRAG LABELS",
      })
    ).symbol;
    op.units.find((u) => u.id === left).symbol = {
      schemaVersion: 1,
      base: { definition: sampleSymbol.definition, source: null },
      override: {
        definition: {
          ...structuredClone(sampleSymbol.definition),
          renderProfile: {
            ...sampleSymbol.definition.renderProfile,
            version: 2,
          },
          compatibility: {
            ...sampleSymbol.definition.compatibility,
            signature: "!",
          },
        },
        source: null,
      },
      labels: {
        uniqueDesignation: { kind: "PARENT_UNIT_NAME" },
        higherFormation: { kind: "DEFINITION" },
      },
    };
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
    await ready();
    assert.equal(
      await button("Select unit").getAttribute("aria-pressed"),
      "true",
    );
    await node(root).focus();
    await page.keyboard.press("Enter");
    assert.equal(await selection.inputValue(), root);
    const second = await canvas
      .locator("[data-unit-id]")
      .nth(1)
      .getAttribute("data-unit-id");
    await page.keyboard.press("ArrowDown");
    assert.equal(await selection.inputValue(), second);
    report(
      "keyboard-selection",
      "Select mode is the default; Enter and arrow keys select diagram units without editing hierarchy",
    );
    const originalUnits = structuredClone(op.units);
    await node(left).scrollIntoViewIfNeeded();
    const dragStart = await node(left).boundingBox(),
      dragEnd = await node(right).boundingBox();
    await page.mouse.move(
      dragStart.x + dragStart.width / 2,
      dragStart.y + dragStart.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dragEnd.x + dragEnd.width / 2,
      dragEnd.y + dragEnd.height / 2,
      { steps: 10 },
    );
    const landing = canvas.locator(".orbat-placement-preview");
    await landing.waitFor();
    assert.equal(await landing.getAttribute("data-placement-unit"), left);
    assert.match(await landing.textContent(), /FICTIONAL RIGHT/);
    assert.deepEqual(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .units,
      originalUnits,
    );
    await page.screenshot({
      path: path.join(folder, "operation-drag-preview.png"),
    });
    await page.mouse.up();
    await landing.waitFor({ state: "detached" });
    await ready();
    await button("Undo draft edit").click();
    await ready();
    await button("Redo draft edit").click();
    await save();
    assert.equal(op.units.find((u) => u.id === left).parentUnitId, right);
    assert.equal(op.units.find((u) => u.id === leftChild).parentUnitId, left);
    assert.equal(op.units.find((u) => u.id === rightChild).parentUnitId, right);
    assert.deepEqual(
      op.units.map((u) => u.id),
      originalUnits.map((u) => u.id),
    );
    await button("Change parent").click();
    await field("New ORBAT parent").selectOption(root);
    await button("Apply parent relationship").click();
    await save();
    assert.deepEqual(op.units, originalUnits);
    report(
      "direct-drag-revision",
      "Default dragging previews a canonical subtree move; one-step draft undo/redo and saved revisions preserve all units",
    );
    await selection.selectOption(left);
    await button("Move position").click();
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
    await page.getByText("Fine position", { exact: true }).click();
    assert(await button("Reset unit position").isDisabled());
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
    await button("Change parent").click();
    await field("New ORBAT parent").selectOption(right);
    await button("Apply parent relationship").click();
    await save();
    assert.equal(op.units.length, 6);
    assert.equal(op.units.find((u) => u.id === left).parentUnitId, right);
    assert.equal(op.units.find((u) => u.id === leftChild).parentUnitId, left);
    assert.equal(op.units.find((u) => u.id === rightChild).parentUnitId, right);
    const afterReparent = parents();
    await selection.selectOption(right);
    assert.equal(
      await field("New ORBAT parent")
        .locator(`option[value="${leftChild}"]`)
        .count(),
      0,
    );
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

    const unitsBeforeDrop = structuredClone(op.units);
    await node(left).scrollIntoViewIfNeeded();
    const symbolTarget = await node(left).boundingBox();
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page
      .locator(".symbol-tray-card")
      .filter({ hasText: sampleSymbol.name })
      .dispatchEvent("dragstart", { dataTransfer: transfer });
    const dropEvent = {
      dataTransfer: transfer,
      clientX: symbolTarget.x + symbolTarget.width / 2,
      clientY: symbolTarget.y + symbolTarget.height / 2,
    };
    await node(left).dispatchEvent("dragover", dropEvent);
    await page
      .getByRole("status")
      .filter({ hasText: "Add as child of FICTIONAL LEFT" })
      .waitFor();
    const ghost = canvas.locator(".orbat-placement-preview");
    await ghost.waitFor();
    const ghostId = await ghost.getAttribute("data-placement-unit");
    const previewBox = await ghost
      .locator(".orbat-placement-card")
      .evaluate((el) => ({
        x: +el.getAttribute("x") + 5,
        y: +el.getAttribute("y") + 5,
        width: +el.getAttribute("width") - 10,
        height: +el.getAttribute("height") - 10,
      }));
    assert.deepEqual(
      (await call("execute", { type: "load", operationId: op.id })).operation
        .units,
      unitsBeforeDrop,
    );
    await page.screenshot({
      path: path.join(folder, "operation-saved-symbol-preview.png"),
    });
    await node(left).dispatchEvent("drop", dropEvent);
    await transfer.dispose();
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="Selected operation unit"]')
          ?.options.length === 8,
    );
    const addedId = await selection.inputValue();
    assert.equal(addedId, ghostId);
    await ready();
    const placedBox = await node(addedId)
      .locator("svg")
      .first()
      .evaluate((el) => ({
        x: +el.getAttribute("x"),
        y: +el.getAttribute("y"),
        width: +el.getAttribute("width"),
        height: +el.getAttribute("height"),
      }));
    for (const key of Object.keys(previewBox))
      assert(Math.abs(previewBox[key] - placedBox[key]) < 0.1);
    assert(!unitsBeforeDrop.some((u) => u.id === addedId));
    await button("Undo draft edit").click();
    assert.equal(await selection.locator("option").count(), 7);
    await button("Redo draft edit").click();
    assert.equal(await selection.locator("option").count(), 8);
    await save();
    const added = op.units.find((u) => u.id === addedId);
    assert.equal(added.parentUnitId, left);
    assert.deepEqual(
      op.units.filter((u) => u.id !== addedId),
      unitsBeforeDrop,
    );
    assert.deepEqual(added.symbol.base.definition, sampleSymbol.definition);
    assert.equal(added.symbol.override, null);
    assert.equal(
      added.symbol.base.source.versionId,
      (
        await call("symbols", {
          type: "symbol-pin",
          id: sampleSymbol.versionId,
        })
      ).pin.versionId,
    );
    assert.deepEqual(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: sampleSymbol.versionId,
        })
      ).symbol,
      sampleSymbol,
    );
    report(
      "saved-symbol-subordinate",
      "Dropping a saved symbol onto an existing parent adds one canonical subordinate; exact snapshot, parent symbol, existing subtree, library item and undo/redo are preserved",
    );

    await selection.selectOption(left);
    await button("Save to symbols").click();
    const copyDialog = page.getByRole("dialog", {
      name: "Save unit symbol",
      exact: true,
    });
    await copyDialog
      .getByLabel("Symbol name", { exact: true })
      .fill("Fictional operation symbol copy");
    await page.screenshot({
      path: path.join(folder, "operation-save-symbol.png"),
    });
    await copyDialog
      .getByRole("button", { name: "Save symbol copy", exact: true })
      .click();
    await copyDialog.waitFor({ state: "detached" });
    await page
      .locator(".symbol-tray-card")
      .filter({ hasText: "Fictional operation symbol copy" })
      .waitFor();
    const copyId = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: {
          search: "Fictional operation symbol copy",
          status: "",
          offset: 0,
          limit: 20,
        },
      })
    ).page.items[0].versionId;
    const copied = (
      await call("symbols", { type: "get", kind: "SYMBOL", id: copyId })
    ).symbol;
    const expected = structuredClone(
      op.units.find((u) => u.id === left).symbol.override.definition,
    );
    expected.amplifiers.uniqueDesignation = "FICTIONAL RIGHT";
    assert.notEqual(copied.definition.definitionId, expected.definitionId);
    assert.deepEqual(
      { ...copied.definition, definitionId: expected.definitionId },
      expected,
    );
    assert.deepEqual(
      (await call("execute", { type: "load", operationId: op.id })).operation,
      op,
    );
    assert(await button("Save revision").isDisabled());
    report(
      "copy-operation-symbol",
      "Save to symbols copies the operation override, profile 2 and resolved parent-name label without editing the operation or its source symbol",
    );

    await close();
    await launch();
    const restored = (
      await call("execute", { type: "load", operationId: op.id })
    ).operation;
    assert.deepEqual(restored.units, op.units);
    assert.deepEqual(restored.orbatLayout, op.orbatLayout);
    assert.deepEqual(
      (await call("symbols", { type: "get", kind: "SYMBOL", id: copyId }))
        .symbol,
      copied,
    );
    assert.deepEqual(errors, []);
    await close();
    report(
      "normal-reopen",
      "Canonical units and independent presentation state survive normal offline close/reopen",
    );
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          success: true,
          packaged,
          buildFiles,
          checks,
          rendererErrors: errors,
          coverage:
            "Current operation ORBAT keyboard, pointer, reparent, cycle prevention and fold polish; separate from historical release qualification.",
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
