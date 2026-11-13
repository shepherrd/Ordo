import {
  exchangeImportReceiptSchema,
  type ExchangeImportReceipt,
} from "../domain/library-exchange";
import { m6Limits } from "../domain/orbat";
import { parseExchangeJson } from "./exchange-json";
import { assertNativeExchange } from "./native-exchange";
// Receipts retain initial Draft snapshots, independent of subsequent editing or deletion.
export function assertExchangeReceipt(
  input: unknown,
  hash: (text: string) => string,
): ExchangeImportReceipt {
  const r = exchangeImportReceiptSchema.parse(input);
  if (new TextEncoder().encode(JSON.stringify(r)).length > 64 * 1024 * 1024)
    throw Error("Import receipt exceeds 64 MiB evidence budget");
  if (
    new TextEncoder().encode(r.sourceText).length > m6Limits.jsonBytes ||
    hash(r.sourceText) !== r.sourceHash
  )
    throw Error("Import source hash or size mismatch");
  const source = parseExchangeJson(r.sourceText);
  if (r.importer === "ordo-exchange-v1") assertNativeExchange(source, hash);
  if (r.fields.some((f) => f.action === "INVALID") || !r.targets.length)
    throw Error("Invalid conversion cannot be committed");
  const ids = new Set<string>();
  for (const t of r.targets) {
    const v = t.value;
    if (
      v.status !== "DRAFT" ||
      v.contentVersion !== 1 ||
      v.parentVersionId ||
      v.duplicatedFrom ||
      v.exchangeOrigin?.importId !== r.id ||
      v.exchangeOrigin.targetVersionId !== v.versionId ||
      ids.has(v.versionId)
    )
      throw Error("Import target identity or lifecycle mismatch");
    ids.add(v.versionId);
  }
  return r;
}
