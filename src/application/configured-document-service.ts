import type { ExportRecord } from "../domain/model";
import {
  documentExportSchema,
  type DocumentExport,
} from "../domain/document-exports";
import type { Repository, Runtime } from "./ports";
import { canonical } from "../export/projection";
import { printConnectedHtml as printDocumentHtml } from "../export/print-v3";
// Both print implementations accept the same commands and storage/render ports.
import {
  documentCommandSchema,
  type DocumentRepository,
  type DocumentRenderPort,
} from "./document-service";
export { documentCommandSchema } from "./document-service";
export type {
  DocumentCommand,
  DocumentResult,
  DocumentRepository,
  DocumentRenderPort,
} from "./document-service";
export function verifyConfiguredDocument(
  record: DocumentExport,
  bytes: Uint8Array,
  source: ExportRecord,
  hash: (v: string | Uint8Array) => string,
) {
  documentExportSchema.parse(record);
  if (
    (source.schemaVersion === 7
      ? "ordo-print-v3"
      : source.schemaVersion === 6
        ? "ordo-print-v2"
        : "ordo-print-v1") !== record.printVersion
  )
    throw Error("PDF print adaptation differs from its source");
  if (
    source.id !== record.sourceExportId ||
    source.operationId !== record.operationId ||
    hash(canonical(source)) !== record.sourceExportHash ||
    hash(source.html) !== record.sourceHtmlHash ||
    hash(printDocumentHtml(source, record.options)) !== record.printHtmlHash ||
    bytes.byteLength !== record.byteLength ||
    hash(bytes) !== record.contentHash ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    throw Error(
      "Retained PDF or its provenance differs from the recorded source",
    );
}
export class ConfiguredDocumentService {
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
    const html = printDocumentHtml(source, c.options),
      result = await this.renderer.render(html, c.options);
    const record = documentExportSchema.parse({
      schemaVersion:
        source.schemaVersion === 7 ? 3 : source.schemaVersion === 6 ? 2 : 1,
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
      printVersion:
        source.schemaVersion === 7
          ? "ordo-print-v3"
          : source.schemaVersion === 6
            ? "ordo-print-v2"
            : "ordo-print-v1",
      options: c.options,
      environment: result.environment,
    });
    this.repo.insertDocument(record, result.bytes);
    return record;
  }
}
