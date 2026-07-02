import { SupplierSchema } from './supplier.schema';
import { z } from 'zod';

const UpdateSupplierSchema = SupplierSchema.partial();

export class UpdateSupplierDto
  implements Partial<z.infer<typeof SupplierSchema>>
{
  name?: string;
  identificationType?: 'NIT' | 'CC' | 'CE' | 'PASSPORT';
  identificationNumber?: string;
  email?: string;
  phoneNumber?: string;
  country?: string;
  creditLimit?: string;

  constructor(data?: Partial<z.infer<typeof SupplierSchema>>) {
    if (data) {
      this.name = data.name;
      this.identificationType = data.identificationType;
      this.identificationNumber = data.identificationNumber;
      this.email = data.email;
      this.phoneNumber = data.phoneNumber;
      this.country = data.country;
      this.creditLimit = data.creditLimit;
    }
  }
}
