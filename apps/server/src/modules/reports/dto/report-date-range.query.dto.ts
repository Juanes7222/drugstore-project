import { ReportDateRangeSchema } from './report-date-range.schema';
import { z } from 'zod';

export class ReportDateRangeQueryDto
  implements z.infer<typeof ReportDateRangeSchema>
{
  dateFrom!: string;
  dateTo!: string;

  constructor(data?: z.infer<typeof ReportDateRangeSchema>) {
    if (data) {
      this.dateFrom = data.dateFrom;
      this.dateTo = data.dateTo;
    }
  }
}
