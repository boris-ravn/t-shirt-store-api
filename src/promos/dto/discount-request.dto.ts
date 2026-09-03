import { ApiProperty } from '@nestjs/swagger';
import { Type, TypeOptions } from 'class-transformer';
import { IsIn, IsInt, Max, Min, ValidateNested } from 'class-validator';
import { MoneyRequestDto } from '../../common/money/money-request.dto';

export class PercentageDiscountRequestDto {
  @ApiProperty({ enum: ['percentage'] })
  @IsIn(['percentage'])
  type!: 'percentage';

  @ApiProperty({ minimum: 1, maximum: 100 })
  @IsInt()
  @Min(1)
  @Max(100)
  percent!: number;
}

export class FixedAmountDiscountRequestDto {
  @ApiProperty({ enum: ['fixedAmount'] })
  @IsIn(['fixedAmount'])
  type!: 'fixedAmount';

  @ApiProperty({ type: MoneyRequestDto })
  @ValidateNested()
  @Type(() => MoneyRequestDto)
  amount!: MoneyRequestDto;
}

export type DiscountRequestDto =
  PercentageDiscountRequestDto | FixedAmountDiscountRequestDto;

// class-transformer resolves the concrete subtype from `type` before
// class-validator runs, per its discriminator option (verified against the
// installed class-transformer's own type defs and README example).
export const DISCOUNT_DISCRIMINATOR_TYPE_OPTIONS: TypeOptions = {
  discriminator: {
    property: 'type',
    subTypes: [
      { name: 'percentage', value: PercentageDiscountRequestDto },
      { name: 'fixedAmount', value: FixedAmountDiscountRequestDto },
    ],
  },
  keepDiscriminatorProperty: true,
};
