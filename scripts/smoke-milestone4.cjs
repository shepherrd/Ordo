const {
  currentState,
  openOperation,
  createDemo,
  navigateOperation,
} = require("./smoke-global.cjs");
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID: uid } = require("node:crypto"),
  assert = require("node:assert/strict"),
  Database = require("better-sqlite3");
(async () => {
  const folder = path.resolve(".test-data", `milestone4-smoke-${uid()}`),
    packaged = process.argv.includes("--packaged");
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(
    "tests/fixtures/milestone3-0.3.0.db",
    path.join(folder, "ordo.db"),
  );
  const tables = [
    "operation_revisions",
    "publications",
    "exports",
    "profile_versions",
    "doctrine_versions",
    "managed_assets",
  ];
  const raw = new Database(path.join(folder, "ordo.db"));
  const existingTables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  const before = Object.fromEntries(
    tables
      .filter((t) => existingTables.includes(t))
      .map((t) => [t, raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
  raw.close();
  const png = path.join(folder, "fictional.png"),
    backup = path.join(folder, "backup.db"),
    html = path.join(folder, "review.html");
  fs.writeFileSync(
    png,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
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
  let app,
    page,
    opId,
    runtime,
    ok = false;
  const errors = [],
    checks = [];
  const report = (step, note) => {
    checks.push({ step, result: "PASS", note });
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify({ packaged, runtime, checks }, null, 2),
    );
    console.log(`PASS ${step}: ${note}`);
  };
  const command = (c) => page.evaluate((c) => window.ordo.execute(c), c);
  const reviewCommand = (c) => page.evaluate((c) => window.ordo.reviews(c), c);
  const state = () =>
    command({ type: "load", ...(opId ? { operationId: opId } : {}) });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const nav = (name) => navigateOperation(page, name);
  const launch = async () => {
    app = await electron.launch(options);
    page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    await page.context().setOffline(true);
    page.on("pageerror", (e) => errors.push(e.message));
    runtime = await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      return {
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
      };
    });
    assert.equal(runtime.packaged, packaged);
    if (packaged)
      assert.equal(runtime.version, require("../package.json").version);
    await page.locator("nav:visible").first().waitFor();
    if (opId) await openOperation(page, opId);
  };
  const reload = async () => {
    await page.reload();
    await page.locator("nav:visible").first().waitFor();
    if (opId) await openOperation(page, opId);
  };
  const restart = async () => {
    await app.close();
    await launch();
  };
  const saved = async (edit) => {
    const s = await state();
    edit(s.operation);
    return command({
      type: "save",
      operation: s.operation,
      expectedRevision: s.operation.revision,
    });
  };
  const history = async () =>
    reviewCommand({ type: "history", operationId: opId });
  const select = (e) =>
    e.kind === "PUBLICATION"
      ? { kind: e.kind, operationId: opId, publicationId: e.publicationId }
      : { kind: e.kind, operationId: opId, revisionId: e.revisionId };
  const compare = async (a, b) => {
    const h = await history();
    return (
      await reviewCommand({
        type: "compare",
        baseline: select(a ?? h.history[1].endpoint),
        target: select(b ?? h.history[0].endpoint),
        engineVersion: "diff-engine-v1",
      })
    ).comparison;
  };
  const saveFile = async (filePath) =>
    app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, filePath);
  const chooseFile = async (filePath) =>
    app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    }, filePath);
  const capture = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true },
      );
    });
    await new Promise((r) => setTimeout(r, 250));
    const bytes = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      )
        .toPNG()
        .toString("base64"),
    );
    fs.writeFileSync(path.join(folder, name), Buffer.from(bytes, "base64"));
  };
  const field = (label, type) => ({
    id: uid(),
    stableKey: uid(),
    label,
    help: "",
    type,
    required: false,
    options: [],
  });
  const addModule = (op, type, title, content, configuration = {}) => {
    op.modules ??= { schemaVersion: 1, instances: [], assets: [] };
    const id = uid(),
      definitionId = uid();
    op.modules.instances.push({
      moduleInstanceId: id,
      operationId: op.id,
      productInstanceId: op.orderId,
      moduleDefinitionId: null,
      origin: "OPERATION",
      localDefinition: {
        moduleDefinitionId: definitionId,
        stableKey: `module-${definitionId}`,
        moduleType: type,
        title,
        description: "",
        guidance: "",
        position: 0,
        required: false,
        defaultVisible: true,
        configuration,
        provenance: {
          sourceClass: "ORDO_DEFAULT",
          sourceReferences: [],
          notes: "Fictional acceptance module",
        },
      },
      content,
      position: op.modules.instances.length,
      layoutState: "ACTIVE",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return id;
  };
  const openReview = async (id) => {
    await nav("History / Changes");
    await page
      .getByLabel("Open review", { exact: true })
      .filter({ visible: true })
      .selectOption(id);
    await page.locator(".review-change:visible").first().waitFor();
  };
  try {
    await launch();
    const db = new Database(path.join(folder, "ordo.db"), { readonly: true });
    assert.equal(
      db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v,
      11,
    );
    for (const [t, rows] of Object.entries(before))
      assert.deepEqual(
        db
          .prepare(
            `SELECT ${t === "managed_assets" ? "id,operation_id,doctrine_version_id,document,bytes" : "*"} FROM ${t} ORDER BY rowid`,
          )
          .all(),
        rows,
      );
    db.close();
    report(
      1,
      "Actual 0.3.0 schema-004 backup migrated to 009; all historical rows are unchanged",
    );
    let s = await state();
    for (const o of s.operations) {
      const legacy = await command({ type: "load", operationId: o.id });
      assert(legacy.operation);
      for (const asset of legacy.assets.filter((a) =>
        a.mimeType.startsWith("image/"),
      ))
        await page.evaluate(
          (id) => window.ordo.files({ type: "asset-preview", assetId: id }),
          asset.assetId,
        );
      const h = await reviewCommand({ type: "history", operationId: o.id });
      assert(h.history.length);
      assert(legacy.exports.every((e) => e.html && e.projectionVersion));
    }
    report(
      2,
      "Historical operations, doctrines, assets, publications and stored exports remain readable",
    );
    const army = s.configurations.find(
      (c) => c.doctrine.id === "10000000-0000-4000-8000-000000000002",
    );
    s = await command({
      type: "create",
      name: "FICTIONAL M4 BRIGADE",
      demo: true,
      configuration: {
        id: army.organization.id,
        version: army.organization.version,
      },
    });
    opId = s.operation.id;
    report(
      3,
      "Created fictional brigade operation through validated application commands",
    );
    await chooseFile(png);
    const asset1 = (
      await page.evaluate(
        (id) =>
          window.ordo.files({
            type: "asset-import",
            owner: { kind: "operation", id },
          }),
        opId,
      )
    ).asset;
    await chooseFile(png);
    const asset2 = (
      await page.evaluate(
        (id) =>
          window.ordo.files({
            type: "asset-import",
            owner: { kind: "operation", id },
          }),
        opId,
      )
    ).asset;
    const x = field("Period", "SHORT_TEXT"),
      y = field("Quantity", "INTEGER"),
      z = field("Reserve", "INTEGER");
    let richId,
      tableId,
      chartId,
      timelineId,
      imageId,
      galleryId,
      plainId,
      removeId;
    const rows = [1, 2, 3].map((n) => ({
      id: uid(),
      cells: { [x.id]: `Period ${n}`, [y.id]: n * 4, [z.id]: n * 2 },
    }));
    s = await saved((op) => {
      const c = s.config.doctrine.catalog.nodes.find(
        (n) => n.stableKey === "C",
      );
      op.attachments.push({
        ...structuredClone(op.attachments[0]),
        id: uid(),
        code: c.code,
        name: c.canonicalTitle,
        catalogId: c.id,
        doctrineNodeId: c.id,
        applicability: "INCLUDED",
        metadata: { ...op.attachments[0].metadata, ownerId: null },
      });
      richId = addModule(op, "RICH_TEXT", "Review narrative", {
        type: "RICH_TEXT",
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "A fictional baseline sentence." },
              ],
            },
          ],
        },
      });
      tableId = addModule(
        op,
        "TABLE",
        "Resource table",
        { type: "TABLE", rows },
        { columns: [x, y, z], allowColumnOverride: true },
      );
      chartId = addModule(op, "CHART", "Linked resource chart", {
        type: "CHART",
        chartType: "BAR",
        source: {
          mode: "TABLE",
          moduleInstanceId: tableId,
          categoryColumnId: x.id,
          valueColumnIds: [y.id],
        },
      });
      timelineId = addModule(op, "TIMELINE", "Relative timeline", {
        type: "TIMELINE",
        items: [
          {
            id: uid(),
            title: "H-relative review",
            description: "Fictional",
            phaseId: op.phases[0].id,
            timing: {
              mode: "RELATIVE",
              referenceEventId: op.events[0].id,
              offsetMinutes: -30,
            },
          },
        ],
      });
      const image = {
        id: uid(),
        assetId: asset1.assetId,
        title: "Fictional image",
        caption: "Acceptance asset",
        alt: "Fictional",
        width: "small",
        alignment: "left",
      };
      imageId = addModule(op, "IMAGE", "Reference image", {
        type: "IMAGE",
        image,
      });
      galleryId = addModule(op, "IMAGE_GALLERY", "Reference gallery", {
        type: "IMAGE_GALLERY",
        images: [
          { ...image, id: uid() },
          { ...image, id: uid(), assetId: asset2.assetId },
        ],
      });
      plainId = addModule(op, "PLAIN_TEXT", "Planner text", {
        type: "PLAIN_TEXT",
        text: "Original planner note",
      });
      removeId = addModule(op, "PLAIN_TEXT", "Removable note", {
        type: "PLAIN_TEXT",
        text: "Retained on removal",
      });
      op.modules.assets = [asset1, asset2];
      op.metadata.statusId = s.config.doctrine.publicationRequiredStatus;
    });
    assert.equal(s.findings.filter((f) => f.severity === "error").length, 0);
    const baselineRevision = s.operation.revision;
    report(
      4,
      "Baseline saved with canonical brigade facts, included A/C/H and rich/table/chart/timeline/image/gallery modules",
    );
    await reload();
    await nav("Publications");
    await page.getByRole("button", { name: /^Approve Revision / }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "explicitly approved" })
      .waitFor();
    await button("Publish OPORD snapshot").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Immutable OPORD baseline published" })
      .waitFor();
    const published = (await state()).publications[0];
    report(
      5,
      "Explicit approval and OPORD publication performed in the desktop UI",
    );
    await saved(
      (op) => (op.sections[0].summary = "One ordinary narrative amendment."),
    );
    report(6, "Saved a revision changing only one narrative field");
    let c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].category, "BASE_ORDER");
    report(
      7,
      "Exactly one narrative change; save time and automatic status reset suppressed",
    );
    await reload();
    await nav("History / Changes");
    await button("Current saved vs previous").click();
    await button("Compare saved states").click();
    await page.locator(".review-change:visible").waitFor();
    assert.equal(await page.locator(".review-change:visible").count(), 1);
    report(
      8,
      "History quick action compares current saved revision with its predecessor",
    );
    const hist = await history(),
      baseline = hist.history.find(
        (h) => h.endpoint.revisionNumber === baselineRevision,
      ).endpoint;
    await page
      .getByLabel("Baseline saved endpoint")
      .filter({ visible: true })
      .selectOption(`r:${hist.history.at(-1).endpoint.revisionId}`);
    await button("Compare saved states").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "[data-operation-editor]:not([hidden]) .review-change",
        ).length > 1,
    );
    report(9, "Arbitrary earlier and later revision selectors work");
    await button("Current saved vs publication").click();
    await button("Compare saved states").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "[data-operation-editor]:not([hidden]) .review-change",
        ).length === 1,
    );
    report(
      10,
      "Frozen publication selected as baseline against later saved planning state",
    );
    await saved((op) => (op.name = "FICTIONAL M4 BRIGADE RENAMED"));
    c = await compare();
    assert.equal(c.changes[0].entityId, opId);
    assert.equal(c.changes[0].changeType, "MODIFIED");
    report(11, "Operation rename retains operation UUID");
    await saved((op) => (op.events[0].at = "2026-10-04T15:00:00.000Z"));
    c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].category, "EVENT");
    report(12, "H-Hour edit is one canonical time change");
    assert(c.impacts.some((i) => i.targetId === timelineId));
    assert(!c.changes.some((i) => i.moduleInstanceId === timelineId));
    report(
      13,
      "Relative timeline resolution appears as impact, without a duplicate authored edit",
    );
    await saved((op) => {
      op.tasks[0].name = "Review revised fictional package";
      op.tasks[0].purpose = "Verify controlled comparison.";
    });
    c = await compare();
    assert.equal(c.changes.filter((c) => c.category === "TASK").length, 2);
    report(14, "Task text and purpose use the same canonical task identity");
    await saved((op) => (op.tasks[0].unitId = op.units[1].id));
    c = await compare();
    assert.equal(c.changes[0].changeType, "RELINKED");
    report(15, "Task assignment is a relationship change");
    await saved((op) => (op.units[1].parentUnitId = null));
    c = await compare();
    assert(
      c.impacts.some(
        (i) =>
          i.kind === "PRODUCT" &&
          i.targetId === s.operation.attachments.find((a) => a.code === "A").id,
      ),
    );
    report(
      16,
      "Parent-unit change affects Annex A through a dependency, without duplicate source data",
    );
    s = await state();
    let card = s.profiles.find((p) => p.product === "communications-card");
    const generated = await command({
      type: "generate",
      operationId: opId,
      expectedRevision: s.operation.revision,
      profileRef: { id: card.id, version: card.version },
      publicationId: null,
    });
    const included = generated.exports[0];
    card = structuredClone(card);
    card.name = "Card excluding channel";
    card.inclusion.netFields = card.inclusion.netFields.filter(
      (f) => f !== "channel",
    );
    s = await command({ type: "save-profile", profile: card, isNew: true });
    const excludedProfile = s.profiles.find((p) => p.name === card.name);
    const excluded = (
      await command({
        type: "generate",
        operationId: opId,
        expectedRevision: s.operation.revision,
        profileRef: {
          id: excludedProfile.id,
          version: excludedProfile.version,
        },
        publicationId: null,
      })
    ).exports[0];
    await saved((op) => (op.signal.nets[0].channel = "FICTIONAL CHANNEL 09"));
    c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].category, "SIGNAL");
    report(17, "Signal net channel is one canonical edit");
    assert(c.impacts.some((i) => i.targetId === "communications-card"));
    assert(
      c.impacts.some(
        (i) =>
          i.targetId === s.operation.attachments.find((a) => a.code === "H").id,
      ),
    );
    report(18, "Annex H and live Communications Card are explained dependents");
    assert(
      c.impacts.some(
        (i) =>
          i.kind === "EXPORT" && i.targetId === included.id && i.targetOutdated,
      ),
    );
    report(51, "Recorded export including channel is affected and outdated");
    assert(!c.impacts.some((i) => i.targetId === excluded.id));
    report(
      52,
      "Recorded export excluding channel is unaffected by the channel-only revision",
    );
    await saved(
      (op) =>
        (op.attachments.find((a) => a.code === "C").applicability = "OMITTED"),
    );
    c = await compare();
    assert.equal(c.changes[0].category, "PRODUCT_APPLICABILITY");
    report(
      19,
      "Included-to-omitted applicability is revisioned operation state",
    );
    await saved(
      (op) =>
        (op.attachments.find((a) => a.code === "H").metadata.ownerId = "ops"),
    );
    c = await compare();
    assert(c.changes[0].humanSummary.includes("Operational override"));
    report(
      20,
      "Responsible Staff override compares doctrine/inherited ownership to explicit assignment",
    );
    await saved(
      (op) =>
        (op.attachments.find((a) => a.code === "H").metadata.ownerId = null),
    );
    c = await compare();
    assert.equal(c.changes[0].afterValue, null);
    report(
      21,
      "Removing an override restores doctrine/inherited staff semantics",
    );
    let extra;
    await saved((op) => {
      extra = addModule(op, "PLAIN_TEXT", "Added review note", {
        type: "PLAIN_TEXT",
        text: "Added after publication",
      });
    });
    c = await compare();
    assert.equal(c.changes[0].changeType, "ADDED");
    report(22, "Operation module addition has a stable instance identity");
    await saved((op) => {
      const m = op.modules.instances.find((m) => m.moduleInstanceId === extra);
      m.position = -1;
      const ordered = [...op.modules.instances].sort(
        (a, b) => a.position - b.position,
      );
      ordered.forEach((m, i) => (m.position = i));
    });
    c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].changeType, "MOVED");
    report(23, "One module move produces one semantic move");
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === removeId,
        ).layoutState = "REMOVED_BY_OPERATION_OVERRIDE"),
    );
    c = await compare();
    assert.equal(c.changes[0].changeType, "REMOVED");
    report(
      24,
      "Module removal preserves content and records operation layout removal",
    );
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === plainId,
        ).content.text = "Revised planner note"),
    );
    c = await compare();
    assert.equal(c.changes[0].detailKind, "text");
    report(25, "Plain text has readable before and after content");
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === richId,
        ).content.document = {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "A revised fictional sentence." },
              ],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "Added fictional checklist narrative",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: "image",
              attrs: { assetId: asset2.assetId, alt: "Fictional inline image" },
            },
          ],
        }),
    );
    c = await compare();
    assert(c.changes.some((c) => c.humanSummary.includes("text modified")));
    assert(c.changes.some((c) => c.humanSummary.includes("list item added")));
    assert(c.changes.some((c) => c.humanSummary.includes("Image added")));
    report(
      26,
      "Rich sentence, list item and image produce structured semantic differences",
    );
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === tableId,
        ).localDefinition.configuration.columns[1].label =
          "Available quantity"),
    );
    c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].changeType, "MODIFIED");
    assert(c.changes[0].fieldPath.includes(y.id));
    report(27, "Column rename retains its ID; no remove/add noise");
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === tableId,
        ).content.rows[0].cells[y.id] = 19),
    );
    c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].detailKind, "cell");
    assert(c.changes[0].fieldPath.includes(rows[0].id));
    report(
      28,
      "One typed cell edit identifies its exact stable row and column",
    );
    assert(c.impacts.some((i) => i.targetId === chartId));
    assert(!c.changes.some((i) => i.moduleInstanceId === chartId));
    report(
      31,
      "Linked chart is an affected dependent of table-only source editing",
    );
    await saved((op) =>
      op.modules.instances
        .find((m) => m.moduleInstanceId === tableId)
        .content.rows.push({
          id: uid(),
          cells: { [x.id]: "Period 4", [y.id]: 8, [z.id]: 2 },
        }),
    );
    c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].changeType, "ADDED");
    report(29, "Table row addition is a single added row");
    await saved((op) => {
      const rows = op.modules.instances.find(
        (m) => m.moduleInstanceId === tableId,
      ).content.rows;
      rows.unshift(rows.pop());
    });
    c = await compare();
    assert.equal(c.changes.length, 1);
    assert.equal(c.changes[0].changeType, "MOVED");
    report(30, "Row reorder uses stable identities and one useful move");
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === chartId,
        ).content.source.valueColumnIds = [z.id]),
    );
    c = await compare();
    assert.equal(c.changes[0].moduleInstanceId, chartId);
    assert.equal(c.changes[0].changeType, "RELINKED");
    report(32, "Changing chart binding is a primary structural edit");
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === timelineId,
        ).content.items[0].timing.offsetMinutes = -45),
    );
    c = await compare();
    assert.equal(c.changes[0].beforeValue, -30);
    assert.equal(c.changes[0].afterValue, -45);
    report(33, "Timeline H-30 to H-45 compares its authored offset");
    await saved(
      (op) =>
        (op.modules.instances.find(
          (m) => m.moduleInstanceId === imageId,
        ).content.image.assetId = asset2.assetId),
    );
    c = await compare();
    assert.equal(c.changes[0].detailKind, "asset");
    assert(c.changes[0].afterDisplay.includes(asset2.sha256));
    report(
      34,
      "Image replacement uses managed asset identity/hash, without reading binary contents",
    );
    await reload();
    await nav("History / Changes");
    await button("Current saved vs publication").click();
    await button("Compare saved states").click();
    await page.locator(".review-change:visible").first().waitFor();
    await capture("quick-comparison.png");
    report(
      35,
      "Quick Comparison visibly groups semantic changes with before/after highlights",
    );
    await page
      .getByLabel("Review title", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL controlled change review");
    await page
      .getByLabel("Review description")
      .filter({ visible: true })
      .fill("Milestone 4 acceptance assessment");
    await button("Create Change Review").click();
    await page
      .getByRole("status")
      .filter({ hasText: "frozen endpoints" })
      .waitFor();
    let r = (await history()).reviews[0];
    report(
      36,
      "Created a first-class persisted Change Review from the selected endpoints",
    );
    assert.equal(r.comparison.baseline.publicationId, published.id);
    assert.equal(r.comparison.diffEngineVersion, "diff-engine-v1");
    const frozen = structuredClone(r.comparison);
    report(
      37,
      "Baseline, target, engine, semantic changes and impacts are frozen",
    );
    await restart();
    await openReview(r.id);
    assert.deepEqual(
      (await reviewCommand({ type: "get-review", id: r.id })).review.comparison,
      frozen,
    );
    report(38, "Restart reloads the identical persisted change records");
    const opBefore = (await state()).operation;
    const cards = page.locator(".review-change:visible");
    for (const [i, disposition] of [
      "ACCEPTED",
      "REJECTED",
      "NEEDS_CHANGES",
      "NOTED",
    ].entries()) {
      const card = cards.nth(i);
      await card
        .locator('select[aria-label^="Disposition for"]')
        .selectOption(disposition);
      await card
        .locator('input[aria-label^="Decision note for"]')
        .fill(`Fictional ${disposition} assessment`);
      await card
        .getByRole("button", { name: "Record decision", exact: true })
        .click();
      await page.waitForFunction(
        async ({ id, count }) =>
          (await window.ordo.reviews({ type: "get-review", id })).review.events
            .length >= count,
        { id: r.id, count: i + 1 },
      );
      report(39 + i, `Recorded ${disposition} through the review UI`);
    }
    assert.deepEqual((await state()).operation, opBefore);
    report(
      43,
      "Disposition actions leave underlying operation content byte-equivalent",
    );
    await cards
      .nth(0)
      .locator('select[aria-label^="Disposition for"]')
      .selectOption("NOTED");
    await cards
      .nth(0)
      .getByRole("button", { name: "Record decision", exact: true })
      .click();
    await page.waitForFunction(
      async (id) =>
        (await window.ordo.reviews({ type: "get-review", id })).review.events
          .length === 5,
      r.id,
    );
    r = (await reviewCommand({ type: "get-review", id: r.id })).review;
    assert.equal(
      r.events.filter(
        (e) => e.action.changeId === r.comparison.changes[0].changeId,
      ).length,
      2,
    );
    report(44, "Changing a prior decision retains both entries");
    await page
      .getByLabel("Review-level note", { exact: true })
      .filter({ visible: true })
      .fill("Fictional review-level note");
    await button("Add review note").click();
    await page.waitForFunction(
      async (id) =>
        (await window.ordo.reviews({ type: "get-review", id })).review.events
          .length === 6,
      r.id,
    );
    report(45, "Added a separate review-level note");
    await cards
      .nth(2)
      .locator('textarea[aria-label^="Comment for"]')
      .fill("Fictional follow-up required on this change");
    await cards
      .nth(2)
      .getByRole("button", { name: "Add change comment", exact: true })
      .click();
    await page.waitForFunction(
      async (id) =>
        (await window.ordo.reviews({ type: "get-review", id })).review.events
          .length === 7,
      r.id,
    );
    report(46, "Added a change-level comment");
    r = (await reviewCommand({ type: "get-review", id: r.id })).review;
    assert(
      r.events.every(
        (e) => e.actor === "Local planner" && Number.isFinite(Date.parse(e.at)),
      ),
    );
    report(47, "Every action retains timestamp, local actor and sequence");
    for (const d of [
      "UNREVIEWED",
      "ACCEPTED",
      "REJECTED",
      "NEEDS_CHANGES",
      "NOTED",
    ]) {
      await page
        .getByLabel("Disposition filter")
        .filter({ visible: true })
        .selectOption(d);
      await page.waitForTimeout(30);
    }
    await page
      .getByLabel("Disposition filter")
      .filter({ visible: true })
      .selectOption("");
    await page
      .getByLabel("Category filter")
      .filter({ visible: true })
      .selectOption("SIGNAL");
    assert((await cards.count()) > 0);
    await page
      .getByLabel("Category filter")
      .filter({ visible: true })
      .selectOption("");
    const productValue = await page
      .getByLabel("Product filter")
      .filter({ visible: true })
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await page
      .getByLabel("Product filter")
      .filter({ visible: true })
      .selectOption(productValue);
    assert((await cards.count()) > 0);
    await button("Clear filters").click();
    await page
      .getByLabel("Search changes")
      .filter({ visible: true })
      .fill("Channel / frequency");
    assert.equal(await cards.count(), 1);
    await button("Clear filters").click();
    report(48, "Disposition, category, product and search filters are usable");
    const exactReview = (await reviewCommand({ type: "get-review", id: r.id }))
      .review;
    await cards
      .filter({
        has: page.getByRole("button", {
          name: "Open current source",
          exact: true,
        }),
      })
      .first()
      .getByRole("button", { name: "Open current source", exact: true })
      .click();
    await nav("History / Changes");
    assert.deepEqual(
      (await reviewCommand({ type: "get-review", id: r.id })).review,
      exactReview,
    );
    report(49, "Source navigation preserves the frozen review and decisions");
    assert(r.comparison.impacts.every((i) => i.reason && i.chain.length >= 2));
    assert(r.comparison.impacts.some((i) => i.targetId === chartId));
    report(
      50,
      "Impacts retain concrete dependency reasons/chains and derived before/after values",
    );
    assert.deepEqual((await state()).publications[0], published);
    assert(
      r.comparison.impacts.some(
        (i) =>
          i.kind === "PUBLICATION_DIVERGENCE" &&
          i.reason.includes("remains unchanged"),
      ),
    );
    report(
      53,
      "Frozen publication is unchanged and described as a divergence baseline",
    );
    await nav("Overview");
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL unsaved name");
    await nav("History / Changes");
    assert.equal(await button("Create Change Review").isDisabled(), true);
    await page
      .getByText(/Unsaved changes exist\. Save a planning revision/)
      .filter({ visible: true })
      .waitFor();
    await nav("Overview");
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill(opBefore.name);
    await nav("History / Changes");
    report(
      54,
      "Unsaved authoring blocks controlled review creation with a save-first explanation",
    );
    await page
      .getByLabel("Disposition filter")
      .filter({ visible: true })
      .selectOption("UNREVIEWED");
    await button("Select filtered changes").click();
    await page
      .getByLabel("Bulk disposition")
      .filter({ visible: true })
      .selectOption("NOTED");
    await page
      .getByLabel(/^Confirm Noted for/)
      .filter({ visible: true })
      .check();
    await button("Record bulk decisions").click();
    await page.waitForFunction(async (id) => {
      const r = (await window.ordo.reviews({ type: "get-review", id })).review;
      return r.comparison.changes.every((c) =>
        r.events.some(
          (e) =>
            e.action.type === "DECISION" && e.action.changeId === c.changeId,
        ),
      );
    }, r.id);
    await button("Clear filters").click();
    await button("Complete review").click();
    await page
      .getByText(/Completed .* by Local planner\. Target remains revision/)
      .filter({ visible: true })
      .waitFor();
    r = (await reviewCommand({ type: "get-review", id: r.id })).review;
    report(
      55,
      "Completed review after all changes received dispositions, retaining Needs Changes",
    );
    await saved(
      (op) => (op.sections[1].summary = "Post-completion planning amendment"),
    );
    assert.deepEqual(
      (await reviewCommand({ type: "get-review", id: r.id })).review,
      r,
    );
    report(
      56,
      "Later saved plan revision does not move the completed review target",
    );
    const newComparison = await compare(r.comparison.target);
    assert(
      newComparison.target.revisionNumber > r.comparison.target.revisionNumber,
    );
    assert.equal(newComparison.changes.length, 1);
    report(
      57,
      "New comparison against latest revision is separate from completed review",
    );
    await restart();
    await openReview(r.id);
    assert.deepEqual(
      (await reviewCommand({ type: "get-review", id: r.id })).review,
      r,
    );
    report(
      58,
      "Completed review, exact changes, decisions and comments survive restart",
    );
    await button("Preview review report").click();
    await page
      .frameLocator('iframe[title="Change Review report"]:visible')
      .getByRole("heading", {
        name: "FICTIONAL controlled change review",
        exact: true,
      })
      .waitFor();
    await saveFile(html);
    await button("Save review report").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Review report saved" })
      .waitFor();
    assert(
      fs.readFileSync(html, "utf8").includes(r.comparison.baseline.stateHash),
    );
    await capture("completed-review-report.png");
    report(
      59,
      "Versioned read-only report preview and saved HTML include exact provenance and review history",
    );
    await saveFile(backup);
    const backed = (await history()).reviews;
    await page.evaluate(() => window.ordo.backup());
    assert(fs.existsSync(backup));
    report(
      60,
      "Backed up workspace including frozen review and append-only events",
    );
    await saved((op) => (op.sections[2].summary = "Post-backup revision"));
    let h = await history();
    const later = (
      await reviewCommand({
        type: "create-review",
        baseline: select(h.history[1].endpoint),
        target: select(h.history[0].endpoint),
        engineVersion: "diff-engine-v1",
        title: "Post-backup review",
        description: "Temporary",
        expectedRevision: h.history[0].endpoint.revisionNumber,
        parentReviewId: r.id,
        supersedesReviewId: null,
      })
    ).review;
    await reviewCommand({
      type: "review-actions",
      id: later.id,
      expectedSequence: 0,
      actions: [{ type: "COMMENT", changeId: null, text: "Post-backup note" }],
      confirmedBulk: false,
    });
    report(
      61,
      "Made additional revision, follow-on review and comment after backup",
    );
    await chooseFile(backup);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1 });
    });
    await page.evaluate(() => window.ordo.restore());
    report(62, "Restored saved workspace through the verified restore service");
    await restart();
    await openReview(r.id);
    assert.deepEqual((await history()).reviews, backed);
    report(
      63,
      "Restart after restore exactly reproduces reviews, endpoints, changes, decisions and comments",
    );
    assert.deepEqual(errors, []);
    report(
      packaged ? 68 : 67,
      `${packaged ? "Packaged" : "Development"} Electron M4 workflow passed; prior milestone gates are recorded by their separate smoke commands`,
    );
    ok = true;
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          success: true,
          packaged,
          runtime,
          checks,
          rendererErrors: errors,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(e);
    fs.writeFileSync(path.join(folder, "failure.txt"), String(e.stack || e));
    if (page) await capture("failure.png").catch(() => {});
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    console.log(
      JSON.stringify(
        { ok, packaged, folder, checks: checks.length, runtime },
        null,
        2,
      ),
    );
  }
})();
