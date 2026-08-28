import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({
    minimum: 0,
    description: 'Total number of items matching the query, across all pages.',
  })
  total!: number;

  @ApiProperty({
    minimum: 1,
    description: 'The `limit` that produced this page.',
  })
  limit!: number;

  @ApiProperty({
    minimum: 0,
    description: 'The `offset` that produced this page.',
  })
  offset!: number;
}
