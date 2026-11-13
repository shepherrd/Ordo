// Reproducible build-time seed authoring. Keys are permanent identities, not labels.
// This script is never run by the desktop app and never updates installed profiles.
const fs = require("node:fs");
const crypto = require("node:crypto");
const legacy = JSON.parse(fs.readFileSync("src/config/doctrine.json", "utf8"));
const uuid = (key) => {
  const h = crypto
    .createHash("sha256")
    .update("ordo-us-army-orders-v1:" + key)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const url =
  "https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN44590-FM_5-0-001-WEB-3.pdf";
const ref = (locator) => ({
  title: "Planning and Orders Production",
  publicationIdentifier: "FM 5-0",
  editionDate: "2024-11-04",
  changeNumber: 1,
  changeDate: "2025-08-08",
  locator,
  url,
});
const names = [
  "Task Organization",
  "Intelligence",
  "Operations",
  "Fires",
  "Protection",
  "Sustainment",
  "Engineer",
  "Signal",
  "Air and Missile Defense",
  "Public Affairs",
  "Civil Affairs Operations",
  "Information Collection",
  "Assessment",
  "Space Operations",
  "Spare",
  "Host-Nation Support",
  "Knowledge Management",
  "Reports",
  "Special Technical Operations",
  "Spare",
  "Inspector General",
  "Interorganization-Interagency Coordination",
  "Operational Contract Support",
  "Spare",
  "Spare",
  "Distribution",
];
const owners = [
  "ops",
  "intel",
  "ops",
  "fires",
  "protection",
  "sustainment",
  "engineer",
  "signal",
  "amd",
  "pa",
  "civil",
  "ops",
  "ops",
  "space",
  null,
  "sustainment",
  "km",
  "ops",
  "sto",
  null,
  "ig",
  "ops",
  "sustainment",
  null,
  null,
  "ops",
];
const staff = {
  ops: "G-5 / G-3 / S-3",
  intel: "G-2 / S-2",
  fires: "Chief of Fires / Deputy FSCOORD / FSO",
  protection: "Chief of Protection / designated officer",
  sustainment: "G-4 / S-4",
  engineer: "Engineer Officer",
  signal: "G-6 / S-6",
  amd: "Air and Missile Defense Officer",
  pa: "Public Affairs Officer",
  civil: "G-9 / S-9",
  space: "Space Operations Officer",
  km: "Knowledge Management Officer",
  sto: "Special Technical Operations Officer",
  ig: "Inspector General",
};
const nodes = [];
function add(key, title, options = {}) {
  const parts = key.split("."),
    parent = parts.length > 1 ? parts.slice(0, -1).join(".") : null;
  const root = parts[0],
    owner = owners[root.charCodeAt(0) - 65];
  const n = {
    id: uuid(key),
    stableKey: key,
    nodeType: ["ANNEX", "APPENDIX", "TAB", "EXHIBIT"][parts.length - 1],
    code: parts.at(-1),
    canonicalTitle: title,
    aliases: [],
    parentStableKey: parent,
    sourceClass: "FM5_TABLE_D2",
    sourceReferences: [ref("Table D-2")],
    sourceNotes: "",
    status: title === "Spare" ? "SPARE" : "ACTIVE",
    formatType: parts.length === 1 ? "STANDARD_FIVE_PARAGRAPH" : "CUSTOM",
    responsibleStaff: parent ? [] : owner ? [owner] : [],
    supportingStaff: [],
    ownerBehavior: parent ? "INHERIT_PARENT" : "EXPLICIT",
    defaultApplicability: "AS_REQUIRED",
    purpose: "",
    normalApplicabilityNotes:
      "Use when applicable to the operation; inclusion is a planner decision.",
    echelonNotes:
      "Organization-independent baseline. Staff labels support G- and S-staff usage.",
    editorHint:
      parts.length === 1
        ? "FIVE_PARAGRAPH_ATTACHMENT"
        : "GENERIC_STRUCTURED_PRODUCT",
    editorSourceClass: "ORDO_DEFAULT",
    expectedContentTypes: ["narrative", "references"],
    primaryInputs: [],
    primaryOutputs: [],
    crossReferences: [],
    specialistDoctrineSources: [],
    organizationExtensionAllowed: true,
    canonicalTableD2: true,
    sourceVariants: [],
    ...options,
  };
  if (n.sourceClass !== "FM5_TABLE_D2") {
    n.canonicalTableD2 = false;
    n.sourceReferences = [ref(`Appendix E, sample format for Annex ${root}`)];
  }
  nodes.push(n);
  return n;
}
names.forEach((name, i) => add(String.fromCharCode(65 + i), name));
function children(parent, titles, alpha = false) {
  titles.forEach((t, i) =>
    add(parent + "." + (alpha ? String.fromCharCode(65 + i) : i + 1), t),
  );
}
const set = (key, value) =>
  Object.assign(
    nodes.find((n) => n.stableKey === key),
    value,
  );
children("B", [
  "Intelligence Estimate",
  "Counterintelligence",
  "Signals Intelligence",
  "Human Intelligence",
  "Geospatial Intelligence",
  "Measurement and Signature Intelligence",
  "Open-Source Intelligence",
]);
children(
  "B.1",
  [
    "Terrain",
    "Weather",
    "Civil Considerations",
    "Intelligence Preparation of the Operational Environment Products",
  ],
  true,
);
children("C", [
  "Army Design Methodology Products",
  "Operation Overlay",
  "Decision Support Products",
  "Gap Crossing Operations",
  "Air Assault Operations",
  "Airborne Operations",
  "Amphibious Operations",
  "Special Operations",
  "Battlefield Obscuration",
  "Airspace",
  "Rules of Engagement",
  "Cyberspace Electromagnetic Activities",
  "Military Information Support Operations",
  "Military Deception",
  "Soldier and Leader Engagement",
  "Personnel Recovery",
]);
children(
  "C.3",
  [
    "Execution Matrix",
    "Decision Support Template and Matrix",
    "Execution Checklist",
  ],
  true,
);
children("C.4", ["Traffic Control Overlay"], true);
children(
  "C.5",
  ["Pickup Zone Diagram", "Air Movement Table", "Landing Zone Diagram"],
  true,
);
children(
  "C.6",
  [
    "Marshalling Plan",
    "Air Movement Plan",
    "Drop Zone or Extraction Zone Diagram",
  ],
  true,
);
children(
  "C.7",
  [
    "Advance Force Operations",
    "Embarkation Plan",
    "Landing Plan",
    "Rehearsal Plan",
  ],
  true,
);
children("C.10", ["Air Traffic Services"], true);
children("C.11", ["No Strike List", "Restricted Target List"], true);
children(
  "C.12",
  [
    "Offensive Cyberspace Operations",
    "Defensive Cyberspace Operations",
    "Electromagnetic Attack",
    "Electromagnetic Protection",
    "Electromagnetic Support",
  ],
  true,
);
children("D", [
  "Fire Support Overlay",
  "Fire Support Execution Matrix",
  "Targeting",
  "Field Artillery Support",
  "Air Support",
  "Naval Surface Fire Support",
]);
children(
  "D.3",
  [
    "Target Selection Standards",
    "Target Synchronization Matrix",
    "Attack Guidance Matrix",
    "Target List Worksheet",
    "Battle Damage Assessment",
  ],
  true,
);
add("D.7", "Air and Missile Defense", {
  sourceClass: "FM5_SAMPLE_FORMAT",
  defaultApplicability: "DEFAULT_OMITTED",
  sourceNotes:
    "Sample-format variant; not a seventh canonical Table D-2 appendix.",
});
children("E", [
  "Area Security",
  "Risk Management",
  "Operations Security",
  "Populace and Resource Control",
  "Physical Security",
  "Antiterrorism",
  "Police Operations",
  "Survivability",
  "Force Health Protection",
  "Chemical, Biological, Radiological, and Nuclear Operations",
  "Explosive Ordnance Disposal",
  "Detention Operations",
  "Cyberspace Security and Defense",
]);
children("F", [
  "Logistics",
  "Personnel Services Support",
  "Health Service Support",
  "Financial Management",
]);
children(
  "F.1",
  [
    "Sustainment Overlay",
    "Maintenance",
    "Transportation",
    "Supply",
    "Field Services",
    "Distribution",
    "Contract Support Integration",
    "Mortuary Affairs",
  ],
  true,
);
children("F.1.C", [
  "Traffic Circulation and Control",
  "Traffic Circulation Overlay",
  "Road Movement Table",
  "Highway Regulation",
]);
children(
  "F.2",
  [
    "Human Resources Support",
    "Financial Management",
    "Legal Support",
    "Religious Support",
    "Band Operations",
  ],
  true,
);
set("F.2", {
  sourceNotes:
    "Table D-2 repeats Appendix 2 in the printed sequence. This catalog retains one stable Personnel Services Support node.",
});
children("G", [
  "Mobility and Countermobility",
  "Survivability",
  "General Engineering",
  "Geospatial Engineering",
  "Environmental Considerations",
]);
children("G.1", ["Obstacle Overlay"], true);
children(
  "G.5",
  [
    "Environmental Assessments",
    "Environmental Assessment Exemptions",
    "Environmental Baseline Survey",
  ],
  true,
);
children("H", [
  "Scheme of Signal Support Overlay",
  "Department of Defense Information Network Operations",
  "Network Transport and Information Services",
  "Spectrum Management Operations",
  "Communications Security",
]);
children("H.1", ["Retransmission Team Mission Checklist"], true);
children(
  "H.2",
  [
    "Cyberspace Security Incident Battle Drill",
    "Cyberspace Security Incident Report",
    "Network Node Allocation and Organization",
    "Network Outage Procedures and Report",
    "Scheme of Network Monitoring",
  ],
  true,
);
children(
  "H.3",
  [
    "Line of Sight Analysis",
    "High Frequency Radio Network Diagram",
    "Voice, Video, Data Logical Network Diagrams",
    "Voice over Internet Protocol Phonebook",
    "Upper Tier Satellite Transmission Diagram",
    "Coalition Forces Network Diagram and Foreign Disclosure Guidance",
    "Satellite Access Authorizations and Gateway Access Authorizations",
    "Retransmission Network Diagram",
    "Command and Control Information Systems Allocation and Interconnections",
    "Tactical Satellite Network Diagram",
    "Digital Fires Diagram",
  ],
  true,
);
children(
  "H.4",
  [
    "Signal Operating Instructions and Frequency Allocation (Commo Card; Tactical Radios)",
    "Signal Operating Instructions (Lightweight Directory Access Protocol Data Interchange Format)",
    "Joint Restricted Frequency List",
    "Joint Spectrum Interference Resolution Report Format and Procedures",
    "Guard List",
  ],
  true,
);
children(
  "H.5",
  [
    "Communications Security Callout Message",
    "Known Supersession Dates",
    "Communications Security Compromise Procedures",
  ],
  true,
);
children("I", [
  "Air and Missile Defense Execution Matrix",
  "Enemy Force Arrayal",
  "Friendly Force Arrayal",
  "Support Relationships",
  "Airspace Management Measures",
  "Sensor Plan",
  "Air and Missile Defense Communications Architecture",
]);
add("J.1", "Public Affairs Guidance");
add("J.1-sample", "Public Affairs Running Estimate", {
  code: "1",
  sourceClass: "FM5_SAMPLE_FORMAT",
  alternativeToStableKey: "J.1",
  defaultApplicability: "DEFAULT_OMITTED",
  sourceNotes:
    "Alternative Appendix 1 from the sample format. Select one Appendix 1 interpretation for the package.",
});
children("K", [
  "Execution Matrix",
  "Populace and Resources Control Plan",
  "Civil Information Management Plan",
]);
children("L", [
  "Information Collection Plan",
  "Information Collection Overlay",
]);
[
  "Nesting of Assessment Efforts",
  "Assessment Framework",
  "Assessment Working Group",
].forEach((t, i) =>
  add("M." + (i + 1), t, { sourceClass: "FM5_SAMPLE_FORMAT" }),
);
children("Q", [
  "Knowledge Management Decision Support Matrix",
  "Common Operational Picture Configuration Matrix",
  "Command and Control Network Integration Matrix",
  "Content Management",
  "Battle Rhythm",
]);
set("Q.3", {
  aliases: ["Command and Control Information Systems Integration Matrix"],
  sourceVariants: [
    {
      title: "Command and Control Information Systems Integration Matrix",
      sourceClass: "FM5_SAMPLE_FORMAT",
      sourceReferences: [ref("Sample format for Annex Q")],
      note: "Sample-format title alias. The Table D-2 title remains canonical.",
    },
  ],
});
[
  "Special Technical Operations Capabilities Integration Matrix",
  "Functional Area I Program and Objectives",
  "Functional Area II Program and Objectives",
].forEach((t, i) =>
  add("S." + (i + 1), t, { sourceClass: "FM5_SAMPLE_FORMAT" }),
);
set("V", { aliases: ["Interagency Coordination"], supportingStaff: ["civil"] });
set("L", { supportingStaff: ["intel"] });
set("R", { supportingStaff: ["km"] });
set("Z", { supportingStaff: ["km"] });
set("A", {
  formatType: "TASK_ORGANIZATION",
  editorHint: "TASK_ORGANIZATION_TREE",
  expectedContentTypes: ["unit references"],
});
set("H", {
  editorHint: "SIGNAL_WORKSPACE",
  expectedContentTypes: ["authoritative Signal workspace"],
});
set("H.4.A", {
  editorHint: "SIGNAL_WORKSPACE",
  expectedContentTypes: [
    "authoritative Signal workspace",
    "communications card",
  ],
});
set("R", {
  formatType: "REPORT_CATALOG",
  editorHint: "REPORT_CATALOG",
  expectedContentTypes: ["report entries"],
});
set("Z", {
  formatType: "DISTRIBUTION_LIST",
  editorHint: "DISTRIBUTION_LIST",
  expectedContentTypes: ["distribution recipients"],
});
for (const n of nodes) {
  if (n.nodeType !== "ANNEX" && n.editorHint === "GENERIC_STRUCTURED_PRODUCT") {
    if (/Matrix|Air Movement Table|Road Movement Table/.test(n.canonicalTitle))
      n.editorHint = "MATRIX";
    else if (/Checklist/.test(n.canonicalTitle)) n.editorHint = "CHECKLIST";
    else if (/Overlay|Diagram/.test(n.canonicalTitle))
      n.editorHint = "PLACEHOLDER_GRAPHIC";
  }
  if (
    n.nodeType !== "ANNEX" &&
    nodes.some((c) => c.parentStableKey === n.stableKey)
  )
    n.editorHint = "PRODUCT_COLLECTION";
  if (n.status === "SPARE") {
    n.defaultApplicability = "DEFAULT_OMITTED";
    n.normalApplicabilityNotes =
      "Reserved spare. Repurposing requires an explicit organization doctrine override.";
  }
}
const specialist = {
  B: ["FM 2-0"],
  D: ["FM 3-09"],
  E: ["ADP 3-37"],
  F: ["FM 4-0"],
  G: ["FM 3-34"],
  H: ["FM 6-02", "ATP 6-02.12"],
  N: ["FM 3-14"],
  Q: ["ATP 6-01.1"],
};
for (const n of nodes)
  n.specialistDoctrineSources = specialist[n.stableKey.split(".")[0]] || [];
set("B.1", { editorHint: "GENERIC_STRUCTURED_PRODUCT" });
set("I.1", {
  aliases: ["AMD Execution Matrix"],
  sourceNotes:
    "The supplied catalog expands Air and Missile Defense. Table D-2 prints the title as AMD Execution Matrix; the supplied expanded title is retained without changing structure.",
});
set("I.7", {
  aliases: ["AMD Communications Architecture"],
  sourceNotes:
    "The supplied catalog expands Air and Missile Defense. Table D-2 prints the title as AMD Communications Architecture; the supplied expanded title is retained without changing structure.",
});
// Informational navigation only; these references introduce no operational dependency.
set("B", { crossReferences: ["C", "L"] });
set("C", { crossReferences: ["B", "F", "H"] });
set("F", { crossReferences: ["C"] });
set("H", { crossReferences: ["C"] });
set("K", { crossReferences: ["V"] });
set("V", { crossReferences: ["K"] });
const baseFields = [];
function field(
  paragraphId,
  key,
  title,
  guidance = "",
  bindings = [],
  parentStableKey = null,
) {
  baseFields.push({
    id: uuid("base." + key),
    stableKey: key,
    paragraphId,
    title,
    guidance,
    parentStableKey,
    bindings,
    contentKind:
      key === "intent"
        ? "group"
        : key === "intent-key-tasks"
          ? "task-collection"
          : key === "intent-end-state"
            ? "structured-fields"
            : key === "subordinate-tasks"
              ? "canonical-tasks"
              : "narrative",
  });
}
field("situation", "area-interest", "Area of Interest");
field("situation", "assigned-area", "Assigned Area");
field("situation", "enemy", "Enemy Forces");
field(
  "situation",
  "friendly",
  "Friendly Forces",
  "Reference authoritative units as needed.",
  ["unit"],
);
field("situation", "interagency", "Interagency and Other Organizations");
field("situation", "civil", "Civil Considerations");
field(
  "situation",
  "attachments",
  "Attachments and Detachments",
  "Unit facts remain in Task Organization.",
  ["unit"],
);
field("situation", "assumptions", "Assumptions");
field(
  "mission",
  "mission-statement",
  "Mission Statement",
  "Who • What • When • Where • Why. Use linked tasks, events and units for authoritative facts.",
  ["unit", "task", "objective", "event"],
);
field("execution", "intent", "Commander’s Intent");
field(
  "execution",
  "intent-purpose",
  "Purpose",
  "State the purpose; task purposes remain on their canonical tasks.",
  ["task"],
  "intent",
);
field(
  "execution",
  "intent-key-tasks",
  "Key Tasks",
  "Link authoritative tasks.",
  ["task"],
  "intent",
);
field(
  "execution",
  "intent-end-state",
  "End State",
  "Link objectives where appropriate.",
  ["objective"],
  "intent",
);
field(
  "execution",
  "concept",
  "Concept of Operations",
  "Link phases, objectives and events.",
  ["phase", "objective", "event"],
);
field(
  "execution",
  "subordinate-tasks",
  "Tasks to Subordinate Units",
  "Canonical task assignments and purposes are shown from the Tasks workspace.",
  ["task", "unit"],
);
field(
  "execution",
  "coordinating",
  "Coordinating Instructions",
  "Reference H-hour and relative events by stable identifier.",
  ["event", "phase"],
);
field("sustainment", "sustainment-concept", "Sustainment Concept");
field("sustainment", "logistics", "Logistics");
field("sustainment", "personnel", "Personnel Services");
field("sustainment", "health", "Health Service Support");
field(
  "command-signal",
  "command",
  "Command",
  "Reference authoritative units.",
  ["unit"],
);
field(
  "command-signal",
  "signal",
  "Signal",
  "Signal facts are maintained once in the Signal workspace / Annex H.",
  ["signal"],
);
const profile = {
  ...legacy,
  schemaVersion: 2,
  id: "10000000-0000-4000-8000-000000000002",
  version: 1,
  name: "US Army Orders",
  staff: Object.entries(staff).map(([id, name]) => ({ id, name })),
  catalog: {
    profileKey: "us-army-orders",
    contentVersion: "1.0.0",
    baseline: ref("Table D-2 and identified sample-format variants"),
    nodes,
    baseFields,
  },
};
profile.annexCatalog = nodes
  .filter((n) => n.nodeType === "ANNEX")
  .map((n) => ({
    id: n.id,
    code: n.code,
    title: n.canonicalTitle,
    editor:
      n.code === "A"
        ? "task-organization"
        : n.code === "H"
          ? "signal"
          : n.code === "C"
            ? "operations"
            : "narrative",
    ownerId: n.responsibleStaff[0] || null,
  }));
fs.writeFileSync(
  "src/config/us-army-orders.json",
  JSON.stringify(profile, null, 2) + "\n",
);
console.log(
  `Seeded ${nodes.length} immutable catalog identities and ${baseFields.length} base authoring fields.`,
);
