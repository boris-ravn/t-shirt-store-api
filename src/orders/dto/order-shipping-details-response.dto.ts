import { ApiProperty } from '@nestjs/swagger';

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

export class OrderShippingDetailsResponseDto {
  @ApiProperty()
  recipientName!: string;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty()
  line1!: string;

  @ApiProperty({ type: String, nullable: true })
  line2!: string | null;

  @ApiProperty()
  city!: string;

  @ApiProperty({ type: String, nullable: true })
  state!: string | null;

  @ApiProperty()
  postalCode!: string;

  @ApiProperty({ pattern: '^[A-Z]{2}$' })
  country!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static fromEntity(
    details: OrderShippingDetailsEntity,
  ): OrderShippingDetailsResponseDto {
    const dto = new OrderShippingDetailsResponseDto();
    dto.recipientName = details.recipientName;
    dto.phone = details.phone;
    dto.line1 = details.line1;
    dto.line2 = details.line2;
    dto.city = details.city;
    dto.state = details.state;
    dto.postalCode = details.postalCode;
    dto.country = details.country;
    dto.createdAt = details.createdAt;
    return dto;
  }
}
