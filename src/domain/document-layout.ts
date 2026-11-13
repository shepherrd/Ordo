import { z } from "zod";
import { assetSchema } from "./modules";

const line = z
  .string()
  .max(240)
  .refine((v) => !/[\x00-\x1f\x7f]/.test(v), "Use a single line of text");
export const documentLayoutSchema = z
  .object({
    schemaVersion: z.literal(1),
    header: z
      .object({
        title: line,
        unit: line,
        organization: line,
        location: line,
        dateTime: line,
        classification: line,
        logo: assetSchema
          .refine(
            (a) => a.mimeType.startsWith("image/"),
            "Choose an image for the header logo",
          )
          .nullable(),
      })
      .strict(),
    footer: z
      .object({
        left: line,
        centre: line,
        right: line,
        pageNumbers: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type DocumentLayout = z.infer<typeof documentLayoutSchema>;
export const newDocumentLayout = (): DocumentLayout => ({
  schemaVersion: 1,
  header: {
    title: "OPERATION ORDER",
    unit: "",
    organization: "",
    location: "",
    dateTime: "",
    classification: "",
    logo: null,
  },
  footer: { left: "", centre: "", right: "", pageNumbers: false },
});
