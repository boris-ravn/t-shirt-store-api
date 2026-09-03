import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ProductListResponseDto } from '../catalog/products/dto/product-list-response.dto';
import { CheckPolicies } from '../casl/check-policies.decorator';
import { PoliciesGuard } from '../casl/policies.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { LikesService } from './likes.service';

@ApiTags('likes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PoliciesGuard)
@Controller()
export class LikesController {
  constructor(private readonly likesService: LikesService) {}

  @Put('v1/products/:productId/like')
  @CheckPolicies((ability) => ability.can('manage', 'Like'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Like a product' })
  @ApiNoContentResponse()
  async like(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.likesService.like(user!.id, productId);
  }

  @Delete('v1/products/:productId/like')
  @CheckPolicies((ability) => ability.can('manage', 'Like'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlike a product' })
  @ApiNoContentResponse()
  async unlike(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.likesService.unlike(user!.id, productId);
  }

  @Get('v1/users/me/likes')
  @CheckPolicies((ability) => ability.can('manage', 'Like'))
  @ApiOperation({ summary: "List the caller's liked products" })
  @ApiOkResponse({ type: ProductListResponseDto })
  listLikedProducts(
    @CurrentUser() user: AuthenticatedUser | null,
    @Query() query: PaginationQueryDto,
  ): Promise<ProductListResponseDto> {
    return this.likesService.listLikedProducts(user!.id, query);
  }
}
