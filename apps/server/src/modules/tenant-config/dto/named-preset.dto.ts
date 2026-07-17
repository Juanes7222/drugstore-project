import { z } from 'zod';
import {
  CreateNamedPresetSchema,
  UpdateNamedPresetSchema,
} from './update-tenant-config.schema';

export class CreateNamedPresetDto
  implements z.infer<typeof CreateNamedPresetSchema>
{
  name!: string;
  description?: string;
  isShared!: boolean;

  constructor(data?: z.infer<typeof CreateNamedPresetSchema>) {
    if (data) {
      this.name = data.name;
      this.description = data.description;
      this.isShared = data.isShared;
    }
  }
}

export class UpdateNamedPresetDto
  implements z.infer<typeof UpdateNamedPresetSchema>
{
  name?: string;
  description?: string;
  isShared?: boolean;

  constructor(data?: z.infer<typeof UpdateNamedPresetSchema>) {
    if (data) {
      this.name = data.name;
      this.description = data.description;
      this.isShared = data.isShared;
    }
  }
}
