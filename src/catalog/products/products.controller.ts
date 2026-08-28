import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CheckPolicies } from '../../casl/check-policies.decorator';
import { PoliciesGuard } from '../../casl/policies.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-user.interface';
import { CreateProductRequestDto } from './dto/create-product-request.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductAdminListResponseDto } from './dto/product-list-response.dto';
import { ProductAdminResponseDto } from './dto/product-admin-response.dto';
import { ProductListResponseDto } from './dto/product-list-response.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductRequestDto } from './dto/update-product-request.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiExtraModels(
  ProductResponseDto,
  ProductAdminResponseDto,
  ProductListResponseDto,
  ProductAdminListResponseDto,
)
@Controller('v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'List products',
    description:
      'A client sees active, non-deleted products; a manager sees ProductAdmin items with the manager-only `status` filter available.',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ProductListResponseDto) },
        { $ref: getSchemaPath(ProductAdminListResponseDto) },
      ],
    },
  })
  list(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<ProductListResponseDto | ProductAdminListResponseDto> {
    return this.productsService.list(query, user);
  }

  @Get(':productId')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Get a product by id',
    description:
      'A disabled product answers 404 for a client and 200 for a manager. A soft-deleted product answers 404 for everyone.',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(ProductResponseDto) },
        { $ref: getSchemaPath(ProductAdminResponseDto) },
      ],
    },
  })
  getById(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<ProductResponseDto | ProductAdminResponseDto> {
    return this.productsService.getById(productId, user);
  }

  @Post()
  @UseGuards(JwtAuthGuard, PoliciesGuard)
  @CheckPolicies((ability) => ability.can('manage', 'Product'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a product' })
  @ApiCreatedResponse({ type: ProductAdminResponseDto })
  create(
    @Body() dto: CreateProductRequestDto,
  ): Promise<ProductAdminResponseDto> {
    return this.productsService.create(dto);
  }

  @Patch(':productId')
  @UseGuards(JwtAuthGuard, PoliciesGuard)
  @CheckPolicies((ability) => ability.can('manage', 'Product'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a product' })
  @ApiOkResponse({ type: ProductAdminResponseDto })
  update(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductRequestDto,
  ): Promise<ProductAdminResponseDto> {
    return this.productsService.update(productId, dto);
  }

  @Delete(':productId')
  @UseGuards(JwtAuthGuard, PoliciesGuard)
  @CheckPolicies((ability) => ability.can('manage', 'Product'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a product' })
  @ApiNoContentResponse()
  async delete(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.productsService.delete(productId);
  }
}
