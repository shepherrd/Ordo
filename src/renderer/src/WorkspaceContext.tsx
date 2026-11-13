import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { WorkspaceSession, type EditorProtection } from "./workspace-session";
import { operationTabsKey } from "./operation-tabs";

const Context = createContext<WorkspaceSession | null>(null);
const VersionContext = createContext<string | null>(null);
export function ApplicationVersion() {
  const version = useContext(VersionContext);
  return (
    <small aria-label="Application version">
      {version ? `v${version}` : "Version unavailable"}
    </small>
  );
}
export function BusyBoundary({
  busy,
  children,
  ...container
}: HTMLAttributes<HTMLDivElement> & { busy: boolean }) {
  const fields = (
    <fieldset disabled={busy} inert={busy} style={{ display: "contents" }}>
      {children}
    </fieldset>
  );
  return container.className ? <div {...container}>{fields}</div> : fields;
}
const Scope = createContext<string | undefined>(undefined);
export function EditorScope({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return <Scope.Provider value={id}>{children}</Scope.Provider>;
}
export function useWorkspaceSession() {
  const session = useContext(Context);
  if (!session) throw Error("Workspace session is unavailable");
  return session;
}
export function useWorkspaceApi() {
  const session = useWorkspaceSession(),
    scope = useContext(Scope);
  return useMemo(() => session.apiForScope(scope), [session, scope]);
}
export function useEditorProtection(status: EditorProtection) {
  const session = useWorkspaceSession(),
    id = useRef(Symbol("editor"));
  const scope = useContext(Scope);
  useLayoutEffect(() => {
    session.update(id.current, { ...status, scope });
  }, [
    session,
    scope,
    status.name,
    status.dirty,
    status.busy,
    status.primary,
    status.unappliedSymbolField,
  ]);
  useLayoutEffect(() => () => session.remove(id.current), [session]);
}

export const unappliedSymbolMessage =
  "Apply or discard the highlighted symbol field edits before saving, replacing, exporting, or leaving this editor.";

// Uses the existing workspace/operation scope so hidden tabs keep their own
// protection. These transient fields are never operation-domain state.
export function useUnappliedSymbolEdits(explicitScope?: string) {
  const session = useWorkspaceSession();
  const inheritedScope = useContext(Scope);
  useSyncExternalStore(session.subscribe, session.getRevision);
  return session
    .protectionFor(explicitScope ?? inheritedScope)
    .editors.some((editor) => editor.unappliedSymbolField && editor.dirty);
}

export function UnappliedSymbolNotice({ visible }: { visible: boolean }) {
  return visible ? (
    <p className="notice" role="status">
      {unappliedSymbolMessage}
    </p>
  ) : null;
}

function SessionView({
  session,
  children,
}: {
  session: WorkspaceSession;
  children: ReactNode;
}) {
  useSyncExternalStore(session.subscribe, session.getRevision);
  const state = session.snapshot();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void session.api
      .workspaceInfo()
      .then((info) => {
        if (!cancelled) setVersion(info.appVersion);
      })
      .catch(() => {
        if (!cancelled) setVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (session.protectsClose()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [session]);
  return (
    <Context.Provider value={session}>
      <div
        style={{ display: "contents" }}
        data-workspace-dirty={!!state.dirty.length}
        data-workspace-busy={
          !!(state.busy.length || state.pending || state.restoring)
        }
        inert={state.writing || state.restoring}
      >
        <BusyBoundary busy={state.writing || state.restoring}>
          <VersionContext.Provider value={version}>
            {children}
          </VersionContext.Provider>
        </BusyBoundary>
      </div>
      {state.restoring && (
        <p className="notice" role="status">
          Restoring workspace…
        </p>
      )}
    </Context.Provider>
  );
}

export function WorkspaceHost({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState(() => createSession());
  function createSession(restored = false): WorkspaceSession {
    return new WorkspaceSession(
      window.ordo,
      () => {
        // Reopen only catalogs after restore. No editor/selection/undo state from
        // the previous database may survive, even if it was hidden at the time.
        try {
          localStorage.removeItem(operationTabsKey);
        } catch {
          /* optional local storage */
        }
        setSession(createSession(true));
        setGeneration((value) => value + 1);
      },
      restored,
    );
  }
  return (
    <SessionView key={generation} session={session}>
      {children}
    </SessionView>
  );
}
