import { z } from 'zod';
import {
  AddCustomToggleSchema,
  UpdateCustomToggleSchema,
} from './update-tenant-config.schema';

export class AddCustomToggleDto
  implements z.infer<typeof AddCustomToggleSchema>
{
  id?: string;
  name!: string;
  key!: string;
  description!: string;
  type!: 'BOOLEAN' | 'SELECT' | 'AMOUNT';
  defaultValue!: boolean | string | number;
  options?: Array<{ label: string; value: string }>;
  appliesTo!: 'SALE' | 'RETURN' | 'INVENTORY' | 'CLIENT' | 'ALL';
  isAdvisory!: boolean;

  constructor(data?: z.infer<typeof AddCustomToggleSchema>) {
    if (data) {
      this.id = data.id;
      this.name = data.name;
      this.key = data.key;
      this.description = data.description;
      this.type = data.type;
      this.defaultValue = data.defaultValue;
      this.options = data.options;
      this.appliesTo = data.appliesTo;
      this.isAdvisory = data.isAdvisory;
    }
  }
}

export class UpdateCustomToggleDto
  implements z.infer<typeof UpdateCustomToggleSchema>
{
  name?: string;
  description?: string;
  type?: 'BOOLEAN' | 'SELECT' | 'AMOUNT';
  defaultValue?: boolean | string | number;
  options?: Array<{ label: string; value: string }>;
  appliesTo?: 'SALE' | 'RETURN' | 'INVENTORY' | 'CLIENT' | 'ALL';
  isAdvisory?: boolean;

  constructor(data?: z.infer<typeof UpdateCustomToggleSchema>) {
    if (data) {
      this.name = data.name;
      this.description = data.description;
      this.type = data.type;
      this.defaultValue = data.defaultValue;
      this.options = data.options;
      this.appliesTo = data.appliesTo;
      this.isAdvisory = data.isAdvisory;
    }
  }
}
