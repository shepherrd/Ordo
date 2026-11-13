// Normal offline desktop acceptance. No diagnostic startup flags or service changes.
const { _electron: electron } = require("playwright");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", `milestone6-smoke-${uid()}`),
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
    report(
      "normal-startup",
      "Unmodified Electron launch reached the offline Dashboard",
    );
    await nav("Military Symbols");
    await page
      .getByLabel("New symbol name", { exact: true })
      .fill("FICTIONAL M6 SYMBOL");
    await page
      .getByRole("button", { name: "Create Saved Symbol", exact: true })
      .click();
    await page
      .getByLabel("Saved Symbol name", { exact: true })
      .fill("FICTIONAL M6 SAVED SYMBOL");
    await page
      .getByRole("button", { name: "Save symbol draft", exact: true })
      .click();
    await page.getByRole("button", { name: "Copy SIDC", exact: true }).click();
    const sidc = await page.getByLabel("SIDC", { exact: true }).inputValue();
    assert.equal(
      await app.evaluate(({ clipboard }) => clipboard.readText()),
      sidc,
    );
    await page
      .getByRole("button", { name: "Publish symbol", exact: true })
      .click();
    await page
      .getByText("Published symbol version is now immutable.", { exact: true })
      .waitFor();
    const symbolPage = await call("symbols", {
      type: "browse",
      kind: "SYMBOL",
      query: {
        search: "FICTIONAL M6 SAVED SYMBOL",
        status: "PUBLISHED",
        offset: 0,
        limit: 10,
      },
    });
    const symbol = (
      await call("symbols", {
        type: "get",
        kind: "SYMBOL",
        id: symbolPage.page.items[0].versionId,
      })
    ).symbol;
    report(
      "symbol-ui",
      "Create, edit, save, publish and Copy SIDC through native UI",
    );
    const source = {
      kind: "SAVED_SYMBOL",
      versionId: symbol.versionId,
      expectedContentVersion: symbol.contentVersion,
    };
    const svg = await call("exportGraphic", {
      source,
      profile: profile("SYMBOL"),
    });
    assert.equal(svg.schemaVersion, 2);
    assert.equal(svg.renderManifests.length, 1);
    const png = await call("exportGraphic", {
      source,
      profile: profile("SYMBOL", "PNG"),
    });
    assert(png.raster.width > 0);
    assert.equal(png.raster.svgHash, png.renderedSvgHash);
    await call("saveGraphic", png.id, true);
    assert(
      await app.evaluate(async ({ clipboard }) => {
        const item = (await clipboard.read()).find((i) =>
          i.types.includes("image/png"),
        );
        if (!item) return false;
        const blob = await item.getType("image/png");
        return blob.size > 8;
      }),
    );
    const file = path.join(folder, "symbol.svg");
    await saveTo(file);
    await call("saveGraphic", svg.id, false);
    assert.equal(
      createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      svg.contentHash,
    );
    report(
      "retained-graphics",
      "Real worker SVG and Electron PNG; exact retained SVG bytes and native PNG clipboard",
    );
    const native = await call("exportGraphic", {
      source,
      profile: { ...profile("SYMBOL", "JSON"), jsonMode: "NATIVE_EXCHANGE" },
    });
    const nativeFile = path.join(folder, "native-symbol.json");
    await saveTo(nativeFile);
    await call("saveGraphic", native.id, false);
    await chooseFile(nativeFile);
    const policy = "DETACHED_COPIES";
    const preview = await call("previewLibraryImport", uid(), policy);
    assert(preview);
    fs.writeFileSync(
      path.join(folder, "import-preview.json"),
      JSON.stringify(preview, null, 2),
    );
    assert(preview.canCommit);
    const imported = await call("commitLibraryImport", preview.token, true);
    assert(imported);
    assert(preview.targets.every((t) => t.versionId !== symbol.versionId));
    const detached = (
      await call("symbols", {
        type: "get",
        kind: "SYMBOL",
        id: preview.targets[0].versionId,
      })
    ).symbol;
    assert.equal(detached.status, "DRAFT");
    assert(detached.exchangeOrigin);
    report(
      "native-import",
      "Native Symbol JSON preview, independent identity remapping, explicit commit and protected receipt",
    );
    const externalFile = path.join(folder, "external.json");
    fs.writeFileSync(externalFile, JSON.stringify([{ sidc }]));
    await chooseFile(externalFile);
    await assert.rejects(
      call("previewLibraryImport", uid(), "REUSE_EXACT"),
      /Choose an Ordo JSON/,
    );
    await nav("ORBATs");
    const pin = (
      await call("symbols", { type: "symbol-pin", id: symbol.versionId })
    ).pin;
    let unitProfile = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "FICTIONAL M6 PROFILE",
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
    const composition = (
      await call("symbols", {
        type: "orbat-from-profile",
        id: unitProfile.unitProfileVersionId,
        name: "FICTIONAL M6 ORBAT",
      })
    ).orbat;
    assert.deepEqual(composition.nodes[0].unit.defaultSymbol, pin);
    composition.nodes[0].symbolOverride = {
      definition: pin.definition,
      source: {
        familyId: pin.familyId,
        versionId: pin.versionId,
        contentHash: pin.contentHash,
      },
    };
    const child = structuredClone(composition.nodes[0]);
    child.nodeId = uid();
    child.parentNodeId = composition.rootNodeId;
    child.nameOverride = "FICTIONAL CHILD";
    composition.nodes.push(child);
    let saved = (
      await call("symbols", {
        type: "save-orbat",
        value: composition,
        expected: composition.contentVersion,
      })
    ).orbat;
    await nav("Dashboard");
    await nav("ORBATs");
    await page.locator(`[data-orbat-id="${saved.versionId}"]`).click();
    const selectedUnit = page.getByLabel("Selected ORBAT unit", {
      exact: true,
    });
    await selectedUnit.waitFor();
    assert.equal(await selectedUnit.locator("option").count(), 2);
    await page
      .getByRole("button", { name: "Add inline child", exact: true })
      .click();
    await selectedUnit.locator("option").nth(2).waitFor({ state: "attached" });
    assert.equal(await selectedUnit.locator("option").count(), 3);
    await page
      .getByRole("button", { name: "Undo ORBAT edit", exact: true })
      .click();
    await selectedUnit.locator("option").nth(2).waitFor({ state: "detached" });
    assert.equal(await selectedUnit.locator("option").count(), 2);
    await page
      .getByRole("button", { name: "Redo ORBAT edit", exact: true })
      .click();
    await selectedUnit.locator("option").nth(2).waitFor({ state: "attached" });
    assert.equal(await selectedUnit.locator("option").count(), 3);
    await page
      .getByRole("button", { name: "Save ORBAT draft", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Publish ORBAT", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Retire ORBAT version", exact: true })
      .waitFor();
    saved = (
      await call("symbols", { type: "get", kind: "ORBAT", id: saved.versionId })
    ).orbat;
    assert.equal(saved.nodes.length, 3);
    assert.equal(saved.status, "PUBLISHED");
    const orbat = await call("exportGraphic", {
      source: {
        kind: "SAVED_ORBAT",
        versionId: saved.versionId,
        expectedContentVersion: saved.contentVersion,
      },
      profile: profile("ORBAT"),
    });
    assert.equal(orbat.renderManifests.length, 2);
    report(
      "orbat-worker",
      "Saved ORBAT UI add/undo/redo/save/publish, exact symbol snapshots, inline text card and composed retained SVG",
    );
    const orbatNative = await call("exportGraphic", {
      source: {
        kind: "SAVED_ORBAT",
        versionId: saved.versionId,
        expectedContentVersion: saved.contentVersion,
      },
      profile: { ...profile("ORBAT", "JSON"), jsonMode: "NATIVE_EXCHANGE" },
    });
    const orbatFile = path.join(folder, "native-orbat.json");
    await saveTo(orbatFile);
    await call("saveGraphic", orbatNative.id, false);
    await chooseFile(orbatFile);
    const orbatPreview = await call(
      "previewLibraryImport",
      uid(),
      "REUSE_EXACT",
    );
    assert(orbatPreview.canCommit);
    assert(
      orbatPreview.fields.some(
        (f) => f.path.startsWith("dependencies/") && f.action === "REUSED",
      ),
    );
    await call("commitLibraryImport", orbatPreview.token, true);
    report(
      "profile-closure",
      "Unit Profile v2 pins an exact Saved Symbol; ORBAT native exchange closes and verifies published profile/symbol dependencies",
    );
    let planning = await call("execute", {
      type: "create",
      name: "FICTIONAL M6 OPERATION",
      demo: true,
    });
    let op = planning.operation;
    const importCommand = {
      type: "import-orbat",
      operationId: op.id,
      expectedRevision: op.revision,
      orbatVersionId: saved.versionId,
      importId: uid(),
      parentUnitId: null,
      confirmDuplicate: false,
      replaceLayout: true,
    };
    const materialized = await call("symbols", importCommand);
    op = materialized.operation;
    const replay = await call("symbols", importCommand);
    assert.deepEqual(replay.receipt, materialized.receipt);
    assert.equal(replay.operation.units.length, op.units.length);
    op.units.forEach((u) => {
      u.inTaskOrganization = true;
    });
    const definitionId = uid(),
      moduleId = uid(),
      at = new Date().toISOString();
    op.modules ??= { schemaVersion: 1, instances: [], assets: [] };
    op.modules.instances.push({
      moduleInstanceId: moduleId,
      operationId: op.id,
      productInstanceId: op.orderId,
      moduleDefinitionId: null,
      localDefinition: {
        moduleDefinitionId: definitionId,
        stableKey: `module-${definitionId}`,
        moduleType: "TASK_ORGANIZATION",
        title: "TASK ORGANIZATION",
        description: "",
        guidance: "",
        position: 0,
        required: false,
        defaultVisible: true,
        configuration: {},
        provenance: {
          sourceClass: "ORDO_DEFAULT",
          sourceReferences: [],
          notes: "Fictional desktop acceptance module",
        },
      },
      origin: "OPERATION",
      content: {
        type: "TASK_ORGANIZATION",
        presentation: {
          schemaVersion: 1,
          mode: "BOTH",
          ancestorPolicy: "BOUNDARY",
          foldPolicy: "AS_SHOWN",
          symbolSize: 30,
        },
      },
      position: 0,
      layoutState: "ACTIVE",
      createdAt: at,
      updatedAt: at,
    });
    op.metadata.statusId = "approved";
    planning = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    op = planning.operation;
    await call("execute", {
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "Fictional M6 acceptance",
    });
    const publication = (
      await call("execute", {
        type: "publish",
        operationId: op.id,
        expectedRevision: op.revision,
      })
    ).publications[0];
    const orderProfile = planning.profiles.find((p) => p.product === "opord");
    const generate = {
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: orderProfile.id, version: orderProfile.version },
      publicationId: publication.id,
    };
    const artifact = (await call("execute", generate)).exports.at(-1);
    assert.equal(artifact.projectionVersion, 5);
    assert.equal(artifact.schemaVersion, 3);
    assert(artifact.html.includes("<svg"));
    assert.equal(artifact.graphics.length, 1);
    const baseline = (
      await call("reviews", { type: "history", operationId: op.id })
    ).history[0].endpoint;
    const inherited = op.units.find((u) => u.sourceOrbat);
    inherited.name = "FICTIONAL RENAMED UNIT";
    op.orbatLayout.mode = "SIMPLE";
    planning = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    op = planning.operation;
    assert(
      planning.exports.find((e) => e.id === artifact.id).staleness.outdated,
    );
    const again = (
      await call("execute", { ...generate, expectedRevision: op.revision })
    ).exports.at(-1);
    assert.deepEqual(again.graphics, artifact.graphics);
    assert.equal(again.sourceRevision, publication.sourceRevision);
    const target = (
      await call("reviews", { type: "history", operationId: op.id })
    ).history[0].endpoint;
    const review = (
      await call("reviews", {
        type: "create-review",
        baseline: {
          kind: "REVISION",
          operationId: op.id,
          revisionId: baseline.revisionId,
        },
        target: {
          kind: "REVISION",
          operationId: op.id,
          revisionId: target.revisionId,
        },
        engineVersion: "diff-engine-v3",
        title: "Fictional M6 review",
        description: "",
        expectedRevision: op.revision,
        parentReviewId: null,
        supersedesReviewId: null,
      })
    ).review;
    assert.equal(review.reportRendererVersion, "review-html-v3");
    assert(
      review.comparison.changes.some((c) => c.category === "PRESENTATION"),
    );
    assert(review.comparison.impacts.some((i) => i.targetId === artifact.id));
    assert.deepEqual(
      (await call("reviews", { type: "get-review", id: review.id })).review,
      review,
    );
    report(
      "v5-v3-publication",
      "Canonical import is idempotent; retained graphical publication stays frozen; current data stales consumed fields and produces a retained v3 review",
    );
    await nav("Dashboard");
    await openOperation(page, op.id);
    await navigateOperation(page, "Task organization");
    const unitIndex = op.units.findIndex((u) => u.id === inherited.id);
    const card = page.locator(".entity").filter({
      has: page.getByLabel(`Unit name ${unitIndex + 1}`, { exact: true }),
    });
    await card.getByText("Military symbol", { exact: true }).click();
    await card
      .getByRole("button", {
        name: "Edit operation symbol override",
        exact: true,
      })
      .click();
    await card
      .getByLabel("SIDC", { exact: true })
      .fill("130610000012110000000000000000");
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page.waitForFunction(
      ({ id, revision }) =>
        window.ordo
          .execute({ type: "load", operationId: id })
          .then((s) => s.operation.revision > revision),
      { id: op.id, revision: op.revision },
    );
    op = (await call("execute", { type: "load", operationId: op.id }))
      .operation;
    assert.equal(
      op.units[unitIndex].symbol.override.definition.code.sidc,
      "130610000012110000000000000000",
    );
    assert.deepEqual(op.units[unitIndex].symbol.base, inherited.symbol.base);
    await card
      .getByRole("button", { name: "Reset to inherited symbol", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page.waitForFunction(
      ({ id, revision }) =>
        window.ordo
          .execute({ type: "load", operationId: id })
          .then((s) => s.operation.revision > revision),
      { id: op.id, revision: op.revision },
    );
    op = (await call("execute", { type: "load", operationId: op.id }))
      .operation;
    assert.equal(op.units[unitIndex].symbol.override, null);
    const parents = op.units.map((u) => ({ id: u.id, parent: u.parentUnitId }));
    await page.getByRole("button", { name: "ORBAT view", exact: true }).click();
    await page
      .getByLabel("Selected operation unit", { exact: true })
      .selectOption(inherited.id);
    await page
      .getByRole("button", { name: "Move Position", exact: true })
      .click();
    const canvas = page.locator(
      '[aria-label="Interactive ORBAT diagram"]:visible',
    );
    await canvas.focus();
    await canvas.press("ArrowRight");
    await page
      .getByRole("button", { name: "Save revision", exact: true })
      .click();
    await page.waitForFunction(
      ({ id, revision }) =>
        window.ordo
          .execute({ type: "load", operationId: id })
          .then((s) => s.operation.revision > revision),
      { id: op.id, revision: op.revision },
    );
    op = (await call("execute", { type: "load", operationId: op.id }))
      .operation;
    assert.deepEqual(
      op.units.map((u) => ({ id: u.id, parent: u.parentUnitId })),
      parents,
    );
    assert.equal(
      op.orbatLayout.hints.find((h) => h.nodeId === inherited.id).offset.x,
      10,
    );
    report(
      "operation-symbol-layout-ui",
      "Override and revert preserve the frozen base; keyboard Move Position changes only layout, preserving canonical parents",
    );
    await call("symbols", {
      type: "retire",
      kind: "SYMBOL",
      id: symbol.versionId,
    });
    const derived = (
      await call("symbols", {
        type: "derive",
        kind: "SYMBOL",
        id: symbol.versionId,
        versionLabel: "1.0.1",
        newFamily: false,
      })
    ).symbol;
    assert.equal(derived.status, "DRAFT");
    assert.notEqual(derived.versionId, symbol.versionId);
    assert.deepEqual(
      (
        await call("workspace", {
          type: "unit-profile-get",
          id: unitProfile.unitProfileVersionId,
        })
      ).profile.defaultSymbol,
      pin,
    );
    assert.equal((await call("graphicStaleness", svg.id)).outdated, false);
    report(
      "retirement-pins",
      "Retirement and derived versions preserve exact published Unit Profile pins and prior export currency",
    );
    const large = await page.evaluate(async (definition) => {
      const ids = Array.from({ length: 2000 }, () => crypto.randomUUID());
      const nodes = ids.map((id, i) => {
        const symbol = structuredClone(definition);
        symbol.definitionId = id;
        symbol.amplifiers.uniqueDesignation = `FICTIONAL UNIT ${i + 1}`;
        if (i % 12 === 0) symbol.compatibility.flagId = "US";
        return {
          id,
          parentId: i ? ids[Math.floor((i - 1) / 8)] : null,
          name: "",
          annotation: "",
          symbol,
          boundary: false,
        };
      });
      const input = {
        nodes,
        layout: {
          schemaVersion: 1,
          layoutId: crypto.randomUUID(),
          algorithm: "ordo-layout-v1",
          mode: "SMART",
          commandLevels: 3,
          labelProfile: "ordo-labels-v1",
          hints: [],
          siblingOrder: [],
        },
        symbolSize: 30,
      };
      let ticks = 0;
      const timer = setInterval(() => ticks++, 50),
        start = performance.now();
      try {
        const result = await window.ordo.renderGraphic(crypto.randomUUID(), {
          kind: "ORBAT",
          input,
        });
        return {
          elapsedMs: Math.round(performance.now() - start),
          rendererTimerTicks: ticks,
          nodes: result.result.layout.nodes.filter((n) => !n.synthetic).length,
          svgBytes: new TextEncoder().encode(result.result.svg).length,
          svgHash: result.result.svgHash,
          manifests: result.result.renderManifests.length,
        };
      } finally {
        clearInterval(timer);
      }
    }, pin.definition);
    assert.equal(large.nodes, 2000);
    assert.equal(large.manifests, 2000);
    assert(large.rendererTimerTicks > 0);
    assert(large.svgBytes < 16 * 1024 * 1024);
    fs.writeFileSync(
      path.join(folder, "large-composition.json"),
      JSON.stringify(large, null, 2),
    );
    report(
      "large-worker",
      `2,000 fictional units through Electron IPC: ${large.elapsedMs} ms, ${large.svgBytes} SVG bytes; renderer timer continued (${large.rendererTimerTicks} ticks)`,
    );
    await assert.rejects(
      call("renderGraphic", uid(), {
        kind: "ORBAT",
        input: { nodes: [], layout: {}, unexpected: true },
      }),
    );
    await assert.rejects(call("graphicStaleness", "not-an-id"));
    await assert.rejects(
      call("symbols", {
        type: "publish",
        kind: "SYMBOL",
        id: symbol.versionId,
        expected: symbol.contentVersion,
        unexpected: true,
      }),
    );
    report(
      "strict-ipc",
      "Malformed render, artifact identity and library command rejected",
    );
    const backup = path.join(folder, "backup.db");
    await saveTo(backup);
    await call("backup");
    assert(fs.statSync(backup).size > 0);
    await close();
    report("normal-shutdown", "Electron exited normally with code 0");
    await launch();
    const rows = await call("graphicExports");
    assert(rows.some((r) => r.id === orbat.id));
    assert.equal((await call("graphicStaleness", orbat.id)).outdated, false);
    await chooseFile(backup);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await call("restore");
    assert.equal((await call("graphicStaleness", svg.id)).outdated, false);
    assert.equal((await call("graphicStaleness", orbat.id)).outdated, false);
    await saveTo(path.join(folder, "restored.svg"));
    await call("saveGraphic", svg.id, false);
    assert.equal(
      createHash("sha256")
        .update(fs.readFileSync(path.join(folder, "restored.svg")))
        .digest("hex"),
      svg.contentHash,
    );
    report(
      "restore-reopen",
      "Native backup/restore verifies exact retained graphics and source dependencies after normal reopen",
    );
    assert.deepEqual(errors, []);
    await close();
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          success: true,
          packaged,
          checks,
          rendererErrors: errors,
          coverage:
            "Staged M6 native UI/IPC/worker/export/restore/lifecycle subset; remaining interaction and publication/review workflows are separate gates.",
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
