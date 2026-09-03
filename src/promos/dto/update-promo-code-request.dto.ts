import {
  ApiExtraModels,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MoneyRequestDto } from '../../common/money/money-request.dto';
import {
  DISCOUNT_DISCRIMINATOR_TYPE_OPTIONS,
  FixedAmountDiscountRequestDto,
  PercentageDiscountRequestDto,
} from './discount-request.dto';
import type { DiscountRequestDto } from './discount-request.dto';

@ApiExtraModels(PercentageDiscountRequestDto, FixedAmountDiscountRequestDto)
export class UpdatePromoCodeRequestDto {
  @ApiPropertyOptional({
    oneOf: [
      { $ref: getSchemaPath(PercentageDiscountRequestDto) },
      { $ref: getSchemaPath(FixedAmountDiscountRequestDto) },
    ],
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => Object, DISCOUNT_DISCRIMINATOR_TYPE_OPTIONS)
  discount?: DiscountRequestDto;

  // Distinguishes "omitted" (leave unchanged) from "null" (clear the
  // minimum) — @ValidateIf lets null skip validation instead of failing
  // ValidateNested, while still reaching the service as a real null.
  @ApiPropertyOptional({ type: MoneyRequestDto, nullable: true })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyRequestDto)
  minPurchaseAmount?: MoneyRequestDto | null;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
