import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { MoneyDto } from '../../common/money/money.dto';
import { DiscountType } from '../../generated/prisma/enums';
import {
  FixedAmountDiscountDto,
  PercentageDiscountDto,
  discountFromEntity,
} from './discount-response.dto';
import type { DiscountDto } from './discount-response.dto';

interface PromoCodeEntity {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minPurchaseAmount: number | null;
  expiresAt: Date;
  usageLimit: number;
  timesRedeemed: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@ApiExtraModels(PercentageDiscountDto, FixedAmountDiscountDto)
export class PromoCodeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Normalised to uppercase on write.' })
  code!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(PercentageDiscountDto) },
      { $ref: getSchemaPath(FixedAmountDiscountDto) },
    ],
  })
  discount!: DiscountDto;

  @ApiProperty({ type: MoneyDto, nullable: true })
  minPurchaseAmount!: MoneyDto | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;

  @ApiProperty({ minimum: 1 })
  usageLimit!: number;

  @ApiProperty({ minimum: 0 })
  timesRedeemed!: number;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static fromEntity(promo: PromoCodeEntity): PromoCodeResponseDto {
    const dto = new PromoCodeResponseDto();
    dto.id = promo.id;
    dto.code = promo.code;
    dto.discount = discountFromEntity(promo.discountType, promo.discountValue);
    dto.minPurchaseAmount =
      promo.minPurchaseAmount === null
        ? null
        : MoneyDto.of(promo.minPurchaseAmount);
    dto.expiresAt = promo.expiresAt;
    dto.usageLimit = promo.usageLimit;
    dto.timesRedeemed = promo.timesRedeemed;
    dto.isActive = promo.isActive;
    dto.createdAt = promo.createdAt;
    dto.updatedAt = promo.updatedAt;
    return dto;
  }
}
