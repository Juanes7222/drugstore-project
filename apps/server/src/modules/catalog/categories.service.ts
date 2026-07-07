import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import * as crypto from 'crypto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<any> {
    return this.prisma.category.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string): Promise<any> {
    return this.prisma.category.findUnique({
      where: { id },
    });
  }

  async create(dto: CreateCategoryDto): Promise<any> {
    return this.prisma.category.create({
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

  async update(id: string, dto: UpdateCategoryDto): Promise<any> {
    const updateData: any = {};

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.sortOrder !== undefined) updateData.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;

    updateData.updatedAt = new Date();

    return this.prisma.category.update({
      where: { id },
      data: updateData,
    });
  }

  private generateId(): string {
    return crypto.randomUUID();
  }
}
