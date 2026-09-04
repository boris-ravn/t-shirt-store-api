import { ApiProperty } from '@nestjs/swagger';
import {
  OrderEntity,
  OrderResponseDto,
} from '../../orders/dto/order-response.dto';

export class PaymentLinkCheckoutResponseDto {
  @ApiProperty({ type: OrderResponseDto })
  order!: OrderResponseDto;

  @ApiProperty({ format: 'uri' })
  checkoutUrl!: string;

  static of(
    order: OrderEntity,
    checkoutUrl: string,
  ): PaymentLinkCheckoutResponseDto {
    const dto = new PaymentLinkCheckoutResponseDto();
    dto.order = OrderResponseDto.fromEntity(order);
    dto.checkoutUrl = checkoutUrl;
    return dto;
  }
}
