import { Injectable, NotFoundException } from '@nestjs/common';
import {
  isRecordNotFound,
  isUniqueConstraintViolation,
} from '../prisma/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { ImageUrlService } from '../storage/image-url.service';
import { AddCartItemRequestDto } from './dto/add-cart-item-request.dto';
import { CartResponseDto } from './dto/cart-response.dto';
import { UpdateCartItemRequestDto } from './dto/update-cart-item-request.dto';

const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      sku: {
        include: {
          product: {
            include: {
              images: { orderBy: { position: 'asc' as const }, take: 1 },
            },
          },
        },
      },
    },
  },
};

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imageUrlService: ImageUrlService,
  ) {}

  async getOrCreate(userId: string): Promise<CartResponseDto> {
    const cart = await this.findOrCreateCart(userId);
    return CartResponseDto.fromEntity(cart, (s3Key) =>
      this.imageUrlService.buildUrl(s3Key),
    );
  }

  async addItem(
    userId: string,
    dto: AddCartItemRequestDto,
  ): Promise<CartResponseDto> {
    const cart = await this.findOrCreateCart(userId);
    await this.assertSkuIsPurchasable(dto.skuId);

    await this.prisma.cartItem.upsert({
      where: { cartId_skuId: { cartId: cart.id, skuId: dto.skuId } },
      create: { cartId: cart.id, skuId: dto.skuId, quantity: dto.quantity },
      update: { quantity: { increment: dto.quantity } },
    });

    return this.getOrCreate(userId);
  }

  async updateItem(
    userId: string,
    cartItemId: string,
    dto: UpdateCartItemRequestDto,
  ): Promise<CartResponseDto> {
    await this.getOwnCartItemOrThrow(userId, cartItemId);

    try {
      await this.prisma.cartItem.update({
        where: { id: cartItemId },
        data: { quantity: dto.quantity },
      });
    } catch (error) {
      if (!isRecordNotFound(error)) {
        throw error;
      }
      throw new NotFoundException();
    }

    return this.getOrCreate(userId);
  }

  async removeItem(userId: string, cartItemId: string): Promise<void> {
    await this.getOwnCartItemOrThrow(userId, cartItemId);
    try {
      await this.prisma.cartItem.delete({ where: { id: cartItemId } });
    } catch (error) {
      if (!isRecordNotFound(error)) {
        throw error;
      }
      throw new NotFoundException();
    }
  }

  async clear(userId: string): Promise<void> {
    const cart = await this.findOrCreateCart(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }

  private async findOrCreateCart(userId: string) {
    const existing = await this.prisma.cart.findUnique({
      where: { userId },
      include: CART_INCLUDE,
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.cart.create({
        data: { userId },
        include: CART_INCLUDE,
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      // Lost a create-vs-create race on the unique userId — the winner's
      // row already exists, so read it instead of failing this request.
      return this.prisma.cart.findUniqueOrThrow({
        where: { userId },
        include: CART_INCLUDE,
      });
    }
  }

  // 404, not 403: another user's cart item existing is not disclosed.
  private async getOwnCartItemOrThrow(userId: string, cartItemId: string) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: { select: { userId: true } } },
    });
    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException();
    }
    return item;
  }

  private async assertSkuIsPurchasable(skuId: string): Promise<void> {
    const sku = await this.prisma.sku.findUnique({
      where: { id: skuId },
      include: { product: { select: { deletedAt: true } } },
    });
    if (!sku || sku.deletedAt || sku.product.deletedAt) {
      throw new NotFoundException();
    }
  }
}
