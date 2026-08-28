import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt } from 'class-validator';
import { STORE_CURRENCY } from './store-currency.constant';

// `currency` must equal STORE_CURRENCY — a mismatch is a client bug worth
// rejecting, not silently ignoring.
export class MoneyRequestDto {
  @ApiProperty({ description: 'Minor units of `currency`.' })
  @IsInt()
  amount!: number;

  @ApiProperty({ pattern: '^[A-Z]{3}$' })
  @IsIn([STORE_CURRENCY])
  currency!: string;
}
