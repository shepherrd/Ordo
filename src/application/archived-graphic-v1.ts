import type {
  GraphicExportProfile,
  GraphicExportRecord,
} from "../domain/graphic-exports";
import type { Operation } from "../domain/model";
import {
  diagramFromOperation,
  diagramFromSaved,
  selectOperationDiagram,
} from "../domain/diagram";
import { newOrbatLayout, m6Limits } from "../domain/orbat";
import { subtreeIds } from "../domain/organization-editing";
import {
  militarySymbolDefinitionSchema,
  type MilitarySymbolDefinition,
} from "../domain/symbology";
import type { ConversionField } from "../domain/library-exchange";
import flags from "./legacy-flag-identifiers-v1.json";
import { canonical } from "../export/projections/v1";

export function projectArchivedGraphic(
  source: GraphicExportRecord["source"],
  profile: GraphicExportProfile,
  op?: Operation,
) {
  const fields: ConversionField[] = [],
    dependencies: GraphicExportRecord["dependencies"] = [];
  const report = (
    path: string,
    action: ConversionField["action"],
    from: unknown,
    to: unknown,
    detail: string,
  ) => {
    if (fields.length >= 100000)
      throw Error(
        "reference conversion report exceeds 100,000 fields; export a smaller subtree",
      );
    fields.push({
      path,
      action,
      source: (JSON.stringify(from) ?? "absent").slice(0, 1800),
      target: (JSON.stringify(to) ?? "absent").slice(0, 1800),
      detail,
    });
  };
  const consume = (path: string, v: unknown) =>
    dependencies.push({ path, canonicalValue: canonical(v) });
  const options = (
    input: MilitarySymbolDefinition,
    path: string,
    orbat = false,
  ) => {
    const d = militarySymbolDefinitionSchema.parse(input),
      { convention, ...appearance } = d.appearance;
    const result: Record<string, unknown> = {
      sidc: d.code.sidc,
      ...d.amplifiers,
      ...appearance,
      standard: convention,
      stack: d.compatibility.stack,
      generalStars: d.compatibility.generalStars,
      reinforced: d.compatibility.reinforced,
      signature: d.compatibility.signature,
      specialheadquarter: d.compatibility.specialHeadquarters,
      full_frame_flag: d.compatibility.flagMode === "FULL_FRAME",
    };
    if (orbat) {
      result.infoFields = false;
      report(
        path + "/orbatRendering",
        "OMITTED",
        { infoFields: d.appearance.infoFields },
        { infoFields: false, rootSize: 40, childSize: 30, padding: 20 },
        "reference ORBAT renders labels separately and forces information fields off, size 40/30 and padding 20; it does not retain Ordo's diagram viewport or symbol size",
      );
    } else {
      result.infoFields = false;
      report(
        path + "/favoriteRendering",
        "OMITTED",
        { infoFields: d.appearance.infoFields },
        { infoFields: false, size: 22 },
        "reference favorites force information fields off and size 22 for their cards; labels remain explicit options. Use native Ordo JSON to retain the complete definition.",
      );
    }
    const flag = d.compatibility.flagId;
    if (flag) {
      const candidates = Object.entries(flags.entries)
        .filter(([, v]) => v.target === flag)
        .map(([key]) => key);
      if (candidates.length === 1) result.country_flag = candidates[0];
      else
        report(
          path + "/flagId",
          "INVALID",
          flag,
          null,
          "No unique verified reference flag identifier; choose another flag or export native Ordo JSON",
        );
      report(
        path + "/flagArtwork",
        "OMITTED",
        flag,
        "reference reference artwork",
        "reference uses its own artwork, including the documented NATO difference",
      );
    }
    for (const [key, value] of Object.entries(result))
      report(
        path + "/" + key,
        "COPIED",
        value,
        value,
        "Explicit reference option; SIDC is retained without conversion",
      );
    report(
      path + "/renderProfile",
      "OMITTED",
      d.renderProfile,
      null,
      "reference does not preserve Ordo render profiles; profile-2 spacing and pinned metrics do not round-trip",
    );
    report(
      path + "/provenance",
      "OMITTED",
      {
        definitionId: d.definitionId,
        origin: d.origin,
        standard: d.code.assertedStandard,
      },
      null,
      "Stable identity, source provenance, and standard assertions remain in Ordo's retained export record",
    );
    consume(path + "/options", result);
    consume(path + "/sourceInfoFields", d.appearance.infoFields);
    consume(path + "/renderProfile", d.renderProfile);
    consume(path + "/provenance", {
      definitionId: d.definitionId,
      origin: d.origin,
      standard: d.code.assertedStandard,
    });
    return result;
  };
  let payload: unknown,
    count = 1;
  if (source.kind === "SAVED_SYMBOL")
    payload = [options(source.snapshot.definition, "symbol")];
  else {
    const diagram =
      source.kind === "SAVED_ORBAT"
        ? diagramFromSaved(source.snapshot)
        : diagramFromOperation(
            op!,
            newOrbatLayout(() => op!.id),
          );
    const roots =
      profile.selectedUnitIds ??
      diagram.nodes.filter((n) => !n.parentId).map((n) => n.id);
    if (roots.length !== 1)
      throw Error(
        "reference JSON requires one root. Select one unit to export its complete subtree.",
      );
    const included = subtreeIds(diagram.nodes, roots[0]),
      rank = new Map(diagram.layout.siblingOrder.map((id, i) => [id, i]));
    const order = new Map(
      diagram.nodes.map((n, i) => [
        n.id,
        rank.get(n.id) ?? diagram.nodes.length + i,
      ]),
    );
    const visible =
      source.kind === "OPERATION"
        ? selectOperationDiagram(op!, diagram.layout, {
            ...profile,
            selectedUnitIds: [...included],
            ancestorPolicy: "BOUNDARY",
          })
        : diagram;
    const nodes = visible.nodes
      .filter((n) => included.has(n.id))
      .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    count = nodes.length;
    type ArchivedNode = {
      options: Record<string, unknown>;
      subOrganizations: ArchivedNode[];
    };
    const table = new Map<string, ArchivedNode>(),
      hints = new Map(diagram.layout.hints.map((h) => [h.nodeId, h]));
    for (const n of nodes) {
      if (!n.symbol)
        throw Error(
          `Unit ${n.name} has no symbol; assign one before reference export`,
        );
      const path = `units/${n.id}`,
        opts = options(n.symbol, path, true),
        hint = hints.get(n.id);
      if (hint) {
        opts.hideSubOrganizations = hint.folded;
        opts.hqStaffElement = hint.hqStaff;
      }
      if (hint?.offset)
        report(
          path + "/offset",
          "OMITTED",
          hint.offset,
          null,
          "reference recalculates positions and does not retain Ordo manual offsets",
        );
      consume(path + "/hierarchy", {
        parentId: n.id === roots[0] ? null : n.parentId,
      });
      consume(path + "/layoutHint", hint ?? null);
      table.set(n.id, { options: opts, subOrganizations: [] });
    }
    for (const n of nodes)
      if (n.id !== roots[0])
        table.get(n.parentId!)!.subOrganizations.push(table.get(n.id)!);
    payload = {
      ...table.get(roots[0])!,
      commandLevels: diagram.layout.commandLevels,
    };
    consume(
      "layout/order",
      nodes.map((n) => n.id),
    );
    consume("layout/commandLevels", diagram.layout.commandLevels);
    consume("layout/mode", diagram.layout.mode);
    report(
      "layout/mode",
      "OMITTED",
      diagram.layout.mode,
      null,
      "reference's JSON format does not persist SMART/SIMPLE or viewport settings",
    );
  }
  report(
    "source/libraryAndOperationState",
    "OMITTED",
    source.kind,
    null,
    "reference JSON contains symbol options and tree relationships only; library versions, exact pins, task links, publications and review history stay in Ordo",
  );
  const text = JSON.stringify(payload, null, 2) + "\n";
  if (new TextEncoder().encode(text).byteLength > m6Limits.jsonBytes)
    throw Error("reference export exceeds 10 MiB");
  return {
    text,
    fields,
    dependencies,
    nodes: count,
    canExport: !fields.some((f) => f.action === "INVALID"),
  };
}

