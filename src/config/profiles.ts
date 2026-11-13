import source from "./doctrine.json";
import armySource from "./us-army-orders.json";
import {
  doctrineSchema,
  echelonSchema,
  organizationSchema,
  type ResolvedConfig,
} from "../domain/model";
export const doctrine = doctrineSchema.parse(source);
export const echelon = echelonSchema.parse({
  schemaVersion: 1,
  id: "20000000-0000-4000-8000-000000000001",
  version: 1,
  name: "Unspecified echelon",
  staffIds: ["ops", "intel", "signal"],
  suggestedAnnexCodes: ["A", "B", "C", "H"],
});
export const organization = organizationSchema.parse({
  schemaVersion: 1,
  id: "30000000-0000-4000-8000-000000000001",
  version: 1,
  name: "Local organization",
  doctrineRef: { id: doctrine.id, version: doctrine.version },
  echelonRef: { id: echelon.id, version: echelon.version },
  references: [],
  branding: { heading: "ORDO" },
});
export const starterConfig: ResolvedConfig = {
  doctrine,
  echelon,
  organization,
};
export const armyDoctrine = doctrineSchema.parse(armySource);
export const armyConfig: ResolvedConfig = {
  doctrine: armyDoctrine,
  echelon: echelonSchema.parse({
    ...echelon,
    id: "20000000-0000-4000-8000-000000000002",
    name: "Organization-independent orders",
    staffIds: armyDoctrine.staff.map((s) => s.id),
    suggestedAnnexCodes: [],
  }),
  organization: organizationSchema.parse({
    ...organization,
    id: "30000000-0000-4000-8000-000000000002",
    name: "US Army orders baseline",
    doctrineRef: { id: armyDoctrine.id, version: armyDoctrine.version },
    echelonRef: { id: "20000000-0000-4000-8000-000000000002", version: 1 },
  }),
};
