import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { OrderStatus } from '../../generated/prisma/enums';

const SORT_VALUES = ['createdAt', '-createdAt'] as const;
type SortValue = (typeof SORT_VALUES)[number];

// A single repeated query key (?status=paid) parses as a plain string, not
// a one-element array — normalized here so @IsArray() sees the same shape
// regardless of how many values were given.
function toArray({ value }: { value: unknown }): unknown {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus, isArray: true })
  @Transform(toArray)
  @IsOptional()
  @IsArray()
  @IsEnum(OrderStatus, { each: true })
  status?: OrderStatus[];

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Minor units of the store currency.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minTotal?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Minor units of the store currency.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxTotal?: number;

  @ApiPropertyOptional({
    enum: ['me'],
    description: 'Delivery person only. The only accepted value is `me`.',
  })
  @IsOptional()
  @IsIn(['me'])
  deliveredBy?: 'me';

  @ApiPropertyOptional({ enum: SORT_VALUES, default: '-createdAt' })
  @IsOptional()
  @IsIn(SORT_VALUES)
  sort: SortValue = '-createdAt';
}