// Retired report wording formed part of the archived approval. Verify its exact
// bytes even though the writer and its display labels have been removed.
const archivedWording = new Map<string, string>([
  [
    "reference ORBAT renders labels separately and forces information fields off, size 40/30 and padding 20; it does not retain Ordo's diagram viewport or symbol size",
    "a7430fb62ad584b9261062df3b1357c949ed322624d8dcbb56c3807266c65527",
  ],
  [
    "reference favorites force information fields off and size 22 for their cards; labels remain explicit options. Use native Ordo JSON to retain the complete definition.",
    "63e7bef0af91e189a18be577de4b6a5266f190ea06180dea69eae8d9d54aed8e",
  ],
  [
    "No unique verified reference flag identifier; choose another flag or export native Ordo JSON",
    "bdf80de990ae12ac1f570923231fede678411cc8a3b8cad3de35dea8ee0cf0ff",
  ],
  [
    "reference uses its own artwork, including the documented NATO difference",
    "c07d835a9ffc7e5599f6995801d364869617731f00a39950782bfb4cbefb1a6b",
  ],
  [
    "Explicit reference option; SIDC is retained without conversion",
    "2d2221641942ebe16c35aa96531296030d7cf79bdfbeafb1105accb4e9266b2e",
  ],
  [
    "reference does not preserve Ordo render profiles; profile-2 spacing and pinned metrics do not round-trip",
    "6cca1e06f2a6ace06ee9ed1f48667e5378d49ed541a4385cbfbd690b18f2c374",
  ],
  [
    "reference recalculates positions and does not retain Ordo manual offsets",
    "e78ce65d9236725c2390348cb80e000f1a3b84837e7b9b2612dbf726475620e1",
  ],
  [
    "reference's JSON format does not persist SMART/SIMPLE or viewport settings",
    "a645d6ed0f255a897d58e1f45ec9d64d4bc9f89d0b6f9db6ff047f0f1425b439",
  ],
  [
    "reference JSON contains symbol options and tree relationships only; library versions, exact pins, task links, publications and review history stay in Ordo",
    "28678fd2320d30397e62f8e6201931fa002db91530aac6f96868b0c2e43058c7",
  ],
]);
const flagArtworkTargetDigest =
  "1b57ea55cdc00735e38d9f5f3b63e642af7ef5e798f659a62674dcf5369229e0";

