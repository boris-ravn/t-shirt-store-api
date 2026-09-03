import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CartService } from '../cart/cart.service';
import { CartEmptyException } from '../cart/exceptions/cart-empty.exception';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus, UserRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { PromoCodeExhaustedException } from '../promos/exceptions/promo-code-exhausted.exception';
import { PromoCodeExpiredException } from '../promos/exceptions/promo-code-expired.exception';
import { PromoCodeInvalidException } from '../promos/exceptions/promo-code-invalid.exception';
import { PromoMinimumNotMetException } from '../promos/exceptions/promo-minimum-not-met.exception';
import {
  computePromoDiscount,
  evaluatePromoCode,
} from '../promos/promo-evaluation.util';
import { PromoCodeInvalidReason } from '../promos/dto/promo-code-validation-response.dto';
import { CreateOrderRequestDto } from './dto/create-order-request.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderAdminResponseDto } from './dto/order-admin-response.dto';
import {
  OrderAdminListResponseDto,
  OrderListResponseDto,
} from './dto/order-list-response.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderStatusChangeResponseDto } from './dto/order-status-change-response.dto';
import { OrderStatusHistoryListResponseDto } from './dto/order-status-history-list-response.dto';
import { InsufficientStockException } from './exceptions/insufficient-stock.exception';
import { InvalidStatusTransitionException } from './exceptions/invalid-status-transition.exception';

const ORDER_INCLUDE = {
  items: true,
  shippingDetails: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
  promoCode: { select: { id: true, code: true } },
} satisfies Prisma.OrderInclude;

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof ORDER_INCLUDE;
}>;

const CANCELLABLE_FROM: OrderStatus[] = [
  OrderStatus.pending,
  OrderStatus.paid,
  OrderStatus.processing,
];
const RESTOCKABLE_FROM: OrderStatus[] = [
  OrderStatus.paid,
  OrderStatus.processing,
];

