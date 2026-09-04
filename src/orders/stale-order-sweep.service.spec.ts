import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { StaleOrderSweepService } from './stale-order-sweep.service';

describe('StaleOrderSweepService', () => {
  let service: StaleOrderSweepService;
  let prisma: { order: { findMany: jest.Mock } };
  let ordersService: { releaseStalePendingOrder: jest.Mock };
  let configService: { getOrThrow: jest.Mock };

  beforeEach(async () => {
    prisma = { order: { findMany: jest.fn() } };
    ordersService = { releaseStalePendingOrder: jest.fn() };
    configService = { getOrThrow: jest.fn().mockReturnValue(30) };

    const module = await Test.createTestingModule({
      providers: [
        StaleOrderSweepService,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(StaleOrderSweepService);
  });

  it('queries pending orders older than STALE_ORDER_MAX_AGE_MINUTES', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.sweep();

    // TODO(testing agent): assert prisma.order.findMany was called with
    // { where: { status: OrderStatus.pending, createdAt: { lt: <a Date
    // roughly 30 minutes before now, per the mocked config value> } },
    // select: { id: true } } — use a fake timer or an approximate Date
    // comparison, not an exact Date.now() match.
  });

  it('cancels each matched order through OrdersService.releaseStalePendingOrder', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1' },
      { id: 'order-2' },
    ]);
    ordersService.releaseStalePendingOrder.mockResolvedValue(true);

    await service.sweep();

    // TODO(testing agent): assert ordersService.releaseStalePendingOrder was
    // called exactly twice, once with 'order-1' and once with 'order-2' — a
    // sweep calls the shared cancellation path per order, it doesn't
    // re-implement the stock/promo release itself.
  });

  it('is a no-op when no order is stale', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.sweep();

    // TODO(testing agent): assert ordersService.releaseStalePendingOrder was
    // NOT called.
  });
});
