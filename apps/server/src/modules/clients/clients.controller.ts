import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { QueryClientDto } from './dto/query-client.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { Auditable } from '@/common/decorators/auditable.decorator';
import { AuditAction, SystemModule, RoleType } from '@pharmacy/shared-types';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { ClientSchema } from '@pharmacy/shared-validation';

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAll(@Query() query: QueryClientDto): Promise<any> {
    return this.clientsService.findAll(query);
  }

  @Get(':id')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findById(@Param('id') id: string): Promise<any> {
    return this.clientsService.findById(id);
  }

  @Post()
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @HttpCode(201)
  @Auditable({
    action: AuditAction.CREATE,
    module: SystemModule.CLIENTS,
    entityType: 'Client',
  })
  async create(
    @Body(new ZodValidationPipe(ClientSchema))
    createDto: CreateClientDto,
  ): Promise<any> {
    return this.clientsService.create(createDto);
  }

  @Patch(':id')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  @Auditable({
    action: AuditAction.UPDATE,
    module: SystemModule.CLIENTS,
    entityType: 'Client',
  })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateClientDto,
  ): Promise<any> {
    return this.clientsService.update(id, updateDto);
  }

  @Get('classifications/all')
  @Roles(RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT, RoleType.ADMIN)
  async findAllClassifications(): Promise<any> {
    return this.clientsService.findAllClassifications();
  }
}
