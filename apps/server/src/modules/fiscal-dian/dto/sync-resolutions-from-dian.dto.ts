import { SyncResolutionsFromDianSchema } from './sync-resolutions-from-dian.schema';
import { z } from 'zod';

export class SyncResolutionsFromDianDto
  implements z.infer<typeof SyncResolutionsFromDianSchema>
{
  workstationId!: string | null;

  constructor(data?: z.infer<typeof SyncResolutionsFromDianSchema>) {
    if (data) {
      this.workstationId = data.workstationId ?? null;
    }
  }
}
