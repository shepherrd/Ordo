import {
  nativeExchangeSchema,
  type NativeExchange,
  type ExchangeDependency,
  type ExchangeRoot,
} from "../domain/library-exchange";
import { profileSymbol } from "../domain/unit-profiles";
import type {
  MilitarySymbolDefinition,
  ExactLibraryRef,
  SavedSymbolPin,
} from "../domain/symbology";
import type { SymbologyRepository } from "./symbology-ports";
import { canonical } from "../export/projection";
type Hash = (text: string) => string;
export function assertNativeExchange(
  input: unknown,
  hash: Hash,
): NativeExchange {
  const e = nativeExchangeSchema.parse(input),
    { contentHash, ...payload } = e;
  if (
    hash(canonical(payload)) !== contentHash ||
    hash(canonical(e.root.value)) !== e.rootHash
  )
    throw Error("Native exchange content hash mismatch");
  const deps = new Map<string, ExchangeDependency>(),
    used = new Set<string>(),
    visiting = new Set<string>();
  for (const d of e.dependencies) {
    const key = d.kind + ":" + d.ref.versionId;
    if (deps.has(key)) throw Error("Duplicate native dependency identity");
    const familyId =
        d.kind === "SYMBOL"
          ? d.document.familyId
          : d.document.unitProfileFamilyId,
      versionId =
        d.kind === "SYMBOL"
          ? d.document.versionId
          : d.document.unitProfileVersionId;
    if (
      d.document.status !== "PUBLISHED" ||
      familyId !== d.ref.familyId ||
      versionId !== d.ref.versionId ||
      hash(canonical(d.document)) !== d.ref.contentHash
    )
      throw Error("Dependency identity, lifecycle or content hash mismatch");
    deps.set(key, d);
  }
  const need = (
    kind: "SYMBOL" | "PROFILE",
    ref: ExactLibraryRef,
  ): ExchangeDependency => {
    const key = kind + ":" + ref.versionId,
      d = deps.get(key);
    if (!d || canonical(d.ref) !== canonical(ref))
      throw Error("Missing or mismatched dependency " + key);
    if (visiting.has(key)) throw Error("Symbol dependency cycle");
    if (visiting.size >= 64) throw Error("Symbol dependency depth exceeds 64");
    if (!used.has(key)) {
      visiting.add(key);
      if (d.kind === "SYMBOL") definition(d.document.definition);
      else {
        const s = profileSymbol(d.document);
        if (s) pin(s);
      }
      visiting.delete(key);
      used.add(key);
    }
    return d;
  };
  const definition = (d: MilitarySymbolDefinition) => {
    if (d.origin.kind === "SAVED_SYMBOL") need("SYMBOL", d.origin.source);
  };
  const pin = (p: SavedSymbolPin) => {
    const d = need("SYMBOL", {
      familyId: p.familyId,
      versionId: p.versionId,
      contentHash: p.contentHash,
    });
    if (
      d.kind !== "SYMBOL" ||
      canonical(p.definition) !== canonical(d.document.definition) ||
      p.definitionHash !== hash(canonical(p.definition))
    )
      throw Error("Pinned symbol definition mismatch");
  };
  const snapshot = (s: {
    definition: MilitarySymbolDefinition;
    source: ExactLibraryRef | null;
  }) => {
    definition(s.definition);
    if (s.source) {
      const d = need("SYMBOL", s.source);
      if (
        d.kind !== "SYMBOL" ||
        canonical(d.document.definition) !== canonical(s.definition)
      )
        throw Error("Symbol snapshot dependency mismatch");
    }
  };
  if (e.root.kind === "SYMBOL") definition(e.root.value.definition);
  else
    for (const n of e.root.value.nodes) {
      if (n.unit.kind === "UNIT_PROFILE") {
        const d = need("PROFILE", n.unit.source);
        if (
          d.kind !== "PROFILE" ||
          canonical(d.document.identity) !== canonical(n.unit.identity) ||
          canonical(profileSymbol(d.document)) !==
            canonical(n.unit.defaultSymbol)
        )
          throw Error("ORBAT profile dependency mismatch");
        if (n.unit.defaultSymbol) pin(n.unit.defaultSymbol);
      } else if (n.unit.symbol) snapshot(n.unit.symbol);
      if (n.symbolOverride) snapshot(n.symbolOverride);
    }
  if (used.size !== deps.size)
    throw Error("Native package contains unrelated dependencies");
  return e;
}
export function createNativeExchange(
  root: ExchangeRoot,
  repo: SymbologyRepository,
  hash: Hash,
): NativeExchange {
  const dependencies = new Map<string, ExchangeDependency>(),
    visiting = new Set<string>();
  const add = (kind: "SYMBOL" | "PROFILE", ref: ExactLibraryRef) => {
    const key = kind + ":" + ref.versionId;
    if (visiting.has(key)) throw Error("Symbol dependency cycle");
    if (visiting.size >= 64) throw Error("Symbol dependency depth exceeds 64");
    if (dependencies.has(key)) return;
    const loaded = repo.lookupExchangeDependency(kind, ref.versionId);
    if (!loaded) throw Error("Missing native dependency");
    const d = structuredClone(loaded);
    if (d.document.status === "RETIRED") {
      d.document.status = "PUBLISHED";
      d.document.retiredAt = null;
    }
    if (canonical(d.ref) !== canonical(ref))
      throw Error("Native dependency reference mismatch");
    visiting.add(key);
    if (d.kind === "SYMBOL") definition(d.document.definition);
    else {
      const s = profileSymbol(d.document);
      if (s)
        add("SYMBOL", {
          familyId: s.familyId,
          versionId: s.versionId,
          contentHash: s.contentHash,
        });
    }
    visiting.delete(key);
    dependencies.set(key, d);
  };
  const definition = (d: MilitarySymbolDefinition) => {
    if (d.origin.kind === "SAVED_SYMBOL") add("SYMBOL", d.origin.source);
  };
  const snapshot = (s: {
    definition: MilitarySymbolDefinition;
    source: ExactLibraryRef | null;
  }) => {
    definition(s.definition);
    if (s.source) add("SYMBOL", s.source);
  };
  if (root.kind === "SYMBOL") definition(root.value.definition);
  else
    for (const n of root.value.nodes) {
      if (n.unit.kind === "UNIT_PROFILE") add("PROFILE", n.unit.source);
      else if (n.unit.symbol) snapshot(n.unit.symbol);
      if (n.symbolOverride) snapshot(n.symbolOverride);
    }
  const payload = {
    format: "ORDO_LIBRARY_EXCHANGE" as const,
    schemaVersion: 1 as const,
    dependencyScope: "COMPOSITION_PINS_AND_SYMBOL_ORIGINS" as const,
    root,
    rootHash: hash(canonical(root.value)),
    dependencies: [...dependencies.values()].sort((a, b) =>
      (a.kind + a.ref.versionId).localeCompare(b.kind + b.ref.versionId),
    ),
  };
  return assertNativeExchange(
    { ...payload, contentHash: hash(canonical(payload)) },
    hash,
  );
}
