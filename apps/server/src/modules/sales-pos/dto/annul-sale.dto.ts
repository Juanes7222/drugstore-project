import { z } from "zod";

/**
 * @deprecated The `.min(1)` constraint on `annulmentReason` has been removed
 * from the HTTP-level DTO because the POS now validates annulments locally.
 * The authoritative "reason is required" validation has been relocated to
 * `SalesService.annul()` so that sync dispatcher replays are also protected.
 */
export const AnnulSaleSchema = z.object({
  annulmentReason: z.string(),
  annulmentNotes: z.string().optional(),
});

export type AnnulSaleDto = z.infer<typeof AnnulSaleSchema>;
