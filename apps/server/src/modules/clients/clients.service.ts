import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma, DataSubjectRequestStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { RegisterConsentDto } from './dto/register-consent.dto';
import { SetClassificationDto } from './dto/set-classification.dto';
import { RequestDataSubjectActionDto } from './dto/request-data-subject-action.dto';
import { ResolveDataSubjectRequestDto } from './dto/resolve-data-subject-request.dto';
import { QueryClientDto } from './dto/query-client.dto';
import { DuplicateClientIdentificationException } from './exceptions/duplicate-client-identification.exception';
import { DataSubjectRequestAlreadyPendingException } from './exceptions/data-subject-request-already-pending.exception';
import { NoPendingDataSubjectRequestException } from './exceptions/no-pending-data-subject-request.exception';
import { ClientNotFoundException } from './exceptions/client-not-found.exception';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateClientDto, userId: string): Promise<any> {
    try {
      return await this.prisma.client.create({
        data: {
          id: crypto.randomUUID(),
          ...dto,
          createdById: userId,
        },
      });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        throw new DuplicateClientIdentificationException(dto.identificationType, dto.identificationNumber);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateClientDto, userId: string): Promise<any> {
    await this.findById(id);
    try {
      return await this.prisma.client.update({
        where: { id },
        data: { ...dto, updatedById: userId },
      });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2002') {
        throw new DuplicateClientIdentificationException(dto.identificationType || '', dto.identificationNumber || '');
      }
      throw error;
    }
  }

  async registerConsent(id: string, dto: RegisterConsentDto, userId: string): Promise<any> {
    await this.findById(id);
    return this.prisma.client.update({
      where: { id },
      data: {
        consentVersion: dto.consentVersion,
        consentScope: dto.consentScope,
        consentGivenAt: new Date(),
        updatedById: userId,
      },
    });
  }

  async setClassification(id: string, dto: SetClassificationDto, userId: string): Promise<any> {
    await this.findById(id);
    return this.prisma.client.update({
      where: { id },
      data: {
        classificationId: dto.classificationId,
        updatedById: userId,
      },
    });
  }

  async requestDataSubjectAction(id: string, dto: RequestDataSubjectActionDto, userId: string): Promise<any> {
    const client = await this.findById(id);
    if (client.dataSubjectRequestStatus === 'PENDING_RECTIFICATION' || client.dataSubjectRequestStatus === 'PENDING_ERASURE') {
      throw new DataSubjectRequestAlreadyPendingException(id);
    }
    return this.prisma.client.update({
      where: { id },
      data: {
        dataSubjectRequestStatus: dto.requestType === 'RECTIFICATION' ? 'PENDING_RECTIFICATION' : 'PENDING_ERASURE',
        dataSubjectRequestAt: new Date(),
        updatedById: userId,
      },
    });
  }

  async resolveDataSubjectRequest(id: string, dto: ResolveDataSubjectRequestDto, userId: string): Promise<any> {
    const client = await this.findById(id);
    const isPendingRectification = client.dataSubjectRequestStatus === 'PENDING_RECTIFICATION';
    const isPendingErasure = client.dataSubjectRequestStatus === 'PENDING_ERASURE';
    if (!isPendingRectification && !isPendingErasure) {
      throw new NoPendingDataSubjectRequestException(id);
    }

    const newStatus = dto.resolution === 'REJECT' ? 'REJECTED' : (isPendingRectification ? 'RECTIFIED' : 'ERASURED');
    
    if (dto.resolution === 'APPROVE' && isPendingErasure) {
      return this.anonymizeClient(id, newStatus, userId);
    }

    return this.prisma.client.update({
      where: { id },
      data: { dataSubjectRequestStatus: newStatus, updatedById: userId },
    });
  }

  // Erasure is implemented as anonymization to preserve historical Sale records.
  // The Sale model keeps its own immutable snapshot of client data at the time of purchase,
  // allowing us to safely overwrite the Client row without corrupting past transactions.
  private async anonymizeClient(id: string, status: DataSubjectRequestStatus, userId: string): Promise<any> {
    return this.prisma.client.update({
      where: { id },
      data: {
        fullName: 'ANONYMIZED',
        email: null,
        phone: null,
        address: null,
        municipality: null,
        department: null,
        isActive: false,
        dataSubjectRequestStatus: status,
        updatedById: userId,
      },
    });
  }

  async findById(id: string): Promise<any> {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new ClientNotFoundException(id);
    return client;
  }

  async findAll(query: QueryClientDto): Promise<any> {
    return this.prisma.client.findMany();
  }

  async findAllClassifications(): Promise<any> {
    return this.prisma.clientClassification.findMany();
  }
}
