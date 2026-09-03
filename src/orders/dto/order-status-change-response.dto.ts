import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '../../generated/prisma/enums';

interface OrderStatusChangeEntity {
  id: string;
  status: OrderStatus;
  changedBy: string | null;
  createdAt: Date;
}

export class OrderStatusChangeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description:
      'Null when the transition was triggered by a webhook rather than a person.',
  })
  changedBy!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static fromEntity(
    change: OrderStatusChangeEntity,
  ): OrderStatusChangeResponseDto {
    const dto = new OrderStatusChangeResponseDto();
    dto.id = change.id;
    dto.status = change.status;
    dto.changedBy = change.changedBy;
    dto.createdAt = change.createdAt;
    return dto;
  }
}
