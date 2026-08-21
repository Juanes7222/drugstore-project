import { z } from 'zod';

/** Multipart form fields that accompany the uploaded import file. */
export const ImportRequestSchema = z.object({
  entityKey: z.string().min(1),
  /** Optional; when absent the format is detected from the file extension. */
  format: z.enum(['CSV', 'XLSX', 'JSON']).optional(),
});

export type ImportRequestDto = z.infer<typeof ImportRequestSchema>;
