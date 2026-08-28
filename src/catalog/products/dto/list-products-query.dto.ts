import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ProductStatus } from '../../../generated/prisma/enums';

const SORT_VALUES = ['createdAt', '-createdAt', 'price', '-price'] as const;
type SortValue = (typeof SORT_VALUES)[number];

export class ListProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Matched against product name and description.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Minor units of the store currency.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description: 'Minor units of the store currency.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ enum: ProductStatus, description: 'Manager only.' })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ enum: SORT_VALUES, default: '-createdAt' })
  @IsOptional()
  @IsIn(SORT_VALUES)
  sort: SortValue = '-createdAt';
}
