import { ClientSchema } from '@pharmacy/shared-validation';
import { z } from 'zod';

export class UpdateClientDto {
  fullName?: string;
  identificationType?: string;
  identificationNumber?: string;
  email?: string;
  phoneNumber?: string;
  municipality?: string;
  classificationId?: string;
  consentScope?: Record<string, boolean>;

  constructor(data?: any) {
    if (data) {
      this.fullName = data.fullName;
      this.identificationType = data.identificationType;
      this.identificationNumber = data.identificationNumber;
      this.email = data.email;
      this.phoneNumber = data.phoneNumber;
      this.municipality = data.municipality;
      this.classificationId = data.classificationId;
      this.consentScope = data.consentScope;
    }
  }
}
