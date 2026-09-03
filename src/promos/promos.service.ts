import { Injectable, NotFoundException } from '@nestjs/common';
import { CartService } from '../cart/cart.service';
import { CartEmptyException } from '../cart/exceptions/cart-empty.exception';
import { MoneyDto } from '../common/money/money.dto';
import { DiscountType } from '../generated/prisma/enums';
import { isUniqueConstraintViolation } from '../prisma/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePromoCodeRequestDto } from './dto/create-promo-code-request.dto';
import { DiscountRequestDto } from './dto/discount-request.dto';
import { ListPromoCodesQueryDto } from './dto/list-promo-codes-query.dto';
import { PromoCodeInvalidReason } from './dto/promo-code-validation-response.dto';
import { PromoCodeListResponseDto } from './dto/promo-code-list-response.dto';
import { PromoCodeResponseDto } from './dto/promo-code-response.dto';
import { PromoCodeValidationResponseDto } from './dto/promo-code-validation-response.dto';
import { UpdatePromoCodeRequestDto } from './dto/update-promo-code-request.dto';
import { PromoCodeTakenException } from './exceptions/promo-code-taken.exception';

@Injectable()
export class PromosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  async create(
    dto: CreatePromoCodeRequestDto,
    createdBy: string,
  ): Promise<PromoCodeResponseDto> {
    try {
      const promo = await this.prisma.promoCode.create({
        data: {
          code: dto.code.toUpperCase(),
          ...this.discountToColumns(dto.discount),
          minPurchaseAmount: dto.minPurchaseAmount?.amount ?? null,
          expiresAt: new Date(dto.expiresAt),
          usageLimit: dto.usageLimit,
          createdBy,
        },
      });
      return PromoCodeResponseDto.fromEntity(promo);
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      throw new PromoCodeTakenException();
    }
  }

  async update(
    id: string,
    dto: UpdatePromoCodeRequestDto,
  ): Promise<PromoCodeResponseDto> {
    await this.getEntityOrThrow(id);

    const promo = await this.prisma.promoCode.update({
      where: { id },
      data: {
        ...(dto.discount ? this.discountToColumns(dto.discount) : {}),
        ...(dto.minPurchaseAmount !== undefined
          ? { minPurchaseAmount: dto.minPurchaseAmount?.amount ?? null }
          : {}),
        ...(dto.expiresAt ? { expiresAt: new Date(dto.expiresAt) } : {}),
        usageLimit: dto.usageLimit,
        isActive: dto.isActive,
      },
    });
    return PromoCodeResponseDto.fromEntity(promo);
  }

  async list(query: ListPromoCodesQueryDto): Promise<PromoCodeListResponseDto> {
    const where = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.includeExpired ? {} : { expiresAt: { gt: new Date() } }),
    };

    const [promos, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.promoCode.count({ where }),
    ]);

    return {
      data: promos.map((promo) => PromoCodeResponseDto.fromEntity(promo)),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  async getById(id: string): Promise<PromoCodeResponseDto> {
    const promo = await this.getEntityOrThrow(id);
    return PromoCodeResponseDto.fromEntity(promo);
  }

  async validate(
    userId: string,
    code: string,
  ): Promise<PromoCodeValidationResponseDto> {
    const cart = await this.cartService.getOrCreate(userId);
    if (cart.items.length === 0) {
      throw new CartEmptyException();
    }
    const subtotal = cart.subtotal.amount;

    const promo = await this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });
    const reason = this.evaluate(promo, subtotal);

    if (reason) {
      return {
        valid: false,
        reason,
        discount: null,
        subtotal: MoneyDto.of(subtotal),
        total: MoneyDto.of(subtotal),
      };
    }

    // reason is null only when promo passed every check in evaluate(), so
    // it's guaranteed non-null here.
    const discountAmount = this.computeDiscount(promo!, subtotal);
    return {
      valid: true,
      reason: null,
      discount: MoneyDto.of(discountAmount),
      subtotal: MoneyDto.of(subtotal),
      total: MoneyDto.of(subtotal - discountAmount),
    };
  }

  private evaluate(
    promo: {
      isActive: boolean;
      expiresAt: Date;
      timesRedeemed: number;
      usageLimit: number;
      minPurchaseAmount: number | null;
    } | null,
    subtotal: number,
  ): PromoCodeInvalidReason | null {
    if (!promo || !promo.isActive) {
      return 'invalid';
    }
    if (promo.expiresAt <= new Date()) {
      return 'expired';
    }
    if (promo.timesRedeemed >= promo.usageLimit) {
      return 'exhausted';
    }
    if (
      promo.minPurchaseAmount !== null &&
      subtotal < promo.minPurchaseAmount
    ) {
      return 'minimum-not-met';
    }
    return null;
  }

  // Capped at subtotal so a large fixed-amount discount can never push
  // total below zero.
  private computeDiscount(
    promo: { discountType: DiscountType; discountValue: number },
    subtotal: number,
  ): number {
    if (promo.discountType === DiscountType.percentage) {
      return Math.round((subtotal * promo.discountValue) / 100);
    }
    return Math.min(promo.discountValue, subtotal);
  }

  private discountToColumns(discount: DiscountRequestDto): {
    discountType: DiscountType;
    discountValue: number;
  } {
    if (discount.type === 'percentage') {
      return {
        discountType: DiscountType.percentage,
        discountValue: discount.percent,
      };
    }
    return {
      discountType: DiscountType.fixed_amount,
      discountValue: discount.amount.amount,
    };
  }

  private async getEntityOrThrow(id: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!promo) {
      throw new NotFoundException();
    }
    return promo;
  }
}
