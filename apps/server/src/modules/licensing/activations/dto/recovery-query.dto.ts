import { z } from "zod";

/** Query params for the public activation-code recovery endpoint. */
export const RecoverActivationCodesQuerySchema = z.object({
  taxId: z.string().min(3).max(50),
  email: z.string().email(),
});

export type RecoverActivationCodesQueryDto = z.infer<
  typeof RecoverActivationCodesQuerySchema
>;
