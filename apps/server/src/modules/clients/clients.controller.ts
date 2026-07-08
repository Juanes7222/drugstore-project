import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto, CreateClientSchema } from './dto/create-client.dto';
import { UpdateClientDto, UpdateClientSchema } from './dto/update-client.dto';
import { QueryClientDto } from './dto/query-client.dto';
import { RegisterConsentDto, RegisterConsentSchema } from './dto/register-consent.dto';
import { SetClassificationDto, SetClassificationSchema } from './dto/set-classification.dto';
import { RequestDataSubjectActionDto, RequestDataSubjectActionSchema } from './dto/request-data-subject-action.dto';
import { ResolveDataSubjectRequestDto, ResolveDataSubjectRequestSchema } from './dto/resolve-data-subject-request.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuditAction, SystemModule, RoleType, User } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryClientDto): Promise<any> {
    return this.clientsService.findAll(query);
  }

  @Get('sync')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findSync(
    @Query('since') since?: string,
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '200',
  ): Promise<any> {
    return this.clientsService.findSync(
      since || undefined,
      Number(page),
      Number(pageSize),
    );
  }

  @Get('classifications/all')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAllClassifications(): Promise<any> {
    return this.clientsService.findAllClassifications();
  }

  @Get(':id')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.clientsService.findById(id);
  }

  /**
   * @deprecated The POS desktop no longer calls this endpoint directly.
   * Client creation is now sent through `POST /sync/batch` as a
   * `CLIENT_CREATION` operation to support offline-first synchronization.
   * This endpoint is preserved **exclusively** for Backoffice administrative
   * use and manual overrides from the web interface.
   */
  @Post()
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({ action: AuditAction.CREATE, module: SystemModule.CLIENTS, entityType: 'Client' })
  async create(
    @Body(new ZodValidationPipe(CreateClientSchema)) dto: CreateClientDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientsService.create(dto, user.id);
  }

  /**
   * @deprecated The POS desktop no longer calls this endpoint directly.
   * Client updates are now sent through `POST /sync/batch` as a
   * `CLIENT_CREATION` operation (upsert semantics). This endpoint is
   * preserved **exclusively** for Backoffice administrative use and manual
   * overrides from the web interface.
   */
  @Patch(':id')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.CLIENTS, entityType: 'Client' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateClientSchema)) dto: UpdateClientDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientsService.update(id, dto, user.id);
  }

  @Post(':id/consent')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.CLIENTS, entityType: 'Client' })
  async registerConsent(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RegisterConsentSchema)) dto: RegisterConsentDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientsService.registerConsent(id, dto, user.id);
  }

  @Patch(':id/classification')
  @Roles(RoleType.ADMIN)
  @Auditable({ action: AuditAction.UPDATE, module: SystemModule.CLIENTS, entityType: 'Client' })
  async setClassification(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetClassificationSchema)) dto: SetClassificationDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientsService.setClassification(id, dto, user.id);
  }

  @Post(':id/data-subject-requests')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.APPROVE, module: SystemModule.CLIENTS, entityType: 'Client' })
  async requestDataSubjectAction(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RequestDataSubjectActionSchema)) dto: RequestDataSubjectActionDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientsService.requestDataSubjectAction(id, dto, user.id);
  }

  @Post(':id/data-subject-requests/resolve')
  @Roles(RoleType.ADMIN)
  @HttpCode(200)
  @Auditable({ action: AuditAction.APPROVE, module: SystemModule.CLIENTS, entityType: 'Client' })
  async resolveDataSubjectRequest(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResolveDataSubjectRequestSchema)) dto: ResolveDataSubjectRequestDto,
    @CurrentUser() user: User,
  ): Promise<any> {
    return this.clientsService.resolveDataSubjectRequest(id, dto, user.id);
  }
}
