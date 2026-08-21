import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { CatalogModule } from '@/modules/catalog/catalog.module';
import { ClientsModule } from '@/modules/clients/clients.module';
import { BullMqModule } from '@/infrastructure/queue/bullmq.module';
import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import.service';
import { DataImportProcessingJob } from './data-import-processing.job';
import { ImportParseCache } from './import-parse-cache';
import { ImportTemplateService } from './import-template.service';
import { ImportDefinitionRegistry } from './import-definition-registry';
import { ProductImportDefinition } from './product-import.definition';
import { ClientImportDefinition } from './client-import.definition';
import { CsvSourceAdapter } from './csv-source.adapter';
import { ExcelSourceAdapter } from './excel-source.adapter';
import { JsonSourceAdapter } from './json-source.adapter';

@Module({
  imports: [PrismaModule, CatalogModule, ClientsModule, BullMqModule],
  controllers: [DataImportController],
  providers: [
    DataImportService,
    DataImportProcessingJob,
    ImportParseCache,
    ImportTemplateService,
    ImportDefinitionRegistry,
    ProductImportDefinition,
    ClientImportDefinition,
    CsvSourceAdapter,
    ExcelSourceAdapter,
    JsonSourceAdapter,
  ],
  exports: [DataImportService],
})
export class DataImportModule {}
