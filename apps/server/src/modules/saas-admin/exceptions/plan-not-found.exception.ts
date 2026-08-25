import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

/** 404 — no Plan row carries the requested code. */
export class PlanNotFoundException extends DomainException {
  constructor(planCode: string) {
    super(
      'PLAN_NOT_FOUND',
      `Plan with code ${planCode} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
