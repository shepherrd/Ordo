import { z } from "zod";

export const deletionTargetSchema = z
  .object({
    kind: z.enum([
      "operation",
      "symbol",
      "orbat",
      "unit-profile",
      "doctrine",
      "export-profile",
      "asset",
    ]),
    id: z.string().uuid(),
  })
  .strict();
export type DeletionTarget = z.infer<typeof deletionTargetSchema>;
export type DeletionPreview = {
  target: DeletionTarget;
  name: string;
  version: string | null;
  fingerprint: string;
  counts: { label: string; count: number }[];
  blockers: string[];
  retainedImportReceipt: boolean;
  retainedSnapshots?: boolean;
};
export type DeletionResult = {
  deleted: boolean;
  target: DeletionTarget;
  reason?: "canceled" | "referenced";
};
export interface DeletionRepository {
  prepareDeletion(target: DeletionTarget): DeletionPreview;
  permanentlyDelete(target: DeletionTarget, expectedFingerprint: string): void;
}
export class DeletionService {
  constructor(private readonly repo: DeletionRepository) {}
  preview(input: unknown) {
    return this.repo.prepareDeletion(deletionTargetSchema.parse(input));
  }
  commit(input: unknown) {
    const command = z
      .object({
        target: deletionTargetSchema,
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(input);
    this.repo.permanentlyDelete(command.target, command.fingerprint);
    return { deleted: true, target: command.target } satisfies DeletionResult;
  }
}
