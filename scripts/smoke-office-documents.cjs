// Additional saved-source document fixture: rich text, lists, logo, cards, diagrams and a long editable table.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { randomUUID: id } = require("node:crypto");
(async () => {
  const folder = path.resolve(".test-data", "office-documents-" + id());
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  let app;
  const evidence = { checks: [], errors: [] };
  try {
    app = await electron.launch({
      ...(process.argv[2]
        ? { executablePath: path.resolve(process.argv[2]), args: [] }
        : { args: [path.resolve("out/main/index.js")] }),
      env,
      timeout: 60000,
    });
    const page = await app.firstWindow();
    await page.context().setOffline(true);
    page.on("pageerror", (e) => evidence.errors.push(e.message));
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    const call = (method, ...args) =>
      page.evaluate(({ method, args }) => window.ordo[method](...args), {
        method,
        args,
      });
    const initial = await call("execute", { type: "load" }),
      config = initial.configurations.find((c) => !c.doctrine.catalog);
    let state = await call("execute", {
        type: "create",
        name: "Fictional document coverage",
        demo: true,
        configuration: {
          id: config.organization.id,
          version: config.organization.version,
        },
      }),
      op = state.operation;
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 160;
      const x = c.getContext("2d");
      x.fillStyle = "#315f50";
      x.fillRect(0, 0, 160, 160);
      x.fillStyle = "white";
      x.font = "bold 50px Arial";
      x.fillText("HQ", 40, 98);
      return c.toDataURL("image/png");
    });
    const logoPath = path.join(folder, "fictional-logo.png");
    fs.writeFileSync(logoPath, Buffer.from(png.split(",")[1], "base64"));
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, logoPath);
    const logo = (
      await call("files", {
        type: "asset-import",
        owner: { kind: "operation", id: op.id },
      })
    ).asset;
    op.metadata.documentLayout = {
      schemaVersion: 1,
      header: {
        title: "OPERATION ORDER",
        unit: "Fictional headquarters",
        organization: "Training Directorate",
        location: "Exercise Area",
        dateTime: "19 OCTOBER 2026, 1200 UTC",
        classification: "Unclassified",
        logo,
      },
      footer: {
        left: "Training",
        centre: "Document coverage",
        right: "Exercise copy",
        pageNumbers: true,
      },
    };
    op.modules = { schemaVersion: 1, instances: [], assets: [] };
    const add = (type, title, content, configuration = {}) => {
      const defId = id();
      op.modules.instances.push({
        moduleInstanceId: id(),
        operationId: op.id,
        productInstanceId: op.orderId,
        moduleDefinitionId: null,
        localDefinition: {
          moduleDefinitionId: defId,
          stableKey: "module-" + defId,
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
            notes: "Fictional QA content",
          },
        },
        origin: "OPERATION",
        content,
        position: op.modules.instances.length,
        layoutState: "ACTIVE",
        createdAt: op.createdAt,
        updatedAt: op.updatedAt,
      });
    };
    const t = (text) => ({ type: "text", text }),
      p = (text) => ({ type: "paragraph", content: [t(text)] });
    add("RICH_TEXT", "Formatting and lists", {
      type: "RICH_TEXT",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { ...t("Bold text"), marks: [{ type: "bold" }] },
              t(" / "),
              { ...t("Italic text"), marks: [{ type: "italic" }] },
              t(" / "),
              { ...t("Underlined text"), marks: [{ type: "underline" }] },
              t(" / "),
              {
                ...t("Reference link"),
                marks: [
                  { type: "link", attrs: { href: "https://example.invalid/" } },
                ],
              },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  p("First bullet"),
                  {
                    type: "bulletList",
                    content: [
                      { type: "listItem", content: [p("Nested bullet")] },
                    ],
                  },
                ],
              },
              { type: "listItem", content: [p("Second bullet")] },
            ],
          },
          {
            type: "orderedList",
            attrs: { start: 3 },
            content: [
              { type: "listItem", content: [p("Numbered item three")] },
              { type: "listItem", content: [p("Numbered item four")] },
            ],
          },
          {
            type: "blockquote",
            content: [
              p("First quote paragraph."),
              p("Second quote paragraph."),
            ],
          },
        ],
      },
    });
    const cardId = id();
    op.planningCards = {
      schemaVersion: 1,
      definitions: [
        {
          id: cardId,
          title: "Assigned task",
          mode: "linked",
          source: {
            kind: "entity",
            entityKind: "task",
            entityId: op.tasks[0].id,
          },
          fields: ["name", "purpose", "unit"],
        },
      ],
    };
    add("PLANNING_CARDS", "Planning content", {
      type: "PLANNING_CARDS",
      placements: [{ id: id(), cardId, layout: "detailed" }],
      message: "Planning cards require the current document renderer.",
    });
    add("TASK_ORGANIZATION", "Task organization diagram", {
      type: "TASK_ORGANIZATION",
      presentation: {
        schemaVersion: 1,
        mode: "DIAGRAM",
        ancestorPolicy: "BOUNDARY",
        foldPolicy: "AS_SHOWN",
        symbolSize: 30,
      },
    });
    const columns = ["Unit", "Task", "Notes"].map((label) => ({
      id: id(),
      stableKey: label.toLowerCase(),
      label,
      help: "",
      type: "SHORT_TEXT",
      required: false,
      options: [],
    }));
    add(
      "TABLE",
      "Long task table",
      {
        type: "TABLE",
        rows: Array.from({ length: 55 }, (_, i) => ({
          id: id(),
          cells: {
            [columns[0].id]: "Fictional unit " + (i + 1),
            [columns[1].id]: "Support the exercise",
            [columns[2].id]: "Table row " + (i + 1) + " remains editable.",
          },
        })),
      },
      { columns, allowColumnOverride: true },
    );
    state = await call("execute", {
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    });
    const profile = state.profiles.find((p) => p.product === "opord");
    profile.inclusion.paragraphIds = [];
    profile.inclusion.attachmentIds = [];
    profile.inclusion.packageScope = "selected";
    state = await call("execute", {
      type: "save-profile",
      profile,
      isNew: false,
    });
    const retained = state.profiles.find((p) => p.id === profile.id);
    state = await call("execute", {
      type: "generate",
      operationId: op.id,
      expectedRevision: state.operation.revision,
      profileRef: { id: retained.id, version: retained.version },
      publicationId: null,
    });
    const source = state.exports[0];
    assert.match(source.html, /<svg/);
    assert.match(source.html, /First bullet/);
    fs.writeFileSync(path.join(folder, "source.html"), source.html);
    for (const orientation of ["portrait", "landscape"]) {
      const result = await call("office", {
        type: "generate",
        operationId: op.id,
        expectedRevision: state.operation.revision,
        source: {
          kind: "order",
          exportId: source.id,
          options: { paper: "A4", orientation },
        },
      });
      await app.evaluate(
        ({ dialog }, p) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: p,
          });
        },
        path.join(folder, orientation + ".docx"),
      );
      await call("office", { type: "save", id: result.record.id });
      evidence.checks.push(
        "Generated A4 " + orientation + " DOCX from verified saved modules",
      );
    }
    assert.deepEqual(evidence.errors, []);
  } catch (e) {
    evidence.failure = String(e.stack ?? e);
    process.exitCode = 1;
    console.error(e);
  } finally {
    if (app) {
      const proc = app.process();
      await app.close();
      evidence.exitCode = proc.exitCode;
      assert.equal(proc.exitCode, 0);
    }
    fs.writeFileSync(
      path.join(folder, "result.json"),
      JSON.stringify(evidence, null, 2),
    );
    console.log(folder);
  }
})();
