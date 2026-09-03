import { ApiProperty } from '@nestjs/swagger';
import { DiscountType } from '../../generated/prisma/enums';
import { MoneyDto } from '../../common/money/money.dto';

export class PercentageDiscountDto {
  @ApiProperty({ enum: ['percentage'] })
  type!: 'percentage';

  @ApiProperty({ minimum: 1, maximum: 100 })
  percent!: number;
}

export class FixedAmountDiscountDto {
  @ApiProperty({ enum: ['fixedAmount'] })
  type!: 'fixedAmount';

  @ApiProperty({ type: MoneyDto })
  amount!: MoneyDto;
}

export type DiscountDto = PercentageDiscountDto | FixedAmountDiscountDto;

export function discountFromEntity(
  discountType: DiscountType,
  discountValue: number,
): DiscountDto {
  if (discountType === DiscountType.percentage) {
    const dto = new PercentageDiscountDto();
    dto.type = 'percentage';
    dto.percent = discountValue;
    return dto;
  }
  const dto = new FixedAmountDiscountDto();
  dto.type = 'fixedAmount';
  dto.amount = MoneyDto.of(discountValue);
  return dto;
}
