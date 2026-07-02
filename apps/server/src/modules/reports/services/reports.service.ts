import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { ReportDateRangeQueryDto } from '../dto/report-date-range.query.dto';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getSalesSummary(query: ReportDateRangeQueryDto): Promise<any> {
    throw new NotImplementedForPhaseException('reports', 'getSalesSummary');
  }

  async getCashShiftSummary(query: ReportDateRangeQueryDto): Promise<any> {
    throw new NotImplementedForPhaseException('reports', 'getCashShiftSummary');
  }

  async getInventoryValuation(query: ReportDateRangeQueryDto): Promise<any> {
    throw new NotImplementedForPhaseException('reports', 'getInventoryValuation');
  }

  async getTaxSummary(query: ReportDateRangeQueryDto): Promise<any> {
    throw new NotImplementedForPhaseException('reports', 'getTaxSummary');
  }
}
