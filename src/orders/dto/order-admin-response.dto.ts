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

export interface OrderAdminEntity extends OrderEntity {
  user: OrderAdminUserEntity;
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

export class OrderAdminResponseDto extends OrderResponseDto {
  @ApiProperty({ type: OrderAdminUserResponseDto })
  user!: OrderAdminUserResponseDto;

  static fromEntity(order: OrderAdminEntity): OrderAdminResponseDto {
    const dto = new OrderAdminResponseDto();
    assignOrderFields(dto, order);
    dto.user = order.user;
    return dto;
  }
}
