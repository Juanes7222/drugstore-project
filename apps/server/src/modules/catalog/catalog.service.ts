import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';

@Injectable()
export class CatalogService {
  constructor(private prisma: PrismaService) {}

  async findAllProducts(query: QueryProductDto): Promise<any> {
    throw new NotImplementedForPhaseException('catalog', 'findAllProducts');
  }

  async findProductById(id: string): Promise<any> {
    throw new NotImplementedForPhaseException('catalog', 'findProductById');
  }

  async createProduct(createDto: CreateProductDto): Promise<any> {
    throw new NotImplementedForPhaseException('catalog', 'createProduct');
  }

  async updateProduct(id: string, updateDto: UpdateProductDto): Promise<any> {
    throw new NotImplementedForPhaseException('catalog', 'updateProduct');
  }

  async findAllCategories(): Promise<any> {
    throw new NotImplementedForPhaseException('catalog', 'findAllCategories');
  }

  async findAllPharmaceuticalForms(): Promise<any> {
    throw new NotImplementedForPhaseException(
      'catalog',
      'findAllPharmaceuticalForms',
    );
  }

  async findAllTaxSchemes(): Promise<any> {
    throw new NotImplementedForPhaseException('catalog', 'findAllTaxSchemes');
  }
}
