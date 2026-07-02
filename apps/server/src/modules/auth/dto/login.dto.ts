import { UserLoginSchema } from '@pharmacy/shared-validation';
import { z } from 'zod';

export class LoginDto implements z.infer<typeof UserLoginSchema> {
  email!: string;
  password!: string;
}
