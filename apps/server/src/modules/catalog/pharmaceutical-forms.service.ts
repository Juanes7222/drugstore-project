import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreatePharmaceuticalFormDto } from './dto/create-pharmaceutical-form.dto';
import { UpdatePharmaceuticalFormDto } from './dto/update-pharmaceutical-form.dto';
import * as crypto from 'crypto';

@Injectable()
export class PharmaceuticalFormsService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<any> {
    return this.prisma.pharmaceuticalForm.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string): Promise<any> {
    return this.prisma.pharmaceuticalForm.findUnique({
      where: { id },
    });
  }

  async create(dto: CreatePharmaceuticalFormDto): Promise<any> {
    return this.prisma.pharmaceuticalForm.create({
      data: {
        id: this.generateId(),
        name: dto.name,
        sortOrder: dto.sortOrder || 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async update(id: string, dto: UpdatePharmaceuticalFormDto): Promise<any> {
    const updateData: any = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    updateData.updatedAt = new Date();

    return this.prisma.pharmaceuticalForm.update({
      where: { id },
      data: updateData,
    });
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
