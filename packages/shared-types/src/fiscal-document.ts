import { FiscalDocumentState, FiscalDocumentType } from "./enums";

export interface FiscalDocument {
  id: string;
  saleId: string;
  documentType: FiscalDocumentType;
  state: FiscalDocumentState;
  documentNumber: string | null;
  cufe: string | null;
  xmlPayload: string | null;
  dianResponse: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
