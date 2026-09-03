import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { OrderStatusChangeResponseDto } from './order-status-change-response.dto';

export class OrderStatusHistoryListResponseDto {
  @ApiProperty({ type: [OrderStatusChangeResponseDto] })
  data!: OrderStatusChangeResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
