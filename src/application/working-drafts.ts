import { z } from "zod";
import {
  idSchema,
  operationSchema,
  exportProfileSchema,
  preferencesSchema,
} from "../domain/model";
import { savedSymbolVersionSchema } from "../domain/symbology";
import { editableOrbatSchema } from "../domain/catalog-orbat";
import { doctrineVersionSchema } from "../domain/doctrine-builder";
import { recoverableOrganizationSchema } from "../domain/organization-orbat";
import {
  dispositions,
  reviewHeaderSchema,
  reviewEventSchema,
} from "../domain/reviews";
import { canonical } from "../export/projection";
import type { Repository, Runtime } from "./ports";
import type { Preferences } from "../domain/model";

export function editablePreferences(
  value: Preferences | null,
): Preferences | null {
  if (!value) return null;
  const { schemaVersion, timeDisplay, pageSize, localActor } = value;
  return {
    schemaVersion,
    timeDisplay,
    pageSize,
    ...(localActor === undefined ? {} : { localActor }),
  };
}

export const draftKinds = [
  "operation",
  "export-profile",
  "symbol",
  "orbat",
  "doctrine",
  "unit-profile",
  "review",
  "review-new",
  "preferences",
] as const;
export const draftKeySchema = z
  .object({
    kind: z.enum(draftKinds),
    id: idSchema,
    scope: idSchema.nullable(),
  })
  .strict();
export type DraftKey = z.infer<typeof draftKeySchema>;
const jsonText = z.string().max(8 * 1024 * 1024);
export const workingDraftSchema = draftKeySchema
  .extend({
    schemaVersion: z.literal(1),
    label: z.string().max(200),
    source: jsonText,
    value: jsonText,
    sequence: z.number().int().positive(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type WorkingDraft = z.infer<typeof workingDraftSchema>;
export type DraftSummary = Omit<WorkingDraft, "source" | "value"> & {
  compatible: boolean;
};
export const recoveryCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("list") }).strict(),
  z.object({ type: z.literal("get"), key: draftKeySchema }).strict(),
  z
    .object({
      type: z.literal("put"),
      token: idSchema,
      key: draftKeySchema,
      source: jsonText,
      value: jsonText,
      label: z.string().max(200),
      expected: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("remove"),
      token: idSchema,
      key: draftKeySchema,
      expected: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal("recover"),
      token: idSchema,
      key: draftKeySchema,
      expected: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("discard-session"), scope: idSchema }).strict(),
]);
export type RecoveryCommand = z.infer<typeof recoveryCommandSchema>;
export type RecoveryResult = {
  token: string;
  drafts?: DraftSummary[];
  draft?: WorkingDraft | null;
  compatible?: boolean;
};
export interface WorkingDraftRepository {
  listWorkingDrafts(): WorkingDraft[];
  getWorkingDraft(key: DraftKey): WorkingDraft | null;
  putWorkingDraft(draft: WorkingDraft, expected: number): WorkingDraft;
  removeWorkingDraft(key: DraftKey, expected: number): void;
}
export const preferencesDraftId = "00000000-0000-4000-8000-000000000001";
export const reviewWorkingSchema = z
  .object({
    baseline: z.string().regex(/^(?:[rp]:[0-9a-f-]{36})?$/i),
    target: z.string().regex(/^(?:[rp]:[0-9a-f-]{36})?$/i),
    title: z.string().max(160),
    description: z.string().max(40000),
    comment: z.string().max(40000),
    note: z.string().max(40000),
    parent: idSchema.nullable(),
    supersedes: idSchema.nullable(),
    changeDrafts: z.record(
      idSchema,
      z
        .object({
          decision: z.enum(dispositions).optional(),
          note: z.string().max(40000).optional(),
          comment: z.string().max(40000).optional(),
        })
        .strict(),
    ),
  })
  .strict();

