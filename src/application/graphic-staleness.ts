import { archivedGraphicOperation } from "./recorded-graphic-layout";
import type { Repository } from "./ports";
import type { GraphicExportRecord } from "../domain/graphic-exports";
import {
  projectGraphicV2,
  graphicDependencyChanges,
} from "../export/graphic-projection-v2";
import {
  diagramFromOperation,
  diagramFromSaved,
  selectDiagram,
} from "../domain/diagram";
import { newOrbatLayout } from "../domain/orbat";
import { canonical } from "../export/projections/v1";
import { createNativeExchange } from "./native-exchange";
import { projectArchivedGraphic } from "./archived-graphic-v1";
export interface GraphicStaleness {
  outdated: boolean | null;
  changedPaths: string[];
  comparedWith: "CURRENT_OPERATION" | "EXACT_LIBRARY_VERSION";
  reason: string | null;
}
export function graphicStaleness(
  record: GraphicExportRecord,
  repo: Repository,
): GraphicStaleness {
  const comparedWith =
    record.source.kind === "OPERATION"
      ? "CURRENT_OPERATION"
      : "EXACT_LIBRARY_VERSION";
  try {
    let source = record.source;
    const operation =
      source.kind === "OPERATION"
        ? archivedGraphicOperation(
            record,
            repo.getOperation(source.operationId),
          )
        : undefined;
    if (source.kind === "SAVED_SYMBOL") {
      const value = repo.getSymbol(source.ref.versionId);
      source = {
        ...source,
        snapshot:
          value.status === "RETIRED"
            ? { ...value, status: "PUBLISHED", retiredAt: null }
            : value,
      };
    } else if (source.kind === "SAVED_ORBAT") {
      const value = repo.getOrbat(source.ref.versionId);
      source = {
        ...source,
        snapshot:
          value.status === "RETIRED"
            ? { ...value, status: "PUBLISHED", retiredAt: null }
            : value,
      };
    }
    let changedPaths: string[];
    if (record.schemaVersion === 3) {
      changedPaths = graphicDependencyChanges(
        record.dependencies,
        projectArchivedGraphic(source, record.profile, operation).dependencies,
      );
    } else if (record.profile.jsonMode === "NATIVE_EXCHANGE") {
      if (source.kind === "OPERATION")
        throw Error("Native exchange cannot reference an operation");
      const envelope = createNativeExchange(
        source.kind === "SAVED_SYMBOL"
          ? { kind: "SYMBOL", value: source.snapshot }
          : { kind: "ORBAT", value: source.snapshot },
        repo,
        (s) => repo.hash(s),
      );
      changedPaths =
        record.dependencies[0]?.canonicalValue === canonical(envelope)
          ? []
          : ["exchange/envelope"];
    } else if (record.schemaVersion === 2) {
      changedPaths = graphicDependencyChanges(
        record.dependencies,
        projectGraphicV2(source, record.profile, operation).dependencies,
      );
    } else {
      // Exact schema-1 request semantics remain separate from new normalization.
      const p = record.profile;
      const request =
        source.kind === "SAVED_SYMBOL"
          ? {
              kind: "SYMBOL",
              input: {
                definition: source.snapshot.definition,
                size: p.size,
                context: "SYMBOL",
                labelSide: "RIGHT",
              },
            }
          : {
              kind: "ORBAT",
              input: {
                ...selectDiagram(
                  source.kind === "OPERATION"
                    ? diagramFromOperation(
                        operation!,
                        newOrbatLayout(() => operation!.id),
                      )
                    : diagramFromSaved(source.snapshot),
                  p,
                ),
                symbolSize: p.size,
              },
            };
      changedPaths =
        record.dependencies.find((d) => d.path === "graphic/request")
          ?.canonicalValue === canonical(request)
          ? []
          : ["graphic/request"];
    }
    return {
      outdated: changedPaths.length > 0,
      changedPaths,
      comparedWith,
      reason: null,
    };
  } catch (e) {
    return {
      outdated: null,
      changedPaths: [],
      comparedWith,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
