import { z } from 'zod';
import {
  AddCustomFieldSchema,
  UpdateCustomFieldSchema,
} from './update-tenant-config.schema';

export class AddCustomFieldDto
  implements z.infer<typeof AddCustomFieldSchema>
{
  id?: string;
  name!: string;
  key!: string;
  type!: 'TEXT' | 'NUMBER' | 'DATE' | 'URL' | 'EMAIL';
  value!: string | number | Date;
  required!: boolean;
  showOnInvoice!: boolean;
  showOnReport!: boolean;
  order!: number;

  constructor(data?: z.infer<typeof AddCustomFieldSchema>) {
    if (data) {
      this.id = data.id;
      this.name = data.name;
      this.key = data.key;
      this.type = data.type;
      this.value = data.value;
      this.required = data.required;
      this.showOnInvoice = data.showOnInvoice;
      this.showOnReport = data.showOnReport;
      this.order = data.order;
    }
  }
}

export class UpdateCustomFieldDto
  implements z.infer<typeof UpdateCustomFieldSchema>
{
  name?: string;
  type?: 'TEXT' | 'NUMBER' | 'DATE' | 'URL' | 'EMAIL';
  value?: string | number | Date;
  required?: boolean;
  showOnInvoice?: boolean;
  showOnReport?: boolean;
  order?: number;

  constructor(data?: z.infer<typeof UpdateCustomFieldSchema>) {
    if (data) {
      this.name = data.name;
      this.type = data.type;
      this.value = data.value;
      this.required = data.required;
      this.showOnInvoice = data.showOnInvoice;
      this.showOnReport = data.showOnReport;
      this.order = data.order;
    }
  }
}
