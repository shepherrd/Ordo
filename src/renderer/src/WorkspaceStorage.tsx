import { useEffect, useState } from "react";
import { useWorkspaceApi } from "./WorkspaceContext";
import type { DesktopApi } from "../../application/bridge";
import { Panel } from "./Fields";
export function WorkspaceStorage() {
  const api = useWorkspaceApi(),
    [info, setInfo] = useState<Awaited<
      ReturnType<DesktopApi["workspaceInfo"]>
    > | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api
      .workspaceInfo()
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [api]);
  return (
    <Panel title="Application & workspace location">
      <p>
        Ordo stores work locally. Keep a backup outside this workspace folder
        before installing an update. Close Ordo, run the new installer, then
        reopen your existing workspace. Installation files and planning data are
        stored separately.
      </p>
      {error && <p role="alert">{error}</p>}
      {info && (
        <dl className="storage-locations">
          <dt>Application version</dt>
          <dd>{info.appVersion}</dd>
          <dt>Application</dt>
          <dd>{info.applicationPath}</dd>
          <dt>Workspace database</dt>
          <dd>{info.databasePath}</dd>
          <dt>Workspace folder</dt>
          <dd>{info.dataPath}</dd>
        </dl>
      )}
      <p>
        Backups include saved planning data, retained exports, and local
        recovery copies. A recovery copy is not a saved revision. Restore
        replaces the workspace with the selected backup and retains the previous
        database as a recovery file here. Older Ordo versions may not open a
        workspace upgraded by a newer version; use your pre-update backup when
        returning to an older version.
      </p>
    </Panel>
  );
}
