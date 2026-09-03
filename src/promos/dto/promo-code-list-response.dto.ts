import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/pagination-meta.dto';
import { PromoCodeResponseDto } from './promo-code-response.dto';

export class PromoCodeListResponseDto {
  @ApiProperty({ type: [PromoCodeResponseDto] })
  data!: PromoCodeResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
