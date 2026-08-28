import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt } from 'class-validator';
import { STORE_CURRENCY } from './store-currency.constant';

// Request-side counterpart of MoneyDto. `currency` must equal
// STORE_CURRENCY — the store is single-currency by design, so a mismatched
// value is a client bug worth rejecting (400 validation-error) rather than
// silently accepting or ignoring.
export class MoneyRequestDto {
  @ApiProperty({ description: 'Minor units of `currency`.' })
  @IsInt()
  amount!: number;

  @ApiProperty({ pattern: '^[A-Z]{3}$' })
  @IsIn([STORE_CURRENCY])
  currency!: string;
}
