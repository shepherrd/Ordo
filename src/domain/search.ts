import { z } from "zod";
import { searchTargetSchema, type SearchTarget } from "./planning-target";

export const searchTypes = [
  "operation",
  "unit",
  "task",
  "objective",
  "phase",
  "event",
  "narrative",
  "product",
  "module",
  "signal",
  "net",
  "pace",
  "organization",
  "doctrine",
  "symbol",
  "orbat",
  "file",
  "card",
  "whiteboard",
] as const;
export type SearchType = (typeof searchTypes)[number];
export interface SearchDocument {
  id: string;
  owner: string;
  ownerName: string;
  operationId: string | null;
  type: SearchType;
  title: string;
  code: string;
  text: string;
  target: SearchTarget;
  phaseIds: string[];
  staffIds: string[];
  sourceToken: string;
}
export const searchRequestSchema = z
  .object({
    query: z.string().max(256),
    operationId: z.string().uuid().nullable().default(null),
    type: z.enum(searchTypes).nullable().default(null),
    phaseId: z.string().uuid().nullable().default(null),
    staffId: z.string().max(160).nullable().default(null),
    offset: z.number().int().min(0).max(50000).default(0),
    limit: z.number().int().min(1).max(50).default(50),
    excludedOwners: z.array(z.string().max(200)).max(1000).default([]),
    sequence: z.number().int().nonnegative(),
  })
  .strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export interface SearchHit extends SearchDocument {
  score: number;
  excerpt: string;
  state: "Saved" | "Working";
  draftGeneration?: number;
}
export interface SearchResponse {
  sequence: number;
  workspaceGeneration: string;
  hits: SearchHit[];
  more: boolean;
  complete: boolean;
  indexError?: string;
}
export const searchResolveSchema = z
  .object({
    target: searchTargetSchema,
    workspaceGeneration: z.string().min(1).max(100),
    sourceToken: z.string().max(200),
  })
  .strict();
export type SearchResolve = z.infer<typeof searchResolveSchema>;
export const searchUsageRequestSchema = z
  .object({
    target: searchTargetSchema,
    excludedOwners: z.array(z.string().max(200)).max(1000),
    offset: z.number().int().min(0).max(50000).default(0),
  })
  .strict();
export type SearchUsageRequest = z.infer<typeof searchUsageRequestSchema>;
export type SearchUsageResponse = {
  references: import("./planning-usage").PlanningReference[];
  more: boolean;
};
export function normalizeSearch(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(" ") ?? ""
  );
}
export function searchTerms(query: string): string[] {
  const terms = [...new Set(normalizeSearch(query).split(" ").filter(Boolean))];
  if (terms.length > 16) throw Error("Use at most 16 search terms.");
  return terms;
}
export function searchScore(
  document: SearchDocument,
  query: string,
  terms = searchTerms(query),
): number | null {
  if (!terms.length) return null;
  const title = normalizeSearch(document.title),
    code = normalizeSearch(document.code),
    text = normalizeSearch(document.text);
  const all = (title + " " + code + " " + text).split(" ");
  if (!terms.every((t) => all.some((word) => word.startsWith(t)))) return null;
  const normalized = normalizeSearch(query);
  if (title === normalized || code === normalized) return 0;
  return terms.every((t) =>
    (title + " " + code).split(" ").some((word) => word.startsWith(t)),
  )
    ? 1
    : 2;
}
const titleLengths = new WeakMap<SearchHit, number>();
const titleLength = (hit: SearchHit) => {
  let length = titleLengths.get(hit);
  if (length === undefined) {
    length = [...hit.title].length;
    titleLengths.set(hit, length);
  }
  return length;
};
export function compareSearchHits(a: SearchHit, b: SearchHit): number {
  return (
    a.score - b.score ||
    titleLength(a) - titleLength(b) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
export function searchExcerpt(text: string, query: string): string {
  const terms = searchTerms(query);
  const lower = text.toLowerCase();
  const at = Math.max(
    0,
    Math.min(
      ...terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0),
      text.length,
    ),
  );
  const start = Math.max(0, at - 65);
  return (
    (start ? "…" : "") +
    text.slice(start, start + 240) +
    (start + 240 < text.length ? "…" : "")
  );
}
export function matchesSearchFilters(
  d: SearchDocument,
  r: SearchRequest,
): boolean {
  return (
    (!r.operationId || d.operationId === r.operationId) &&
    (!r.type || d.type === r.type) &&
    (!r.phaseId || d.phaseIds.includes(r.phaseId)) &&
    (!r.staffId || d.staffIds.includes(r.staffId))
  );
}
