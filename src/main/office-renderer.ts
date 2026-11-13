import type {
  OfficePayload,
  OfficeRenderPort,
} from "../application/office-service";
import { DocumentRenderer } from "./document-renderer";
import { createOfficeDocx } from "./office-docx";
import { applicationVersion } from "./app-version";
export class OfficeRenderer implements OfficeRenderPort {
  appVersion = applicationVersion;
  constructor(private documents: DocumentRenderer) {}
  async render(payload: OfficePayload, at: string) {
    const image = (data: string) => this.documents.officeImage(data);
    if (payload.kind !== "order")
      throw Error("Only Word orders are available in this release.");
    const bytes = await createOfficeDocx(
      payload.export,
      payload.options,
      at,
      image,
    );
    if (bytes.byteLength > 128 * 1024 * 1024)
      throw Error("Office export exceeds 128 MiB.");
    return bytes;
  }
}
