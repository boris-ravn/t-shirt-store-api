import { Injectable, NotFoundException } from '@nestjs/common';
import { LowStockService } from '../../notifications/low-stock.service';
import {
  isUniqueConstraintViolation,
  uniqueConstraintIndexName,
} from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { SkuAdminResponseDto } from './dto/sku-admin-response.dto';
import { CreateSkuRequestDto } from './dto/create-sku-request.dto';
import { RestockSkuRequestDto } from './dto/restock-sku-request.dto';
import { UpdateSkuRequestDto } from './dto/update-sku-request.dto';
import { DuplicateSkuException } from './exceptions/duplicate-sku.exception';
import { SkuReservedException } from './exceptions/sku-reserved.exception';

@Injectable()
export class SkusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lowStockService: LowStockService,
  ) {}

  async create(dto: CreateSkuRequestDto): Promise<SkuAdminResponseDto> {
    await this.assertProductExists(dto.productId);

    try {
      const sku = await this.prisma.sku.create({
        data: {
          productId: dto.productId,
          skuCode: dto.skuCode,
          size: dto.size,
          color: dto.color,
          price: dto.price.amount,
          stock: dto.stock,
        },
      });
      return SkuAdminResponseDto.fromEntity(sku);
    } catch (error) {
      this.throwAsDuplicateSku(error);
    }
  }

  async update(
    id: string,
    dto: UpdateSkuRequestDto,
  ): Promise<SkuAdminResponseDto> {
    await this.getActiveOrThrow(id);

    try {
      const sku = await this.prisma.sku.update({
        where: { id },
        data: {
          skuCode: dto.skuCode,
          size: dto.size,
          color: dto.color,
          price: dto.price?.amount,
        },
      });
      return SkuAdminResponseDto.fromEntity(sku);
    } catch (error) {
      this.throwAsDuplicateSku(error);
    }
  }

  // Soft delete, guarded: pending orders hold reserved units, and the
  // Release path (README §8) still needs the row's counters to stay
  // coherent — so a SKU with reservedStock > 0 can't be deleted yet.
  async delete(id: string): Promise<void> {
    const sku = await this.getActiveOrThrow(id);
    if (sku.reservedStock > 0) {
      throw new SkuReservedException(sku.reservedStock);
    }
    await this.prisma.sku.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // The only supported write to `stock` — a delta, not an absolute value
  // (see UpdateSkuRequestDto for why).
  async restock(
    id: string,
    dto: RestockSkuRequestDto,
  ): Promise<SkuAdminResponseDto> {
    await this.getActiveOrThrow(id);

    const sku = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.sku.update({
        where: { id },
        data: { stock: { increment: dto.quantity } },
      });
      await this.lowStockService.resolveIfCrossedAbove(
        tx,
        updated.productId,
        updated.stock,
      );
      return updated;
    });

    return SkuAdminResponseDto.fromEntity(sku);
  }

  // Also checks the parent product, not just the SKU's own deletedAt — a
  // SKU belonging to a soft-deleted product shouldn't be independently
  // manageable through /v1/skus/{id} once the product itself is gone.
  private async getActiveOrThrow(id: string) {
    const sku = await this.prisma.sku.findUnique({
      where: { id },
      include: { product: { select: { deletedAt: true } } },
    });
    if (!sku || sku.deletedAt || sku.product.deletedAt) {
      throw new NotFoundException();
    }
    return sku;
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException();
    }
  }

  // Which unique constraint fired is read off the Postgres index name
  // (skus_sku_code_key vs skus_product_id_size_color_key — see both in
  // the hand-written migration SQL) — Prisma's driver-adapter P2002 errors
  // don't carry a field-name array to check instead (see
  // uniqueConstraintIndexName's own comment).
  private throwAsDuplicateSku(error: unknown): never {
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }
    const index = uniqueConstraintIndexName(error);
    throw new DuplicateSkuException(
      index?.includes('sku_code') ? 'skuCode' : 'size,color',
    );
  }
}
