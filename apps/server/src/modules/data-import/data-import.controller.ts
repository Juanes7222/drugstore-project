import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { ImportSourceFormat } from '@pharmacy/database';
import { RoleType } from '@pharmacy/shared-types';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { DataImportService } from './data-import.service';
import { ImportTemplateService } from './import-template.service';
import { ImportDefinitionRegistry } from './import-definition-registry';
import {
  ImportRequestSchema,
  ImportRequestDto,
} from './dto/import-request.dto';
import { QueryImportsSchema, QueryImportsDto } from './dto/query-imports.dto';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';
import { MAX_IMPORT_FILE_BYTES } from './constants/import.constants';
import type { User } from '@pharmacy/shared-types';

const ImportTemplateParamsSchema = z.object({
  entityKey: z.string().min(1),
  format: z.enum(['CSV', 'XLSX', 'JSON']),
});

const IMPORT_ADMIN_ROLES = [RoleType.ADMIN, RoleType.MANAGER];

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataImportController {
  constructor(
    private readonly dataImportService: DataImportService,
    private readonly templateService: ImportTemplateService,
    private readonly registry: ImportDefinitionRegistry,
  ) {}

  /** Lists importable entities and their accepted columns (UI renderer + templates). */
  @Get('definitions')
  @Roles(...IMPORT_ADMIN_ROLES)
  async listDefinitions() {
    return this.registry.list();
  }

  @Get('templates/:entityKey/:format')
  @Roles(...IMPORT_ADMIN_ROLES)
  async downloadTemplate(
    @Param(new ZodValidationPipe(ImportTemplateParamsSchema))
    params: z.infer<typeof ImportTemplateParamsSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const template = await this.templateService.generateTemplate(
      params.entityKey,
      params.format as ImportSourceFormat,
    );
    res.setHeader('Content-Type', template.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${template.fileName}"`,
    );
    return template.content;
  }

  /** Validates a file without writing anything; reports per-row errors. */
  @Post('preview')
  @Roles(...IMPORT_ADMIN_ROLES)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }),
  )
  async preview(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMPORT_FILE_BYTES }),
        ],
      }),
    ) // Multer's uploaded file; typed loosely because @types/multer is not
    file // installed (same pattern as admin-updates.controller).
    : { buffer: Buffer; originalname: string } | undefined,
    @Body(new ZodValidationPipe(ImportRequestSchema)) dto: ImportRequestDto,
  ) {
    if (!file) {
      throw new ImportFileInvalidException('No file was uploaded');
    }
    return this.dataImportService.preview(dto, file.buffer, file.originalname);
  }

  /**
   * Validates the file synchronously (422 with per-row errors when invalid)
   * and enqueues the import onto the BullMQ imports queue. Returns 202 with
   * the importId; progress and final per-row results are polled through
   * GET /imports/:id and listed in GET /imports.
   */
  @Post('execute')
  @Roles(...IMPORT_ADMIN_ROLES)
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } }),
  )
  async execute(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMPORT_FILE_BYTES }),
        ],
      }),
    )
    file: { buffer: Buffer; originalname: string } | undefined,
    @Body(new ZodValidationPipe(ImportRequestSchema)) dto: ImportRequestDto,
    @CurrentUser() user: User,
  ) {
    if (!file) {
      throw new ImportFileInvalidException('No file was uploaded');
    }
    return this.dataImportService.execute(
      dto,
      file.buffer,
      file.originalname,
      user.id,
      user.role ?? null,
    );
  }

  /** Import history, newest first. */
  @Get()
  @Roles(...IMPORT_ADMIN_ROLES)
  async history(
    @Query(new ZodValidationPipe(QueryImportsSchema)) query: QueryImportsDto,
  ) {
    return this.dataImportService.listImports(query);
  }

  /** One import with its per-row results. */
  @Get(':id')
  @Roles(...IMPORT_ADMIN_ROLES)
  async detail(@Param('id') importId: string) {
    return this.dataImportService.getImport(importId);
  }
}
