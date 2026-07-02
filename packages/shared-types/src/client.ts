import { IdentificationType } from "./enums";

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  identificationType: IdentificationType;
  identificationNumber: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}
