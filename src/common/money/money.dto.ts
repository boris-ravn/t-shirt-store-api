import { ApiProperty } from '@nestjs/swagger';
import { STORE_CURRENCY } from './store-currency.constant';

export class MoneyDto {
  @ApiProperty({ description: 'Minor units of `currency`.' })
  amount!: number;

  @ApiProperty({ pattern: '^[A-Z]{3}$' })
  currency!: string;

  static of(amountMinorUnits: number): MoneyDto {
    const dto = new MoneyDto();
    dto.amount = amountMinorUnits;
    dto.currency = STORE_CURRENCY;
    return dto;
  }
}
