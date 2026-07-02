import { SetMetadata } from '@nestjs/common';
import { AuditAction, SystemModule } from '@pharmacy/shared-types';

export const AUDITABLE_KEY = 'auditable';

export interface AuditableMetadata {
  action: AuditAction;
  module: SystemModule;
  entityType: string;
}

export const Auditable = (metadata: AuditableMetadata) =>
  SetMetadata(AUDITABLE_KEY, metadata);
