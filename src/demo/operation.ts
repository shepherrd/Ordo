import { createOperation } from "../domain/factories";
import { metadata, type ResolvedConfig } from "../domain/model";
import { instantiateProduct } from "../domain/authoring";

// Fictional fixture only. This file is deliberately separate from doctrine/configuration.
export function demoOperation(
  config: ResolvedConfig,
  id: () => string,
  now: string,
) {
  const op = createOperation("DEMO OPERATION", config, id, now);
  op.demo = true;
  op.orderNumber = "DEMO-001";
  op.metadata.ownerId = "ops";
  const unitA = id(),
    unitB = id(),
    phase1 = id(),
    phase2 = id(),
    objective = id(),
    event = id();
  op.units = [
    {
      id: unitA,
      name: "DEMO UNIT A",
      inTaskOrganization: true,
      parentUnitId: null,
      metadata: metadata(),
    },
    {
      id: unitB,
      name: "DEMO UNIT B",
      inTaskOrganization: false,
      parentUnitId: null,
      metadata: metadata(),
    },
  ];
  op.phases = [
    { id: phase1, name: "DEMO PHASE I", sequence: 1, metadata: metadata() },
    { id: phase2, name: "DEMO PHASE II", sequence: 2, metadata: metadata() },
  ];
  op.objectives = [
    {
      id: objective,
      name: "DEMO OBJ ALPHA",
      description: "Fictional software demonstration objective.",
      metadata: metadata(),
    },
  ];
  op.tasks = [
    {
      id: id(),
      name: "Review the demo workspace",
      unitId: unitA,
      phaseId: phase1,
      objectiveId: objective,
      purpose: "Demonstrate a reusable task and purpose relationship.",
      metadata: metadata(),
    },
  ];
  op.events = [
    {
      id: event,
      name: "DEMO H-HOUR",
      at: "2026-10-01T14:00:00.000Z",
      relativeToEventId: null,
      offsetMinutes: 0,
      phaseId: phase1,
      metadata: metadata(),
    },
    {
      id: id(),
      name: "DEMO REVIEW",
      at: null,
      relativeToEventId: event,
      offsetMinutes: 60,
      phaseId: phase1,
      metadata: metadata(),
    },
  ];
  op.sections.forEach((s) => {
    s.summary = `Fictional ${s.id} summary for software demonstration only.`;
  });
  op.signal.concept =
    "Fictional communications data for demonstrating one authoritative source.";
  op.signal.architecture =
    "DEMO architecture notes. Included in the full Signal view.";
  op.signal.spectrumNotes =
    "DEMO spectrum notes. Excluded from communications cards.";
  op.signal.maintenanceNotes =
    "DEMO maintenance notes. Excluded from communications cards.";
  op.signal.nets = [
    {
      id: id(),
      name: "DEMO CMD NET 1",
      purpose: "Demonstrate shared Signal data",
      participantUnitIds: [unitA],
      phaseIds: [phase1, phase2],
      system: "DEMO SYSTEM",
      channel: "DEMO CHANNEL 01",
      callsign: "DEMO ALPHA",
      metadata: { ...metadata(), ownerId: "signal" },
    },
    {
      id: id(),
      name: "DEMO SUPPORT NET",
      purpose: "Demonstrate a cross-object validation finding",
      participantUnitIds: [unitB],
      phaseIds: [phase2],
      system: "DEMO SYSTEM",
      channel: "DEMO CHANNEL 02",
      callsign: "DEMO BRAVO",
      metadata: metadata(),
    },
  ];
  op.signal.pacePlans = [
    {
      id: id(),
      name: "DEMO PACE",
      unitIds: [unitA],
      phaseIds: [],
      primary: "DEMO PRIMARY",
      alternate: "DEMO ALTERNATE",
      contingency: "DEMO CONTINGENCY",
      emergency: "DEMO EMERGENCY",
      lostCommunications:
        "DEMO instruction placeholder; no operational guidance.",
      metadata: metadata(),
    },
  ];
  if (config.doctrine.catalog) {
    op.name = "DEMO BRIGADE OPERATION";
    op.units[0].name = "DEMO BRIGADE HQ";
    op.units[1].name = "DEMO BATTALION";
    op.units[1].inTaskOrganization = true;
    op.units[1].parentUnitId = op.units[0].id;
    op.sections.forEach((s) => {
      s.summary = "";
    });
    const fields = config.doctrine.catalog.baseFields;
    const mission = fields.find((f) => f.stableKey === "mission-statement")!;
    op.authoring!.fields.push({
      fieldId: mission.id,
      text: "Fictional brigade workspace for software acceptance. Complete the demonstration review to verify shared planning data.",
      references: [
        { kind: "task", id: op.tasks[0].id },
        { kind: "event", id: event },
      ],
    });
    for (const key of ["A", "H"])
      instantiateProduct(
        op,
        config,
        config.doctrine.catalog.nodes.find((n) => n.stableKey === key)!.id,
        id,
      ).applicability = "INCLUDED";
    return op;
  }
  op.attachments = config.doctrine.annexCatalog.map((a) => ({
    id: id(),
    name: a.title,
    kind: "annex" as const,
    parentId: op.orderId,
    code: a.code,
    catalogId: a.id,
    narrative: "",
    phaseIds: [],
    unitIds: [],
    required: false,
    metadata: { ...metadata(), ownerId: a.ownerId },
  }));
  const annexH = op.attachments.find((a) => a.code === "H")!;
  const appendix = id(),
    tab = id();
  op.attachments.push(
    {
      id: appendix,
      name: "DEMO appendix",
      kind: "appendix",
      parentId: annexH.id,
      code: "1",
      catalogId: null,
      narrative: "Fictional attachment hierarchy example.",
      phaseIds: [],
      unitIds: [],
      required: false,
      metadata: metadata(),
    },
    {
      id: tab,
      name: "DEMO tab",
      kind: "tab",
      parentId: appendix,
      code: "A",
      catalogId: null,
      narrative: "",
      phaseIds: [],
      unitIds: [],
      required: false,
      metadata: metadata(),
    },
    {
      id: id(),
      name: "DEMO exhibit",
      kind: "exhibit",
      parentId: tab,
      code: "1",
      catalogId: null,
      narrative: "",
      phaseIds: [],
      unitIds: [],
      required: false,
      metadata: metadata(),
    },
  );
  return op;
}
