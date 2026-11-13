import { operationSchema } from "../domain/model";
import reference from "./testify.json";

// The snapshot uses the bundled US Army Orders configuration. Only operation-owned
// identities need new keys. Doctrine node and field IDs must keep their meanings.
export function createTestifyExample(id: () => string, now: string) {
  const ownedIds = [
    reference.id,
    reference.orderId,
    reference.signal.id,
    ...[
      reference.units,
      reference.phases,
      reference.objectives,
      reference.tasks,
      reference.events,
      reference.attachments,
      reference.signal.nets,
      reference.signal.pacePlans,
    ].flatMap((list) => list.map((record) => record.id)),
  ];
  const replacements = new Map(ownedIds.map((source) => [source, id()]));
  const copy = operationSchema.parse(
    JSON.parse(JSON.stringify(reference), (_, value: unknown) =>
      typeof value === "string" ? (replacements.get(value) ?? value) : value,
    ),
  );
  return { ...copy, revision: 1, createdAt: now, updatedAt: now };
}
