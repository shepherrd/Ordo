import type {
  GraphicExportProfile,
  GraphicExportRecord,
} from "../domain/graphic-exports";
import type { Dependency, Operation } from "../domain/model";
import type { GraphicRenderRequest } from "../domain/graphic-input";
import {
  diagramFromSaved,
  selectDiagram,
  selectOperationDiagram,
} from "../domain/diagram";
import { newOrbatLayout } from "../domain/orbat";
import { consumedOrbatInputV5 } from "./orbat-input-v5";
import { canonical } from "./projections/v1";

/** New artifacts explicitly pin this projection; schema-1 artifacts keep their original request. */
export function projectGraphicV2(
  source: GraphicExportRecord["source"],
  profile: GraphicExportProfile,
  operation?: Operation,
): { request: GraphicRenderRequest; dependencies: Dependency[] } {
  if (profile.jsonMode === "NATIVE_EXCHANGE")
    throw Error("Native exchange uses its full dependency closure");
  let request: GraphicRenderRequest;
  let dependencies: Dependency[];
  if (source.kind === "SAVED_SYMBOL") {
    const definition = structuredClone(source.snapshot.definition);
    definition.origin = { kind: "MANUAL" };
    definition.code.assertedStandard = "UNVERIFIED";
    definition.code.sourceConvention = "NATIVE";
    request = {
      kind: "SYMBOL",
      input: {
        definition,
        size: profile.size,
        context: "SYMBOL",
        labelSide: "RIGHT",
      },
    };
    dependencies = Object.entries(definition)
      .filter(
        ([key]) => !["definitionId", "origin", "schemaVersion"].includes(key),
      )
      .map(([key, value]) => ({
        path: `symbol/${key}`,
        canonicalValue: canonical(value),
      }));
  } else {
    if (
      source.kind === "OPERATION" &&
      (!operation || operation.id !== source.operationId)
    )
      throw Error("Graphic operation input is missing or mismatched");
    const input =
      source.kind === "OPERATION"
        ? selectOperationDiagram(
            operation!,
            newOrbatLayout(() => operation!.id),
            profile,
          )
        : selectDiagram(diagramFromSaved(source.snapshot), profile);
    input.symbolSize = profile.size;
    input.layout.layoutId = profile.id;
    dependencies = consumedOrbatInputV5(
      input,
      "orbat",
      source.kind === "OPERATION" ? operation : undefined,
    );
    request = { kind: "ORBAT", input };
  }
  return {
    request,
    dependencies: [
      { path: "graphic/request", canonicalValue: canonical(request) },
      ...dependencies,
    ],
  };
}

export function graphicDependencyChanges(
  before: Dependency[],
  after: Dependency[],
): string[] {
  const map = (deps: Dependency[]) =>
    new Map(
      deps
        .filter((d) => d.path !== "graphic/request")
        .map((d) => [d.path, d.canonicalValue]),
    );
  const a = map(before),
    b = map(after);
  return [...new Set([...a.keys(), ...b.keys()])]
    .filter((p) => a.get(p) !== b.get(p))
    .sort();
}
