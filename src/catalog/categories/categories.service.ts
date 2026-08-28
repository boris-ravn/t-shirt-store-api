import { Injectable, NotFoundException } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { isUniqueConstraintViolation } from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoryListResponseDto } from './dto/category-list-response.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryRequestDto } from './dto/create-category-request.dto';
import { UpdateCategoryRequestDto } from './dto/update-category-request.dto';
import { CategoryNameTakenException } from './exceptions/category-name-taken.exception';
import { CategoryNotEmptyException } from './exceptions/category-not-empty.exception';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQueryDto): Promise<CategoryListResponseDto> {
    const [categories, total] = await Promise.all([
      this.prisma.category.findMany({
        take: query.limit,
        skip: query.offset,
        orderBy: { name: 'asc' },
      }),
      this.prisma.category.count(),
    ]);

    return {
      data: categories.map((category) =>
        CategoryResponseDto.fromEntity(category),
      ),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  async getById(id: string): Promise<CategoryResponseDto> {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException();
    }
    return CategoryResponseDto.fromEntity(category);
  }

  async create(dto: CreateCategoryRequestDto): Promise<CategoryResponseDto> {
    try {
      const category = await this.prisma.category.create({
        data: { name: dto.name, slug: dto.slug },
      });
      return CategoryResponseDto.fromEntity(category);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new CategoryNameTakenException();
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateCategoryRequestDto,
  ): Promise<CategoryResponseDto> {
    await this.getById(id);

    try {
      const category = await this.prisma.category.update({
        where: { id },
        data: { name: dto.name, slug: dto.slug },
      });
      return CategoryResponseDto.fromEntity(category);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new CategoryNameTakenException();
      }
      throw error;
    }
  }

  // Hard delete (categories are never referenced by an order — products
  // are). category-not-empty is the deliberate contract for the products.category_id
  // NOT NULL FK conflict, checked up front rather than caught as a raw
  // constraint violation, since it needs the productCount extension member.
  async delete(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });

    if (!category) {
      throw new NotFoundException();
    }

    if (category._count.products > 0) {
      throw new CategoryNotEmptyException(category._count.products);
    }

    await this.prisma.category.delete({ where: { id } });
  }
}
