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
import { PromoCodeListResponseDto } from './dto/promo-code-list-response.dto';
import { PromoCodeResponseDto } from './dto/promo-code-response.dto';
import { PromoCodeValidationResponseDto } from './dto/promo-code-validation-response.dto';
import { UpdatePromoCodeRequestDto } from './dto/update-promo-code-request.dto';
import { PromoCodeTakenException } from './exceptions/promo-code-taken.exception';
import {
  computePromoDiscount,
  evaluatePromoCode,
} from './promo-evaluation.util';

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
    const reason = evaluatePromoCode(promo, subtotal);

    if (reason) {
      return {
        valid: false,
        reason,
        discount: null,
        subtotal: MoneyDto.of(subtotal),
        total: MoneyDto.of(subtotal),
      };
    }

    // reason is null only when promo passed every check in
    // evaluatePromoCode(), so it's guaranteed non-null here.
    const discountAmount = computePromoDiscount(promo!, subtotal);
    return {
      valid: true,
      reason: null,
      discount: MoneyDto.of(discountAmount),
      subtotal: MoneyDto.of(subtotal),
      total: MoneyDto.of(subtotal - discountAmount),
    };
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