export function verifyArchivedGraphic(
  record: GraphicExportRecord,
  bytes: Uint8Array,
  hash: (v: string) => string,
  op?: Operation,
) {
  if (record.schemaVersion !== 3) return;
  const p = projectArchivedGraphic(record.source, record.profile, op);
  const report = record.compatibilityReport!;
  // Prose in an archived report is part of its signed-off fingerprint.
  const fingerprint = hash(
    canonical({
      source: record.source,
      profile: record.profile,
      fields: report.fields,
      dependencies: p.dependencies,
      text: p.text,
    }),
  );
  const sameFields =
    p.fields.length === report.fields.length &&
    p.fields.every((field, index) => {
      const saved = report.fields[index];
      const expectedDetail =
        archivedWording.get(field.detail) ?? hash(field.detail);
      const expectedTarget = field.path.endsWith("/flagArtwork")
        ? flagArtworkTargetDigest
        : hash(field.target);
      return (
        field.path === saved.path &&
        field.action === saved.action &&
        field.source === saved.source &&
        hash(saved.target) === expectedTarget &&
        hash(saved.detail) === expectedDetail
      );
    });
  if (
    !p.canExport ||
    report.nodes !== p.nodes ||
    report.fingerprint !== fingerprint ||
    new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== p.text ||
    canonical(record.dependencies) !== canonical(p.dependencies) ||
    !sameFields
  )
    throw Error("Archived export bytes, dependencies or loss report mismatch");
}
