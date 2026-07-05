import { UpsertSystemConfigSchema } from './system-config-value.schema';
import { z } from 'zod';

export class UpsertSystemConfigDto
  implements z.infer<typeof UpsertSystemConfigSchema>
{
  key!: string;
  module!: string;
  description?: string;
  isSensitive!: boolean;
  configValue!: {
    valueType: 'NUMBER' | 'BOOLEAN' | 'STRING' | 'ARRAY' | 'OBJECT';
    value: any;
  };

  constructor(data?: z.infer<typeof UpsertSystemConfigSchema>) {
    if (data) {
      this.key = data.key;
      this.module = data.module;
      this.description = data.description;
      this.isSensitive = data.isSensitive;
      this.configValue = data.configValue;
    }
  }
}