// Working copies may contain incomplete text, but never arbitrary executable or
// structurally invalid domain objects. Normal save still runs every invariant.
function incompleteTextOnly(issues: readonly z.core.$ZodIssue[]): boolean {
  return issues.every(
    (i) =>
      ["too_small", "too_big", "invalid_format", "custom"].includes(i.code) ||
      (i.code === "invalid_union" && i.errors.some(incompleteTextOnly)),
  );
}
export function parseWorkingJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  let nodes = 0;
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 500000 || depth > 80)
      throw Error("Working copy exceeds recovery limits");
    if (v && typeof v === "object")
      for (const [key, child] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw Error("Invalid working-copy field");
        visit(child, depth + 1);
      }
  };
  visit(value, 0);
  return value;
}
export function validateWorkingDraft(draft: WorkingDraft): void {
  workingDraftSchema.parse(draft);
  const source = parseWorkingJson(draft.source) as Record<string, unknown>;
  const value = parseWorkingJson(draft.value) as Record<string, unknown>;
  const schemas = {
    operation: operationSchema,
    "export-profile": exportProfileSchema,
    symbol: savedSymbolVersionSchema,
    orbat: editableOrbatSchema,
    doctrine: doctrineVersionSchema,
    "unit-profile": recoverableOrganizationSchema,
    preferences: preferencesSchema,
    review: reviewWorkingSchema,
    "review-new": reviewWorkingSchema,
  };
  const parsed = schemas[draft.kind].safeParse(value);
  if (!parsed.success && !incompleteTextOnly(parsed.error.issues))
    throw Error("Working copy has invalid structure");
  if (draft.kind === "review-new")
    z.object({ id: idSchema, revision: z.number().int().positive() })
      .strict()
      .parse(source);
  if (draft.kind === "review") {
    const { events, ...header } = source;
    reviewHeaderSchema.parse(header);
    z.array(reviewEventSchema).parse(events);
  }
  if (!["review", "review-new"].includes(draft.kind)) {
    schemas[draft.kind].parse(source);
    for (const field of [
      "id",
      "schemaVersion",
      "versionId",
      "unitProfileVersionId",
      "doctrineVersionId",
      "revision",
      "version",
      "contentVersion",
      "status",
      "sourceKind",
    ])
      if (canonical(source[field]) !== canonical(value[field]))
        throw Error(`Working copy cannot change ${field}`);
  }
}
export class WorkingDraftService {
  // A successful restore rotates the token. A canceled/failed restore keeps it
  // so the still-open editors can retain their unfinished work.
  private sessionToken: string;
  get token() {
    return this.sessionToken;
  }
  startNewSession() {
    this.touched.clear();
    return (this.sessionToken = this.runtime.id());
  }
  private touched = new Map<string, WorkingDraft>();
  constructor(
    private readonly repo: Repository & WorkingDraftRepository,
    private readonly runtime: Runtime,
    token = runtime.id(),
    private readonly librarySource?: (
      id: string,
      kind: DraftKey["kind"],
    ) => unknown,
  ) {
    this.sessionToken = token;
  }
  private source(key: DraftKey): unknown {
    if (["operation", "review-new"].includes(key.kind) && key.scope !== key.id)
      throw Error("Working-copy operation scope does not match its source");
    if (
      ["symbol", "orbat", "doctrine", "unit-profile", "preferences"].includes(
        key.kind,
      ) &&
      key.scope !== null
    )
      throw Error("Library working copies cannot have an operation scope");
    if (
      this.librarySource &&
      ["symbol", "orbat", "doctrine", "unit-profile"].includes(key.kind)
    )
      return this.librarySource(key.id, key.kind);
    switch (key.kind) {
      case "operation":
        return this.repo.getOperation(key.id);
      case "export-profile":
        return this.repo
          .listExportProfiles(key.scope!)
          .find((p) => p.id === key.id);
      case "symbol":
        return this.repo.getSymbol(key.id);
      case "orbat":
        return this.repo.getOrbat(key.id);
      case "doctrine":
        return this.repo
          .listDoctrines()
          .find((d) => d.doctrineVersionId === key.id);
      case "unit-profile":
        return this.repo.getUnitProfile(key.id);
      case "review": {
        const review = this.repo.getReview(key.id);
        if (review.operationId !== key.scope)
          throw Error("Review recovery scope does not match its operation");
        return review;
      }
      case "review-new": {
        const op = this.repo.getOperation(key.id);
        return { id: op.id, revision: op.revision };
      }
      case "preferences":
        if (key.id !== preferencesDraftId)
          throw Error("Invalid preferences recovery identity");
        return editablePreferences(this.repo.preferences());
    }
  }
  private compatible(d: WorkingDraft): boolean {
    try {
      validateWorkingDraft(d);
      return (
        canonical(this.source(d)) === canonical(parseWorkingJson(d.source))
      );
    } catch {
      return false;
    }
  }
  execute(input: unknown): RecoveryResult {
    const c = recoveryCommandSchema.parse(input);
    if (c.type === "discard-session") {
      this.discardSessionCopies(c.scope);
      return { token: this.token };
    }
    if (c.type === "list")
      return {
        token: this.token,
        drafts: this.repo.listWorkingDrafts().map((d) => {
          const { source: _s, value: _v, ...summary } = d;
          return { ...summary, compatible: this.compatible(d) };
        }),
      };
    if (c.type === "get") {
      const draft = this.repo.getWorkingDraft(c.key);
      return {
        token: this.token,
        draft,
        compatible: draft ? this.compatible(draft) : true,
      };
    }
    if (c.token !== this.token)
      throw Error("The workspace changed. Reopen the working-copy editor.");
    if (c.type === "recover") {
      const draft = this.repo.getWorkingDraft(c.key);
      if (!draft || draft.sequence !== c.expected || !this.compatible(draft))
        throw Error(
          "The recovery copy or saved source changed. Reopen the source before recovering.",
        );
      this.touched.set(`${draft.kind}:${draft.id}`, draft);
      return { token: this.token, draft, compatible: true };
    }
    if (c.type === "remove") {
      this.repo.removeWorkingDraft(c.key, c.expected);
      return { token: this.token, draft: null };
    }
    const draft: WorkingDraft = {
      ...c.key,
      schemaVersion: 1,
      label: c.label,
      source: c.source,
      value: c.value,
      sequence: c.expected + 1,
      updatedAt: this.runtime.now(),
    };
    validateWorkingDraft(draft);
    if (!this.compatible(draft))
      throw Error(
        "The saved source changed. Your edits remain in this editor; reload before replacing its recovery copy.",
      );
    const stored = this.repo.putWorkingDraft(draft, c.expected);
    this.touched.set(`${stored.kind}:${stored.id}`, stored);
    return { token: this.token, draft: stored, compatible: true };
  }
  discardSessionCopies(scope?: string) {
    for (const [key, d] of this.touched)
      if (!scope || d.scope === scope) {
        const current = this.repo.getWorkingDraft(d);
        if (current?.sequence === d.sequence)
          this.repo.removeWorkingDraft(d, d.sequence);
        this.touched.delete(key);
      }
  }
  commandSucceeded(command: {
    type?: string;
    operation?: unknown;
    profile?: unknown;
    value?: unknown;
    doctrine?: unknown;
  }) {
    const kinds: Record<string, DraftKey["kind"]> = {
      save: "operation",
      "save-profile": "export-profile",
      "save-symbol": "symbol",
      "save-orbat": "orbat",
      "doctrine-save": "doctrine",
      "unit-profile-save": "unit-profile",
    };
    const kind = kinds[command.type ?? ""],
      value = (command.operation ??
        command.profile ??
        command.value ??
        command.doctrine) as Record<string, unknown> | undefined;
    if (!kind || !value) return;
    const id = (value.id ??
      value.versionId ??
      value.doctrineVersionId ??
      value.unitProfileVersionId) as string;
    const key = { kind, id, scope: null },
      saved = this.repo.getWorkingDraft(key);
    if (saved && saved.value === canonical(value)) {
      this.repo.removeWorkingDraft(saved, saved.sequence);
      this.touched.delete(`${kind}:${id}`);
    }
  }
}
