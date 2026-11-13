import {
  compareSearchHits,
  matchesSearchFilters,
  normalizeSearch,
  searchExcerpt,
  searchTerms,
  type SearchDocument,
  type SearchHit,
  type SearchRequest,
} from "../../domain/search";
import { targetKey, type SearchTarget } from "../../domain/planning-target";
import type { Operation, ResolvedConfig } from "../../domain/model";

/** Applied editor state only. No recovery records or nested, unapplied fields. */
export class SearchSession {
  private contexts = new Map<
    string,
    {
      operation: Operation;
      config: ResolvedConfig;
      saved?: Operation;
      cardOrigins?: Record<string, string>;
    }
  >();
  setContext(
    operation: Operation,
    config: ResolvedConfig,
    saved?: Operation,
    cardOrigins?: Record<string, string>,
  ) {
    this.contexts.set(operation.id, { operation, config, saved, cardOrigins });
  }
  context(id: string) {
    return this.contexts.get(id);
  }
  operationContexts() {
    return [...this.contexts.values()];
  }
  originState(
    id: string,
  ): import("../../domain/planning-cards").CardOrigin["state"] {
    const context = this.contexts.get(id);
    if (!context) throw Error("The operation is no longer open.");
    return JSON.stringify(context.operation) === JSON.stringify(context.saved)
      ? { kind: "saved", revision: context.operation.revision }
      : {
          kind: "working",
          baseRevision: context.operation.revision,
          draftGeneration:
            this.providers.get("operation:" + id)?.generation ?? this.revision,
        };
  }
  private providers = new Map<
    string,
    {
      documents: SearchDocument[];
      generation: number;
      entries: {
        document: SearchDocument;
        title: string;
        code: string;
        words: string[];
        headingWords: string[];
      }[];
    }
  >();
  private listeners = new Set<() => void>();
  private revision = 0;
  scope: "operation" | "workspace" | null = null;
  target: { value: SearchTarget; nonce: number } | null = null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getRevision = () => this.revision;
  private emit() {
    this.revision++;
    this.listeners.forEach((fn) => fn());
  }
  register(owner: string, documents: SearchDocument[]) {
    if (this.providers.get(owner)?.documents === documents) return;
    this.providers.set(owner, {
      documents,
      generation: this.revision + 1,
      entries: documents.map((document) => {
        const title = normalizeSearch(document.title),
          code = normalizeSearch(document.code),
          headingWords = (title + " " + code).split(" ");
        return {
          document,
          title,
          code,
          headingWords,
          words: [
            ...headingWords,
            ...normalizeSearch(document.text).split(" "),
          ],
        };
      }),
    });
    this.emit();
  }
  remove(owner: string) {
    this.contexts.delete(owner.replace(/^operation:/, ""));
    if (this.providers.delete(owner)) this.emit();
  }
  clear() {
    this.providers.clear();
    this.contexts.clear();
    this.target = null;
    this.scope = null;
    this.emit();
  }
  owners() {
    return [...this.providers.keys()];
  }
  documents() {
    return [...this.providers.values()].flatMap((p) => p.documents);
  }
  resolve(hit: SearchHit): SearchHit | null | undefined {
    const provider = this.providers.get(hit.owner);
    if (!provider) return undefined;
    if (
      hit.draftGeneration !== undefined &&
      hit.draftGeneration !== provider.generation
    )
      throw Error("The working source changed. Search again.");
    const document = provider.documents.find(
      (d) => targetKey(d.target) === targetKey(hit.target),
    );
    return document
      ? {
          ...document,
          score: 0,
          excerpt: document.text.slice(0, 240),
          state: "Working",
          draftGeneration: provider.generation,
        }
      : null;
  }
  query(request: SearchRequest): SearchHit[] {
    const terms = searchTerms(request.query),
      normalized = normalizeSearch(request.query);
    if (!terms.length) return [];
    const hits: SearchHit[] = [];
    for (const provider of this.providers.values())
      for (const entry of provider.entries) {
        if (
          !matchesSearchFilters(entry.document, request) ||
          !terms.every((term) =>
            entry.words.some((word) => word.startsWith(term)),
          )
        )
          continue;
        const score =
          entry.title === normalized || entry.code === normalized
            ? 0
            : terms.every((term) =>
                  entry.headingWords.some((word) => word.startsWith(term)),
                )
              ? 1
              : 2;
        hits.push({
          ...entry.document,
          score,
          excerpt: searchExcerpt(entry.document.text, request.query),
          state: "Working",
          draftGeneration: provider.generation,
        });
      }
    return hits.sort(compareSearchHits);
  }
  open(value: SearchTarget) {
    this.target = { value, nonce: (this.target?.nonce ?? 0) + 1 };
    this.emit();
  }
}
