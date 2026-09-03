import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
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

// code is normalized to uppercase on write, in the service.
@ApiExtraModels(PercentageDiscountRequestDto, FixedAmountDiscountRequestDto)
export class CreatePromoCodeRequestDto {
  @ApiProperty()
  @IsString()
  code!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(PercentageDiscountRequestDto) },
      { $ref: getSchemaPath(FixedAmountDiscountRequestDto) },
    ],
  })
  @ValidateNested()
  @Type(() => Object, DISCOUNT_DISCRIMINATOR_TYPE_OPTIONS)
  discount!: DiscountRequestDto;

  @ApiProperty({ type: MoneyRequestDto, required: false, nullable: true })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyRequestDto)
  minPurchaseAmount?: MoneyRequestDto | null;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  expiresAt!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  usageLimit!: number;
}
