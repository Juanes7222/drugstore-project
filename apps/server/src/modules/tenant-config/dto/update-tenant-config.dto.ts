import { z } from 'zod';
import { UpdateTenantConfigSchema } from './update-tenant-config.schema';

export class UpdateTenantConfigDto
  implements z.infer<typeof UpdateTenantConfigSchema>
{
  strictness?: z.infer<typeof UpdateTenantConfigSchema.shape.strictness>;
  fiscal?: z.infer<typeof UpdateTenantConfigSchema.shape.fiscal>;
  workflow?: z.infer<typeof UpdateTenantConfigSchema.shape.workflow>;
  purchases?: z.infer<typeof UpdateTenantConfigSchema.shape.purchases>;
  expectedConfigVersion!: number;

  constructor(data?: z.infer<typeof UpdateTenantConfigSchema>) {
    if (data) {
      this.strictness = data.strictness;
      this.fiscal = data.fiscal;
      this.workflow = data.workflow;
      this.purchases = data.purchases;
      this.expectedConfigVersion = data.expectedConfigVersion;
    }
  }
}
