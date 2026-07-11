import { z } from 'zod';

export const CreateUserSchema = z.object({
  displayName: z.string().min(1).max(100),
  username: z.string().min(3).max(50).optional(),
  email: z.string().email().optional(),
  role: z.enum(['MANAGER', 'CASHIER']),
  initialPin: z.string().min(4).max(6).regex(/^\d+$/).optional(),
  initialPassword: z.string().min(8).max(128).optional(),
  locationIds: z.array(z.string()).optional(),
});

export class CreateUserDto implements z.infer<typeof CreateUserSchema> {
  displayName!: string;
  username?: string;
  email?: string;
  role!: 'MANAGER' | 'CASHIER';
  initialPin?: string;
  initialPassword?: string;
  locationIds?: string[];
}

export const UpdateUserSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  role: z.enum(['MANAGER', 'CASHIER']).optional(),
  locationIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export class UpdateUserDto implements z.infer<typeof UpdateUserSchema> {
  displayName?: string;
  role?: 'MANAGER' | 'CASHIER';
  locationIds?: string[];
  isActive?: boolean;
}
