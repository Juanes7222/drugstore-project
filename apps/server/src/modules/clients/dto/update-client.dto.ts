import { CreateClientSchema } from './create-client.dto';
import { z } from 'zod';

export const UpdateClientSchema = CreateClientSchema.partial();

export type UpdateClientDto = z.infer<typeof UpdateClientSchema>;
