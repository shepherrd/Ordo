import { useCallback, useEffect, useState } from "react";
import type { SavedOrbatVersion } from "../../domain/orbat";
import { useWorkspaceApi } from "./WorkspaceContext";
import { editorError } from "./editor-error";

/** One live source for both the organization inspector and working-copy search. */
export function useAssignedOrbat(orbatId: string | null, active: boolean) {
  const desktop = useWorkspaceApi();
  const [source, setSource] = useState<SavedOrbatVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((g) => g + 1), []);
  useEffect(() => {
    if (!active) return;
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active, refresh]);
  useEffect(() => {
    let alive = true;
    setError("");
    if (!orbatId) {
      setSource(null);
      setLoading(false);
      return;
    }
    if (!active) return;
    setLoading(true);
    desktop
      .symbols({ type: "get", kind: "ORBAT", id: orbatId })
      .then((r) => {
        if (alive) setSource(r.orbat!);
      })
      .catch((e) => {
        if (alive) {
          setSource(null);
          setError(editorError(e));
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [active, orbatId, generation, desktop]);
  return {
    orbat: source?.versionId === orbatId ? source : null,
    loading,
    error,
    refresh,
    generation,
  };
}
