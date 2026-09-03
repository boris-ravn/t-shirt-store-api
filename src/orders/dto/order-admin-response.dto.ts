import { ApiProperty } from '@nestjs/swagger';
import {
  assignOrderFields,
  OrderEntity,
  OrderResponseDto,
} from './order-response.dto';

interface OrderAdminUserEntity {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

interface OrderAdminPromoCodeEntity {
  id: string;
  code: string;
}

export interface OrderAdminEntity extends OrderEntity {
  user: OrderAdminUserEntity;
  promoCode: OrderAdminPromoCodeEntity | null;
}

class OrderAdminUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

class OrderAdminPromoCodeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  code!: string;
}

// A subclass, unlike ProductAdminResponseDto — safe only because no field
// changes type between the two (ProductAdminResponseDto's `skus` does).
// `promoCode` is joined through promoCodeId, correct only because
// PromoCode.code is immutable after creation.
export class OrderAdminResponseDto extends OrderResponseDto {
  @ApiProperty({ type: OrderAdminUserResponseDto })
  user!: OrderAdminUserResponseDto;

  @ApiProperty({ type: OrderAdminPromoCodeResponseDto, nullable: true })
  promoCode!: OrderAdminPromoCodeResponseDto | null;

  static fromEntity(order: OrderAdminEntity): OrderAdminResponseDto {
    const dto = new OrderAdminResponseDto();
    assignOrderFields(dto, order);
    dto.user = order.user;
    dto.promoCode = order.promoCode;
    return dto;
  }
}
