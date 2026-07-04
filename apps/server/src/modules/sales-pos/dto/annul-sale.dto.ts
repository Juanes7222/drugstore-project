import { z } from "zod";

export const AnnulSaleSchema = z.object({
  annulmentReason: z.string().min(1, "Annulment reason is required"),
  annulmentNotes: z.string().optional(),
});

export type AnnulSaleDto = z.infer<typeof AnnulSaleSchema>;
