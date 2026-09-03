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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../casl/check-policies.decorator';
import { PoliciesGuard } from '../casl/policies.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { CartService } from './cart.service';
import { AddCartItemRequestDto } from './dto/add-cart-item-request.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { UpdateCartItemRequestDto } from './dto/update-cart-item-request.dto';

// @CheckPolicies is applied per-method, never at class level — a class-level
// decorator here would be read only as PoliciesGuard's fallback (decisions.md).
@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PoliciesGuard)
@Controller('v1/cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('manage', 'Cart'))
  @ApiOperation({ summary: "Get the caller's own cart" })
  @ApiOkResponse({ type: CartResponseDto })
  getCart(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<CartResponseDto> {
    // JwtAuthGuard above guarantees req.user is set.
    return this.cartService.getOrCreate(user!.id);
  }

  @Post('items')
  @CheckPolicies((ability) => ability.can('manage', 'Cart'))
  @ApiOperation({ summary: "Add an item to the caller's cart" })
  @ApiOkResponse({ type: CartResponseDto })
  addItem(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: AddCartItemRequestDto,
  ): Promise<CartResponseDto> {
    return this.cartService.addItem(user!.id, dto);
  }

  @Delete('items')
  @CheckPolicies((ability) => ability.can('manage', 'Cart'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove every item from the caller's cart" })
  @ApiNoContentResponse()
  async clearCart(
    @CurrentUser() user: AuthenticatedUser | null,
  ): Promise<void> {
    await this.cartService.clear(user!.id);
  }

  @Patch('items/:cartItemId')
  @CheckPolicies((ability) => ability.can('manage', 'Cart'))
  @ApiOperation({ summary: "Set a cart item's quantity" })
  @ApiOkResponse({ type: CartResponseDto })
  updateItem(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('cartItemId', ParseUUIDPipe) cartItemId: string,
    @Body() dto: UpdateCartItemRequestDto,
  ): Promise<CartResponseDto> {
    return this.cartService.updateItem(user!.id, cartItemId, dto);
  }

  @Delete('items/:cartItemId')
  @CheckPolicies((ability) => ability.can('manage', 'Cart'))
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove one item from the caller's cart" })
  @ApiNoContentResponse()
  async removeItem(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('cartItemId', ParseUUIDPipe) cartItemId: string,
  ): Promise<void> {
    await this.cartService.removeItem(user!.id, cartItemId);
  }
}
