import { z } from "zod";
import { idSchema, type ExportRecord } from "../domain/model";
import {
  documentExportSchema,
  paperOptionsSchema,
  type DocumentExport,
  type PaperOptions,
} from "../domain/document-exports";
import type { Repository, Runtime } from "./ports";
import { canonical } from "../export/projection";
import { printHtmlV1 } from "../export/print-v1";
export const documentCommandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("generate"),
      operationId: idSchema,
      exportId: idSchema,
      options: paperOptionsSchema,
    })
    .strict(),
  z.object({ type: z.literal("list"), operationId: idSchema }).strict(),
  z.object({ type: z.literal("save"), id: idSchema }).strict(),
  z.object({ type: z.literal("print"), id: idSchema }).strict(),
]);
export type DocumentCommand = z.infer<typeof documentCommandSchema>;
export type DocumentResult = {
  record?: DocumentExport;
  records?: DocumentExport[];
  path?: string | null;
  printed?: boolean;
};
export interface DocumentRepository {
  insertDocument(record: DocumentExport, bytes: Uint8Array): void;
  getDocument(id: string): { record: DocumentExport; bytes: Uint8Array };
  listDocuments(operationId: string): DocumentExport[];
}
export interface DocumentRenderPort {
  render(
    html: string,
    options: PaperOptions,
  ): Promise<{ bytes: Uint8Array; environment: DocumentExport["environment"] }>;
}
export function verifyDocument(
  record: DocumentExport,
  bytes: Uint8Array,
  source: ExportRecord,
  hash: (v: string | Uint8Array) => string,
) {
  documentExportSchema.parse(record);
  if (
    source.id !== record.sourceExportId ||
    source.operationId !== record.operationId ||
    hash(canonical(source)) !== record.sourceExportHash ||
    hash(source.html) !== record.sourceHtmlHash ||
    hash(printHtmlV1(source, record.options)) !== record.printHtmlHash ||
    bytes.byteLength !== record.byteLength ||
    hash(bytes) !== record.contentHash ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    throw Error(
      "Retained PDF or its provenance differs from the recorded source",
    );
}
export class DocumentService {
  constructor(
    private readonly repo: Repository & DocumentRepository,
    private readonly runtime: Runtime,
    private readonly renderer: DocumentRenderPort,
  ) {}
  async generate(input: unknown) {
    const c = documentCommandSchema.parse(input);
    if (c.type !== "generate")
      throw Error("Expected a document generation command");
    const source = this.repo
      .listExports(c.operationId)
      .find((e) => e.id === c.exportId);
    if (!source)
      throw Error(
        "Generate or select a retained export in this operation first",
      );
    const html = printHtmlV1(source, c.options),
      result = await this.renderer.render(html, c.options);
    const record = documentExportSchema.parse({
      schemaVersion: 1,
      id: this.runtime.id(),
      operationId: c.operationId,
      sourceExportId: c.exportId,
      sourceExportHash: this.repo.hash(canonical(source)),
      sourceHtmlHash: this.repo.hash(source.html),
      printHtmlHash: this.repo.hash(html),
      contentHash: this.repo.hashBinary(result.bytes),
      byteLength: result.bytes.byteLength,
      generatedAt: this.runtime.now(),
      actor: this.runtime.actor,
      printVersion: "ordo-print-v1",
      options: c.options,
      environment: result.environment,
    });
    this.repo.insertDocument(record, result.bytes);
    return record;
  }
}