function throwForPromoReason(reason: PromoCodeInvalidReason): never {
  switch (reason) {
    case 'invalid':
      throw new PromoCodeInvalidException();
    case 'expired':
      throw new PromoCodeExpiredException();
    case 'exhausted':
      throw new PromoCodeExhaustedException();
    case 'minimum-not-met':
      throw new PromoMinimumNotMetException();
  }
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
  ) {}

  async createOrder(
    user: AuthenticatedUser,
    dto: CreateOrderRequestDto,
  ): Promise<OrderResponseDto> {
    const cart = await this.cartService.getOrCreate(user.id);
    if (cart.items.length === 0) {
      throw new CartEmptyException();
    }
    const subtotal = cart.subtotal.amount;

    const promo = dto.promoCode
      ? await this.prisma.promoCode.findUnique({
          where: { code: dto.promoCode.toUpperCase() },
        })
      : null;
    if (dto.promoCode) {
      const reason = evaluatePromoCode(promo, subtotal);
      if (reason) {
        throwForPromoReason(reason);
      }
    }
    const discountAmount = promo ? computePromoDiscount(promo, subtotal) : 0;
    const total = subtotal - discountAmount;

    const order = await this.prisma.$transaction(async (tx) => {
      for (const item of cart.items) {
        const affected = await tx.$executeRaw`
          UPDATE skus SET reserved_stock = reserved_stock + ${item.quantity}, updated_at = now()
          WHERE id = ${item.sku.id} AND stock - reserved_stock >= ${item.quantity}
        `;
        if (affected === 0) {
          const sku = await tx.sku.findUniqueOrThrow({
            where: { id: item.sku.id },
          });
          throw new InsufficientStockException(
            item.sku.id,
            item.quantity,
            sku.stock - sku.reservedStock,
          );
        }
      }

      if (promo) {
        const affected = await tx.$executeRaw`
          UPDATE promo_codes SET times_redeemed = times_redeemed + 1, updated_at = now()
          WHERE id = ${promo.id} AND is_active AND expires_at > now() AND times_redeemed < usage_limit
        `;
        if (affected === 0) {
          // The upfront evaluatePromoCode() call is a fast-path only — this
          // guard is the real check, so re-evaluate against a fresh read to
          // report the specific reason it lost the race.
          const fresh = await tx.promoCode.findUniqueOrThrow({
            where: { id: promo.id },
          });
          throwForPromoReason(
            evaluatePromoCode(fresh, subtotal) ?? 'exhausted',
          );
        }
      }

      const created = await tx.order.create({
        data: {
          userId: user.id,
          subtotal,
          promoCodeId: promo?.id,
          discountAmount,
          total,
          items: {
            create: cart.items.map((item) => ({
              skuId: item.sku.id,
              productId: item.product.id,
              quantity: item.quantity,
              unitPrice: item.sku.price.amount,
              productName: item.product.name,
              size: item.sku.size,
              color: item.sku.color,
            })),
          },
          statusHistory: {
            create: { status: OrderStatus.pending, changedBy: user.id },
          },
        },
        include: ORDER_INCLUDE,
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return created;
    });

    return OrderResponseDto.fromEntity(order);
  }

  async listOrders(
    user: AuthenticatedUser,
    query: ListOrdersQueryDto,
  ): Promise<OrderListResponseDto | OrderAdminListResponseDto> {
    if (query.deliveredBy === 'me' && user.role !== UserRole.delivery_person) {
      throw new ForbiddenException();
    }

    const visibility =
      query.deliveredBy === 'me'
        ? this.ownDeliveriesWhere(user.id)
        : this.visibilityWhere(user);

    const where: Prisma.OrderWhereInput = {
      AND: [visibility, this.listFiltersWhere(query)],
    };
    const orderBy = {
      createdAt:
        query.sort === 'createdAt' ? ('asc' as const) : ('desc' as const),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy,
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    const meta = { total, limit: query.limit, offset: query.offset };
    if (user.role === UserRole.manager) {
      return {
        data: orders.map((order) => OrderAdminResponseDto.fromEntity(order)),
        meta,
      };
    }
    return {
      data: orders.map((order) => OrderResponseDto.fromEntity(order)),
      meta,
    };
  }

  async getOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderResponseDto | OrderAdminResponseDto> {
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id: orderId }, this.visibilityWhere(user)] },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException();
    }
    return user.role === UserRole.manager
      ? OrderAdminResponseDto.fromEntity(order)
      : OrderResponseDto.fromEntity(order);
  }

  async cancelOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderResponseDto | OrderAdminResponseDto> {
    const ownershipWhere =
      user.role === UserRole.client ? { userId: user.id } : {};

    const order = await this.prisma.$transaction(async (tx) => {
      const releaseResult = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.pending, ...ownershipWhere },
        data: { status: OrderStatus.cancelled },
      });
      let isRestock = false;
      let claimed = releaseResult.count === 1;

      if (!claimed) {
        const restockResult = await tx.order.updateMany({
          where: {
            id: orderId,
            status: { in: RESTOCKABLE_FROM },
            ...ownershipWhere,
          },
          data: { status: OrderStatus.cancelled },
        });
        claimed = restockResult.count === 1;
        isRestock = claimed;
      }

      if (!claimed) {
        const existing = await tx.order.findFirst({
          where: { id: orderId, ...ownershipWhere },
        });
        if (!existing) {
          throw new NotFoundException();
        }
        throw new InvalidStatusTransitionException(
          existing.status,
          OrderStatus.cancelled,
          CANCELLABLE_FROM,
        );
      }

      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { skuId: true, quantity: true },
      });
      for (const item of items) {
        await tx.sku.update({
          where: { id: item.skuId },
          data: isRestock
            ? { stock: { increment: item.quantity } }
            : { reservedStock: { decrement: item.quantity } },
        });
      }

      const cancelled = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      if (cancelled.promoCodeId) {
        await tx.promoCode.update({
          where: { id: cancelled.promoCodeId },
          data: { timesRedeemed: { decrement: 1 } },
        });
      }

      await tx.orderStatusHistory.create({
        data: { orderId, status: OrderStatus.cancelled, changedBy: user.id },
      });

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: ORDER_INCLUDE,
      });
    });

    return user.role === UserRole.manager
      ? OrderAdminResponseDto.fromEntity(order)
      : OrderResponseDto.fromEntity(order);
  }

  async processOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderAdminResponseDto> {
    const order = await this.transition(
      orderId,
      OrderStatus.paid,
      OrderStatus.processing,
      user.id,
    );
    return OrderAdminResponseDto.fromEntity(order);
  }

  async shipOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderAdminResponseDto> {
    const order = await this.transition(
      orderId,
      OrderStatus.processing,
      OrderStatus.shipped,
      user.id,
    );
    return OrderAdminResponseDto.fromEntity(order);
  }

  async deliverOrder(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<OrderResponseDto> {
    const order = await this.transition(
      orderId,
      OrderStatus.shipped,
      OrderStatus.delivered,
      user.id,
    );
    return OrderResponseDto.fromEntity(order);
  }

  async listOrderStatusHistory(
    user: AuthenticatedUser,
    orderId: string,
    query: PaginationQueryDto,
  ): Promise<OrderStatusHistoryListResponseDto> {
    const visible = await this.prisma.order.findFirst({
      where: { AND: [{ id: orderId }, this.visibilityWhere(user)] },
      select: { id: true },
    });
    if (!visible) {
      throw new NotFoundException();
    }

    const [rows, total] = await Promise.all([
      this.prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        skip: query.offset,
        take: query.limit,
      }),
      this.prisma.orderStatusHistory.count({ where: { orderId } }),
    ]);

    return {
      data: rows.map((row) => OrderStatusChangeResponseDto.fromEntity(row)),
      meta: { total, limit: query.limit, offset: query.offset },
    };
  }

  // No transition is a plain update — every one is claimed via a guarded
  // updateMany (data written only if the current status still matches
  // `from`), same pattern as cancelOrder, so a concurrent double-call can't
  // both succeed.
  private async transition(
    orderId: string,
    from: OrderStatus,
    to: OrderStatus,
    changedBy: string,
  ): Promise<OrderWithRelations> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: orderId, status: from },
        data: { status: to },
      });
      if (result.count === 0) {
        const existing = await tx.order.findUnique({ where: { id: orderId } });
        if (!existing) {
          throw new NotFoundException();
        }
        throw new InvalidStatusTransitionException(existing.status, to, [from]);
      }

      await tx.orderStatusHistory.create({
        data: { orderId, status: to, changedBy },
      });

      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: ORDER_INCLUDE,
      });
    });
  }

  // Client: only their own orders. Manager: everything. Delivery person:
  // shipped orders (any), or orders they personally marked delivered —
  // narrowing to shipped alone would make their own delivery history
  // unreadable, since a delivered order is no longer shipped.
  private visibilityWhere(user: AuthenticatedUser): Prisma.OrderWhereInput {
    if (user.role === UserRole.manager) {
      return {};
    }
    if (user.role === UserRole.client) {
      return { userId: user.id };
    }
    return {
      OR: [{ status: OrderStatus.shipped }, this.ownDeliveriesWhere(user.id)],
    };
  }

  private ownDeliveriesWhere(deliveryPersonId: string): Prisma.OrderWhereInput {
    return {
      status: OrderStatus.delivered,
      statusHistory: {
        some: { changedBy: deliveryPersonId, status: OrderStatus.delivered },
      },
    };
  }

  private listFiltersWhere(query: ListOrdersQueryDto): Prisma.OrderWhereInput {
    return {
      ...(query.status ? { status: { in: query.status } } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom
                ? { gte: new Date(query.createdFrom) }
                : {}),
              ...(query.createdTo ? { lte: new Date(query.createdTo) } : {}),
            },
          }
        : {}),
      ...(query.minTotal !== undefined || query.maxTotal !== undefined
        ? {
            total: {
              ...(query.minTotal !== undefined ? { gte: query.minTotal } : {}),
              ...(query.maxTotal !== undefined ? { lte: query.maxTotal } : {}),
            },
          }
        : {}),
    };
  }
}
