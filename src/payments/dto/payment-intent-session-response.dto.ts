import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../common/money/money.dto';

export class PaymentIntentSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  paymentId!: string;

  @ApiProperty()
  clientSecret!: string;

  @ApiProperty({ type: MoneyDto })
  amount!: MoneyDto;

  static of(
    paymentId: string,
    clientSecret: string,
    amountMinorUnits: number,
  ): PaymentIntentSessionResponseDto {
    const dto = new PaymentIntentSessionResponseDto();
    dto.paymentId = paymentId;
    dto.clientSecret = clientSecret;
    dto.amount = MoneyDto.of(amountMinorUnits);
    return dto;
  }
}
