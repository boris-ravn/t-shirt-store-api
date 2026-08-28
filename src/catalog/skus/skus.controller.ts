import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../casl/check-policies.decorator';
import { PoliciesGuard } from '../../casl/policies.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateSkuRequestDto } from './dto/create-sku-request.dto';
import { RestockSkuRequestDto } from './dto/restock-sku-request.dto';
import { SkuAdminResponseDto } from './dto/sku-admin-response.dto';
import { UpdateSkuRequestDto } from './dto/update-sku-request.dto';
import { SkusService } from './skus.service';

// @CheckPolicies is applied per-method, not once at class level: PoliciesGuard
// reads context.getHandler() (method-level Reflector metadata) only — a
// class-level @CheckPolicies would silently never be read, and every route
// below would pass with no CASL check at all. (Caught live: a client
// request successfully created a SKU before this was fixed.)
@ApiTags('skus')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PoliciesGuard)
@Controller('v1/skus')
export class SkusController {
  constructor(private readonly skusService: SkusService) {}

  @Post()
  @CheckPolicies((ability) => ability.can('manage', 'Sku'))
  @ApiOperation({ summary: 'Create a SKU for a product' })
  @ApiCreatedResponse({ type: SkuAdminResponseDto })
  create(@Body() dto: CreateSkuRequestDto): Promise<SkuAdminResponseDto> {
    return this.skusService.create(dto);
  }

  @Patch(':skuId')
  @CheckPolicies((ability) => ability.can('manage', 'Sku'))
  @ApiOperation({ summary: 'Update a SKU' })
  @ApiOkResponse({ type: SkuAdminResponseDto })
  update(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: UpdateSkuRequestDto,
  ): Promise<SkuAdminResponseDto> {
    return this.skusService.update(skuId, dto);
  }

  @Delete(':skuId')
  @CheckPolicies((ability) => ability.can('manage', 'Sku'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a SKU' })
  @ApiNoContentResponse()
  async delete(@Param('skuId', ParseUUIDPipe) skuId: string): Promise<void> {
    await this.skusService.delete(skuId);
  }

  @Post(':skuId/restock')
  @CheckPolicies((ability) => ability.can('manage', 'Sku'))
  @ApiOperation({ summary: 'Add stock to a SKU' })
  @ApiOkResponse({ type: SkuAdminResponseDto })
  restock(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: RestockSkuRequestDto,
  ): Promise<SkuAdminResponseDto> {
    return this.skusService.restock(skuId, dto);
  }
}
