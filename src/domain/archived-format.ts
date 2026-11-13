import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";

// One-way allowlist for immutable, pre-release wire identifiers. A reader can
// recognize an exact value without having a writer for the retired format.
const digests = {
  layout: "997618e9c7e9cd66bcfffc20b084235ce57b9b54f37aaceeb6d29ab74829d9a1",
  labels: "11ec0ff96b6ee1e64826d8844c90445e0f8ae6fd51df03189b5863e57013f292",
  numeric: "b2cafb513c3b0f228b1a7dc8e7e98cdceb5586875cef537157e0c6b0b3560be4",
  letter: "cfd8bd6f4ee72af65efd4eab461ec2e671e84876c25b76443be4baa3c4651d62",
  importer: "eb63b5c7464f5a136a0e5a08334ef1934833f9a104a08db9092674e07d486a45",
  graphic: "18ce04a68dd95e2135d094696838466d982bf53928d7f8d247a4e7a4d65db6b9",
  adapter: "3ce4ba7ecc15d51babedbd6f76330440fe83408f55aa0f2ed652babdd5335f23",
} as const;

export function isArchivedId(
  kind: keyof typeof digests,
  value: unknown,
): boolean {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    bytesToHex(sha256(utf8ToBytes(value))) === digests[kind]
  );
}
export const archivedId = (kind: keyof typeof digests) =>
  z
    .string()
    .max(64)
    .refine(
      (value) => isArchivedId(kind, value),
      "Unknown archived format identifier",
    );
