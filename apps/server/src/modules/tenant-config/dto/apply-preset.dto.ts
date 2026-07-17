import { z } from 'zod';
import { ApplyPresetSchema } from './update-tenant-config.schema';

export class ApplyPresetDto implements z.infer<typeof ApplyPresetSchema> {
  presetCode!: 'SIMPLE' | 'BALANCED' | 'STRICT';

  constructor(data?: z.infer<typeof ApplyPresetSchema>) {
    if (data) {
      this.presetCode = data.presetCode;
    }
  }
}
