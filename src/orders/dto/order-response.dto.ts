import { ApiProperty } from '@nestjs/swagger';
import { MoneyDto } from '../../common/money/money.dto';
import { OrderStatus, PaymentMethod } from '../../generated/prisma/enums';
import { OrderItemResponseDto } from './order-item-response.dto';
import { OrderShippingDetailsResponseDto } from './order-shipping-details-response.dto';

interface OrderItemEntity {
  id: string;
  productId: string;
  skuId: string;
  productName: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
}

interface OrderShippingDetailsEntity {
  recipientName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
  createdAt: Date;
}

interface OrderPromoCodeEntity {
  id: string;
  code: string;
}

export interface OrderEntity {
  id: string;
  status: OrderStatus;
  items: OrderItemEntity[];
  subtotal: number;
  discountAmount: number;
  total: number;
  shippingDetails: OrderShippingDetailsEntity | null;
  createdAt: Date;
  updatedAt: Date;
  payments: { method: PaymentMethod }[];
  promoCode: OrderPromoCodeEntity | null;
}

export class OrderPromoCodeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items!: OrderItemResponseDto[];

  @ApiProperty({ type: MoneyDto })
  subtotal!: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  discountAmount!: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  total!: MoneyDto;

  @ApiProperty({
    type: OrderShippingDetailsResponseDto,
    nullable: true,
    description: 'Null on an unpaid order.',
  })
  shippingDetails!: OrderShippingDetailsResponseDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({
    enum: PaymentMethod,
    nullable: true,
    description: 'The method used to pay, once a payment has succeeded.',
  })
  paymentMethod!: PaymentMethod | null;

  @ApiProperty({ type: OrderPromoCodeResponseDto, nullable: true })
  promoCode!: OrderPromoCodeResponseDto | null;

  static fromEntity(order: OrderEntity): OrderResponseDto {
    const dto = new OrderResponseDto();
    assignOrderFields(dto, order);
    return dto;
  }
}

export function assignOrderFields<T extends OrderResponseDto>(
  dto: T,
  order: OrderEntity,
): void {
  dto.id = order.id;
  dto.status = order.status;
  dto.items = order.items.map((item) => OrderItemResponseDto.fromEntity(item));
  dto.subtotal = MoneyDto.of(order.subtotal);
  dto.discountAmount = MoneyDto.of(order.discountAmount);
  dto.total = MoneyDto.of(order.total);
  dto.shippingDetails = order.shippingDetails
    ? OrderShippingDetailsResponseDto.fromEntity(order.shippingDetails)
    : null;
  dto.createdAt = order.createdAt;
  dto.updatedAt = order.updatedAt;
  dto.paymentMethod = order.payments[0]?.method ?? null;
  dto.promoCode = order.promoCode
    ? { id: order.promoCode.id, code: order.promoCode.code }
    : null;
}
