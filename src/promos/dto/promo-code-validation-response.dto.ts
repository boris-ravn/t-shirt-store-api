import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../common/money/money.dto';

export type PromoCodeInvalidReason =
  'invalid' | 'expired' | 'exhausted' | 'minimum-not-met';

export class PromoCodeValidationResponseDto {
  @ApiProperty()
  valid!: boolean;

  @ApiProperty({
    enum: ['invalid', 'expired', 'exhausted', 'minimum-not-met'],
    nullable: true,
  })
  reason!: PromoCodeInvalidReason | null;

  @ApiProperty({ type: MoneyDto, nullable: true })
  discount!: MoneyDto | null;

  @ApiProperty({ type: MoneyDto })
  subtotal!: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  total!: MoneyDto;
}
