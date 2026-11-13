import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useWorkspaceSession } from "./WorkspaceContext";
import {
  catalogSearchDocuments,
  operationSearchDocuments,
} from "../../domain/search-documents";
import type {
  CatalogItem,
  CatalogKind,
  LegacyCatalogDocument,
} from "../../domain/catalog";
import type { Operation, ResolvedConfig } from "../../domain/model";
import type { SearchDocument } from "../../domain/search";
import type { SearchTarget } from "../../domain/planning-target";
import type { SavedOrbatVersion } from "../../domain/orbat";

/** Navigation may finish before the workspace write boundary releases its controls. */
export function focusSearchTarget(
  find: () => HTMLElement | null | undefined,
  onFocused?: () => void,
) {
  let frame = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    clearTimeout(deadline);
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
  };
  const schedule = () => {
    if (stopped) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const element = find();
      if (
        !element?.isConnected ||
        !element.getClientRects().length ||
        element.matches(":disabled") ||
        element.closest("[hidden],[inert]") ||
        [...document.querySelectorAll<HTMLElement>('[aria-modal="true"]')].some(
          (dialog) =>
            dialog.getClientRects().length && !dialog.contains(element),
        )
      )
        return;
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
      if (document.activeElement === element) {
        stop();
        onFocused?.();
      }
    });
  };
  const observer = new MutationObserver(schedule);
  const deadline = setTimeout(stop, 5000);
  // A deliberate new interaction takes precedence over a delayed search jump.
  document.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", stop, true);
  observer.observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  schedule();
  return stop;
}

export function focusSearchField(label: string) {
  return focusSearchTarget(() => {
    const elements = [
      ...document.querySelectorAll<HTMLElement>(
        "input,textarea,select,[contenteditable=true]",
      ),
    ];
    const element = elements.find(
      (e) =>
        !e.closest("[hidden],[inert]") &&
        (e.getAttribute("aria-label") === label ||
          e.closest("label")?.querySelector("span")?.textContent === label),
    );
    for (let p = element?.parentElement; p; p = p.parentElement)
      if (p instanceof HTMLDetailsElement) p.open = true;
    return element;
  });
}

function useProvider(owner: string | undefined, documents: SearchDocument[]) {
  const { search } = useWorkspaceSession();
  useEffect(() => {
    if (owner) search.register(owner, documents);
  }, [search, owner, documents]);
  useEffect(
    () => () => {
      if (owner) search.remove(owner);
    },
    [search, owner],
  );
}
export function useOperationSearch(
  operation: Operation | null,
  config?: ResolvedConfig,
  saved?: Operation,
  cardOrigins?: Record<string, string>,
) {
  const { search } = useWorkspaceSession();
  useEffect(() => {
    if (operation && config)
      search.setContext(operation, config, saved, cardOrigins);
  }, [search, operation, config, saved, cardOrigins]);
  const documents = useMemo(
    () =>
      operation && config ? operationSearchDocuments(operation, config) : [],
    [operation, config],
  );
  useProvider(operation ? "operation:" + operation.id : undefined, documents);
}
export function useCatalogSearch(
  kind: CatalogKind,
  draft: LegacyCatalogDocument | null,
  assignedOrbat?: SavedOrbatVersion | null,
) {
  // Drafts may temporarily fail save validation (for example an empty name).
  // Still replace the entire saved owner, without coercing or saving the draft.
  const item = useMemo((): CatalogItem | null => {
    if (!draft) return null;
    if ("doctrineVersionId" in draft)
      return {
        kind: "DOCTRINE",
        id: draft.doctrineVersionId,
        name: draft.displayName,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        content: {
          stableKey: draft.stableKey,
          description: draft.description,
          author: draft.author,
          config: draft.config,
        },
      };
    if ("unitProfileVersionId" in draft)
      return {
        kind: "ORGANIZATION",
        id: draft.unitProfileVersionId,
        name: draft.identity.fullDesignation,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        content: draft,
      } as unknown as CatalogItem;
    return {
      kind,
      id: draft.versionId,
      name: draft.name,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      content: draft,
    } as CatalogItem;
  }, [draft, kind]);
  const documents = useMemo(
    () =>
      item
        ? catalogSearchDocuments(
            item,
            "working",
            assignedOrbat
              ? { id: assignedOrbat.versionId, nodes: assignedOrbat.nodes }
              : null,
          )
        : [],
    [item, assignedOrbat],
  );
  useProvider(item ? "catalog:" + item.id : undefined, documents);
}
export function useSearchOpen(
  area: SearchTarget["area"],
  open: (target: SearchTarget) => void,
  ready: boolean | string = true,
) {
  const { search } = useWorkspaceSession();
  useSyncExternalStore(search.subscribe, search.getRevision);
  const target = search.target;
  const opened = useRef<typeof target>(null);
  useEffect(() => {
    if (ready && target?.value.area === area && opened.current !== target) {
      opened.current = target;
      open(target.value);
    }
  }, [target?.nonce, ready]);
}
