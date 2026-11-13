import {
  metadata,
  type Operation,
  type ResolvedConfig,
  type ExportProfile,
} from "./model";

export function createOperation(
  name: string,
  config: ResolvedConfig,
  id: () => string,
  now: string,
): Operation {
  return {
    schemaVersion: config.doctrine.catalog ? 2 : 1,
    ...(config.doctrine.catalog ? { authoring: { fields: [] } } : {}),
    id: id(),
    name,
    orderNumber: "DRAFT-001",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    demo: false,
    doctrineRef: { id: config.doctrine.id, version: config.doctrine.version },
    organizationRef: {
      id: config.organization.id,
      version: config.organization.version,
    },
    echelonRef: { id: config.echelon.id, version: config.echelon.version },
    metadata: metadata(config.doctrine.editingStatus),
    orderId: id(),
    sections: config.doctrine.paragraphs.map((p) => ({
      id: p.id,
      summary: "",
    })),
    units: [],
    phases: [],
    objectives: [],
    tasks: [],
    events: [],
    attachments: [],
    signal: {
      id: id(),
      concept: "",
      architecture: "",
      spectrumNotes: "",
      maintenanceNotes: "",
      nets: [],
      pacePlans: [],
    },
  };
}
export function createExportProfile(
  op: Operation,
  product: ExportProfile["product"],
  id: string,
): ExportProfile {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    name: product === "opord" ? "Full OPORD package" : "Communications card",
    operationId: op.id,
    product,
    inclusion: {
      audienceUnitIds: [],
      phaseIds: [],
      netIds: [],
      netFields: ["purpose", "participants", "system", "channel", "callsign"],
      includeNetName: true,
      includePace: true,
      includeLostCommunications: true,
      paragraphIds: op.sections.map((s) => s.id),
      attachmentIds: op.attachments.map((a) => a.id),
      ...(op.schemaVersion === 2 ? { packageScope: "included" as const } : {}),
    },
    rendering: {
      detail: product === "opord" ? "full" : "quick-reference",
      title: product === "opord" ? "OPERATION ORDER" : "COMMUNICATIONS CARD",
    },
  };
}
