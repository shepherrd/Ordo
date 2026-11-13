// Normal offline Electron/packaged composition, label-profile and raster acceptance.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID: uid, createHash } = require("node:crypto");
const fixtures = require("../tests/fixtures/milestone6-composition-inputs.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
(async () => {
  const folder = path.resolve(".test-data", `composition-polish-${uid()}`),
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
    cases = [],
    errors = [];
  const report = (step, note) => {
    checks.push({ step, note });
    console.log(`PASS ${step}: ${note}`);
  };
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const nav = async (name) => {
    await page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name: "Symbols & ORBATs", exact: true })
      .click();
    await page
      .getByRole("tab", {
        name: name === "ORBATs" ? "ORBAT maps" : "Symbol editor",
        exact: true,
      })
      .click();
  };
  const launch = async () => {
    app = await electron.launch(options);
    page = await app.firstWindow();
    page.setDefaultTimeout(25000);
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
    const child = app.process();
    await app.close();
    assert.equal(child.exitCode, 0);
    app = null;
  };
  const writeGraphic = async (record, name) => {
    const filename = path.join(folder, name);
    await app.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: filename,
      });
    }, filename);
    await call("saveGraphic", record.id, false);
    assert.equal(hash(fs.readFileSync(filename)), record.contentHash);
  };
  const profile = (format) => ({
    schemaVersion: 1,
    id: uid(),
    version: 1,
    name: `FICTIONAL ${format}`,
    product: "ORBAT",
    format,
    scale: 2,
    background: "WHITE",
    size: 30,
    foldPolicy: "AS_SHOWN",
    ancestorPolicy: "BOUNDARY",
    selectedUnitIds: null,
    renderProfile: { id: "ordo-symbol", version: 1 },
  });
  const waitPreview = async (expectedSvg) => {
    // Selecting a saved map is asynchronous. The prior record can still
    // have an idle canvas before the new preview request begins. Require the
    // exact current render, not merely any previously completed SVG.
    await page.waitForFunction(
      (svg) => {
        const canvas = document.querySelector(
          ".orbat-canvas-workspace .graphic-canvas",
        );
        const expected = document.createElement("template");
        expected.innerHTML = svg;
        return (
          canvas?.getAttribute("aria-busy") === "false" &&
          (() => {
            const clone = canvas.querySelector("svg")?.cloneNode(true);
            for (const n of clone?.querySelectorAll("[data-unit-id]") ?? [])
              for (const a of [
                "role",
                "aria-label",
                "aria-pressed",
                "tabindex",
              ])
                n.removeAttribute(a);
            return clone?.outerHTML;
          })() === expected.content.firstElementChild?.outerHTML
        );
      },
      expectedSvg,
      { timeout: 25000 },
    );
  };
  try {
    await launch();
    // The UI makes adoption explicit; existing definitions still default to profile 1.
    await nav("Military Symbols");
    await page.getByRole("button", { name: "New symbol", exact: true }).click();
    await page
      .getByLabel("New symbol name", { exact: true })
      .fill("FICTIONAL SEPARATED LABELS");
    await page
      .getByRole("button", { name: "Create symbol", exact: true })
      .click();
    await page.locator(".symbol-preview-options > summary").click();
    const choice = page.getByLabel("ORBAT label layout", { exact: true });
    assert.equal(await choice.inputValue(), "1");
    await choice.selectOption("2");
    await page
      .getByLabel("Symbol preview context", { exact: true })
      .selectOption("ORBAT_NODE");
    await page
      .getByRole("button", { name: "Save symbol", exact: true })
      .click();

    await page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
    assert(await choice.isEnabled());
    const symbols = (
      await call("symbols", {
        type: "browse",
        kind: "SYMBOL",
        query: {
          search: "FICTIONAL SEPARATED LABELS",
          status: "",
          offset: 0,
          limit: 10,
        },
      })
    ).page.items;
    assert.equal(
      (
        await call("symbols", {
          type: "get",
          kind: "SYMBOL",
          id: symbols[0].versionId,
        })
      ).symbol.definition.renderProfile.version,
      2,
    );
    report(
      "explicit-profile",
      "Profile 1 remains the default; explicit profile-2 selection is saved without a catalog publishing lifecycle",
    );
    for (const fixture of fixtures.cases) {
      for (const variant of ["profile-1", "profile-2", "mixed-profiles"]) {
        const caseId = `${fixture.id}-${variant}`;
        const old = (
          await call("renderGraphic", uid(), {
            kind: "ORBAT",
            input: fixture.input,
          })
        ).result;
        assert.equal(old.svgHash, fixture.profile1SvgHash);
        const input = structuredClone(fixture.input);
        for (const [i, n] of input.nodes.entries())
          if (n.symbol)
            n.symbol.renderProfile.version =
              variant === "profile-1"
                ? 1
                : variant === "profile-2"
                  ? 2
                  : i % 2 === 0
                    ? 2
                    : 1;
        const nodeProfiles = Object.fromEntries(
          input.nodes
            .filter((n) => n.symbol)
            .map((n) => [n.id, n.symbol.renderProfile]),
        );
        const rendered = (
          await call("renderGraphic", uid(), { kind: "ORBAT", input })
        ).result;
        assert.equal(
          (
            await call("renderGraphic", uid(), {
              kind: "ORBAT",
              input: fixture.input,
            })
          ).result.svgHash,
          fixture.profile1SvgHash,
        );
        let orbat = (
          await call("symbols", {
            type: "new",
            kind: "ORBAT",
            name: `FICTIONAL ${caseId}`,
          })
        ).orbat;
        const identity = require("./fixture-orbat-unit.cjs").fixtureOrbatUnit(
          orbat.rootNodeId,
          orbat.name,
        ).unit.identity;
        orbat.rootNodeId = input.nodes.find((n) => n.parentId === null).id;
        orbat.layout = input.layout;
        orbat.nodes = input.nodes.map((n, i) => ({
          nodeId: n.id,
          parentNodeId: n.parentId,
          nameOverride: null,
          annotation: n.symbol?.amplifiers.additionalInformation || "",
          symbolOverride: null,
          unit: {
            kind: "INLINE_UNIT",
            identity: {
              ...identity,
              fullDesignation:
                n.symbol?.amplifiers.uniqueDesignation || `FICTIONAL ${i}`,
              shortDesignation:
                n.symbol?.amplifiers.uniqueDesignation || `FICTIONAL ${i}`,
            },
            symbol: n.symbol ? { definition: n.symbol, source: null } : null,
          },
        }));
        orbat = (
          await call("symbols", {
            type: "save-orbat",
            value: orbat,
            expected: orbat.contentVersion,
          })
        ).orbat;
        await nav("ORBATs");
        await page.getByLabel("Find ORBAT map", { exact: true }).fill(caseId);
        await page
          .getByLabel("ORBAT map", { exact: true })
          .selectOption(orbat.versionId);
        await waitPreview(rendered.svg);
        const measured = await page
          .locator(".orbat-canvas-workspace .graphic-canvas")
          .evaluate((canvas, profiles) => {
            const root = canvas.querySelector("svg"),
              bounds = root.getBoundingClientRect();
            const clipped = [],
              collisions = [];
            const overlaps = (a, b) =>
              Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
            for (const group of root.querySelectorAll("g[data-unit-id]")) {
              const texts = [...group.querySelectorAll("text")].filter(
                (t) => t.textContent && t.textContent !== "!",
              );
              const marks = [
                ...group.querySelectorAll('svg[width="57.6"],text'),
              ].filter((t) => t.tagName === "svg" || t.textContent === "!");
              for (const t of texts) {
                const b = t.getBoundingClientRect();
                if (
                  b.left < bounds.left - 1 ||
                  b.top < bounds.top - 1 ||
                  b.right > bounds.right + 1 ||
                  b.bottom > bounds.bottom + 1
                )
                  clipped.push({
                    unit: group.getAttribute("data-unit-id"),
                    text: t.textContent,
                    profile:
                      profiles[group.getAttribute("data-unit-id")] ?? null,
                  });
                for (const mark of marks)
                  if (overlaps(b, mark.getBoundingClientRect()))
                    collisions.push({
                      unit: group.getAttribute("data-unit-id"),
                      text: t.textContent,
                      mark: mark.tagName === "svg" ? "small flag" : "signature",
                      profile:
                        profiles[group.getAttribute("data-unit-id")] ?? null,
                    });
              }
            }
            return {
              labels: root.querySelectorAll("text").length,
              clipped,
              collisions,
            };
          }, nodeProfiles);
        // Profile 1 deliberately retains historical placement, including its known
        // overlaps. Do not silently turn those differences into parity successes.
        assert.deepEqual(
          measured.clipped.filter((v) => v.profile?.version === 2),
          [],
          caseId,
        );
        assert.deepEqual(
          measured.collisions.filter((v) => v.profile?.version === 2),
          [],
          caseId,
        );
        const screen = await app.evaluate(async ({ BrowserWindow }) =>
          (
            await BrowserWindow.getAllWindows()[0].webContents.capturePage(
              undefined,
              { stayHidden: true, stayAwake: true },
            )
          )
            .toPNG()
            .toString("base64"),
        );
        fs.writeFileSync(
          path.join(folder, `${caseId}-ui.png`),
          Buffer.from(screen, "base64"),
        );
        const source = {
          kind: "SAVED_ORBAT",
          versionId: orbat.versionId,
          expectedContentVersion: orbat.contentVersion,
        };
        const svg = await call("exportGraphic", {
          source,
          profile: profile("SVG"),
        });
        const png = await call("exportGraphic", {
          source,
          profile: profile("PNG"),
        });
        assert.equal(png.raster.svgHash, png.renderedSvgHash);
        assert.equal(svg.renderedSvgHash, png.renderedSvgHash);
        assert.equal(svg.renderedSvgHash, rendered.svgHash, caseId);
        assert.deepEqual(svg.renderManifests, rendered.renderManifests);
        assert.deepEqual(
          svg.renderManifests.map((m) => m.renderProfile),
          png.renderManifests.map((m) => m.renderProfile),
        );
        for (const record of [svg, png]) {
          assert.equal(record.source.kind, "SAVED_ORBAT");
          assert.deepEqual(
            Object.fromEntries(
              record.source.snapshot.nodes
                .filter((n) => n.unit.symbol)
                .map((n) => [n.nodeId, n.unit.symbol.definition.renderProfile]),
            ),
            nodeProfiles,
          );
        }
        if (variant === "profile-1")
          assert(
            svg.renderManifests.every((m) => m.renderProfile.version === 1),
          );
        else
          assert(
            svg.renderManifests.some((m) => m.renderProfile.version === 2),
          );
        if (variant === "mixed-profiles" && fixture.id !== "root-fold") {
          assert(
            svg.renderManifests.some((m) => m.renderProfile.version === 1),
          );
        }
        await writeGraphic(svg, `${caseId}.svg`);
        await writeGraphic(png, `${caseId}.png`);
        if (cases.length === 0) {
          // Inspect the real IPC-to-ClipboardItem handoff without replacing the
          // user's system clipboard. This is not an OS paste acceptance claim.
          await app.evaluate(({ clipboard }) => {
            globalThis.polishClipboardWrite = clipboard.write;
            clipboard.write = async (items) => {
              globalThis.polishClipboardItems = items;
            };
          });
          try {
            for (const record of [svg, png]) {
              await call("saveGraphic", record.id, true);
              const payloads = await app.evaluate(async () => {
                const result = {};
                for (const item of globalThis.polishClipboardItems)
                  for (const type of item.types)
                    result[type] = Buffer.from(
                      await (await item.getType(type)).arrayBuffer(),
                    ).toString("base64");
                return result;
              });
              const type = record === svg ? "image/svg+xml" : "image/png";
              assert.equal(
                hash(Buffer.from(payloads[type], "base64")),
                record.contentHash,
              );
              if (record === svg)
                assert.equal(
                  hash(Buffer.from(payloads["text/plain"], "base64")),
                  record.contentHash,
                );
            }
          } finally {
            await app.evaluate(({ clipboard }) => {
              clipboard.write = globalThis.polishClipboardWrite;
              delete globalThis.polishClipboardWrite;
              delete globalThis.polishClipboardItems;
            });
          }
          report(
            "clipboard-payload-handoff",
            "SVG text/vector and PNG payloads match retained bytes; system clipboard left untouched.",
          );
        }
        cases.push({
          id: caseId,
          fixture: fixture.id,
          variant,
          nodeProfiles,
          originalProfile1Hash: old.svgHash,
          renderedHash: rendered.svgHash,
          renderProfiles: svg.renderManifests.map((m) => ({
            inputHash: m.inputHash,
            definitionHash: m.definitionHash,
            renderProfile: m.renderProfile,
            compatibilityLayer: m.compatibilityLayer,
          })),
          synthetic: rendered.layout.nodes
            .filter((n) => n.synthetic)
            .map((n) => n.synthetic),
          measured,
          orbatVersionId: orbat.versionId,
          svgHash: svg.contentHash,
          pngHash: png.contentHash,
          raster: png.raster,
          svg: svg.id,
          png: png.id,
        });
        report(
          caseId,
          "Historical profile-1 hash retained; profile-2 labels have no measured mark overlap or clipping; exact profile identities and SVG/PNG source hashes retained. Historical overlap observations require visual review.",
        );
      }
    }
    const before = await call("graphicExports");
    await close();
    await launch();
    assert.deepEqual(await call("graphicExports"), before);
    for (const c of cases) {
      const restored = (
        await call("symbols", {
          type: "get",
          kind: "ORBAT",
          id: c.orbatVersionId,
        })
      ).orbat;
      assert.deepEqual(
        Object.fromEntries(
          restored.nodes
            .filter((n) => n.unit.symbol)
            .map((n) => [n.nodeId, n.unit.symbol.definition.renderProfile]),
        ),
        c.nodeProfiles,
      );
      await writeGraphic(
        { id: c.svg, contentHash: c.svgHash },
        `${c.id}-reopened.svg`,
      );
      await writeGraphic(
        { id: c.png, contentHash: c.pngHash },
        `${c.id}-reopened.png`,
      );
    }
    await close();
    assert.deepEqual(errors, []);
    report(
      "normal-reopen",
      "Exact retained profile-1/profile-2/mixed SVG/PNG bytes and per-node profiles survive normal exit-code-zero shutdown and reopen",
    );
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          packaged,
          checks,
          cases,
          errors,
          parityClaim: false,
          visualReview: "PENDING",
          knownDifferences: [
            "Profile 1 retains historical crowded placement; recorded overlaps are observations, not parity successes.",
            "Profile 2 spacing is explicitly user-accepted; each packaged whole composition still requires visual review.",
            "Replacement text metrics, viewport extents and NATO artwork remain distinct from reference.",
            "SIMPLE compositions may require horizontal scrolling or zoom.",
          ],
        },
        null,
        2,
      ),
    );
    console.log(`Evidence: ${folder}`);
  } catch (error) {
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        { packaged, checks, cases, errors, failure: String(error) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    if (app) await close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
