import { z } from "zod";
export const exchangeOriginSchema = z
  .object({
    importId: z.string().uuid(),
    targetVersionId: z.string().uuid(),
  })
  .strict();
