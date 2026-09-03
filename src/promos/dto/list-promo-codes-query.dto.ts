import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// class-transformer's @Type(() => Boolean) calls Boolean(value), so a query
// string "false" would coerce to true (any non-empty string is truthy) —
// verified against TransformOperationExecutor. Parsed explicitly instead.
function parseBooleanQueryParam({ value }: { value: unknown }): unknown {
  if (value === undefined) {
    return undefined;
  }
  return value === true || value === 'true';
}

export class ListPromoCodesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @Transform(parseBooleanQueryParam)
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @Transform(parseBooleanQueryParam)
  @IsOptional()
  @IsBoolean()
  includeExpired: boolean = false;
}
