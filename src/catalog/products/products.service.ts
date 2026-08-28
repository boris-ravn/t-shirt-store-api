import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { ProductStatus, UserRole } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { ImageUrlService } from '../../storage/image-url.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user.interface';
import { CreateProductRequestDto } from './dto/create-product-request.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductAdminListResponseDto } from './dto/product-list-response.dto';
import { ProductAdminResponseDto } from './dto/product-admin-response.dto';
import { ProductListResponseDto } from './dto/product-list-response.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductRequestDto } from './dto/update-product-request.dto';

const PRODUCT_INCLUDE = {
  images: true,
  skus: true,
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: typeof PRODUCT_INCLUDE;
}>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageUrlService: ImageUrlService,
  ) {}

  async list(
    query: ListProductsQueryDto,
    user: AuthenticatedUser | null,
  ): Promise<ProductListResponseDto | ProductAdminListResponseDto> {
    const isManager = user?.role === UserRole.manager;

    if (query.status && !isManager) {
      // `status` is manager-only (see docs/api/paths/products.yaml) — a
      // client passing it gets 403, not a silently-ignored filter.
      throw new ForbiddenException();
    }

    const where = this.buildWhere(query, isManager);
    const total = await this.prisma.product.count({ where });
    const products = await this.findProductsPage(where, query);

    if (isManager) {
      return {
        data: products.map((product) => this.toAdminDto(product)),
        meta: { total, limit: query.limit, offset: query.offset },
      };
    }

    return {
      data: products.map((product) => this.toClientDto(product)),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  async getById(
    id: string,
    user: AuthenticatedUser | null,
  ): Promise<ProductResponseDto | ProductAdminResponseDto> {
    const isManager = user?.role === UserRole.manager;
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });

    if (!product || product.deletedAt) {
      throw new NotFoundException();
    }
    if (!isManager && product.status === ProductStatus.disabled) {
      throw new NotFoundException();
    }

    return isManager ? this.toAdminDto(product) : this.toClientDto(product);
  }

  async create(dto: CreateProductRequestDto): Promise<ProductAdminResponseDto> {
    await this.assertCategoryExists(dto.categoryId);

    const product = await this.prisma.product.create({
      data: {
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
      },
      include: PRODUCT_INCLUDE,
    });

    return this.toAdminDto(product);
  }

  async update(
    id: string,
    dto: UpdateProductRequestDto,
  ): Promise<ProductAdminResponseDto> {
    await this.assertExists(id);
    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        categoryId: dto.categoryId,
        status: dto.status,
      },
      include: PRODUCT_INCLUDE,
    });

    return this.toAdminDto(product);
  }

  // Soft delete — idempotent 404 since a second call finds nothing left to
  // delete (already invisible everywhere).
  async delete(id: string): Promise<void> {
    await this.assertExists(id);
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async assertExists(id: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.deletedAt) {
      throw new NotFoundException();
    }
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException();
    }
  }

  private buildWhere(
    query: ListProductsQueryDto,
    isManager: boolean,
  ): Prisma.ProductWhereInput {
    return {
      deletedAt: null,
      ...(isManager
        ? query.status
          ? { status: query.status }
          : {}
        : { status: ProductStatus.active }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                description: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            skus: {
              some: {
                deletedAt: null,
                price: { gte: query.minPrice, lte: query.maxPrice },
              },
            },
          }
        : {}),
    };
  }

  // `sort=price`/`-price` can't be expressed as a plain Prisma `orderBy` on
  // a to-many relation — SkuOrderByRelationAggregateInput only supports
  // `_count` (verified against the generated client's own types), not
  // `_min`/`_max` on a scalar field. sku.groupBy DOES support ordering by
  // an aggregate, so it's used to get a page of ordered productIds first,
  // then hydrated with a second query — the "slower" cost the contract
  // already calls out for this sort mode and the price-range filter.
  private async findProductsPage(
    where: Prisma.ProductWhereInput,
    query: ListProductsQueryDto,
  ): Promise<ProductWithRelations[]> {
    if (query.sort !== 'price' && query.sort !== '-price') {
      return this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: { createdAt: query.sort === 'createdAt' ? 'asc' : 'desc' },
        skip: query.offset,
        take: query.limit,
      });
    }

    const direction = query.sort === 'price' ? 'asc' : 'desc';
    const grouped = await this.prisma.sku.groupBy({
      by: ['productId'],
      where: { deletedAt: null, product: where },
      _min: { price: true },
      orderBy: { _min: { price: direction } },
      skip: query.offset,
      take: query.limit,
    });

    const ids = grouped.map((row) => row.productId);
    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: PRODUCT_INCLUDE,
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));

    return ids
      .map((id) => rowsById.get(id))
      .filter((row): row is ProductWithRelations => row !== undefined);
  }

  private toClientDto(product: ProductWithRelations): ProductResponseDto {
    return ProductResponseDto.fromEntity(product, (s3Key) =>
      this.imageUrlService.buildUrl(s3Key),
    );
  }

  private toAdminDto(product: ProductWithRelations): ProductAdminResponseDto {
    return ProductAdminResponseDto.fromEntity(product, (s3Key) =>
      this.imageUrlService.buildUrl(s3Key),
    );
  }
}
