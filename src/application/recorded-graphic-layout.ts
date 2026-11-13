import type { GraphicExportRecord } from "../domain/graphic-exports";
import type { Operation, ExportRecord } from "../domain/model";
import { recordedLayoutDefaults } from "../domain/orbat";

export function archivedGraphicOperation(
  record: GraphicExportRecord,
  op: Operation,
) {
  if (
    op.orbatLayout ||
    !record.layoutVersion ||
    record.layoutVersion === "ordo-layout-v1"
  )
    return op;
  const serialized = record.dependencies.find(
    (d) => d.path === "graphic/request",
  )?.canonicalValue;
  if (!serialized) return op;
  const request = JSON.parse(serialized);
  return recordedLayoutDefaults(
    op,
    record.layoutVersion,
    request?.input?.layout?.labelProfile,
  );
}
export function archivedOrderOperation(record: ExportRecord, op: Operation) {
  const request = "graphics" in record && record.graphics?.[0]?.request;
  return request
    ? recordedLayoutDefaults(
        op,
        request.input.layout.algorithm,
        request.input.layout.labelProfile,
      )
    : op;
}
