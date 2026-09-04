import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '../generated/prisma/enums';
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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('queries pending orders older than STALE_ORDER_MAX_AGE_MINUTES', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T12:00:00Z'));
    prisma.order.findMany.mockResolvedValue([]);

    await service.sweep();

    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: {
        status: OrderStatus.pending,
        createdAt: { lt: new Date('2026-01-01T11:30:00Z') },
      },
      select: { id: true },
    });
  });

  it('cancels each matched order through OrdersService.releaseStalePendingOrder', async () => {
    prisma.order.findMany.mockResolvedValue([
      { id: 'order-1' },
      { id: 'order-2' },
    ]);
    ordersService.releaseStalePendingOrder.mockResolvedValue(true);

    await service.sweep();

    expect(ordersService.releaseStalePendingOrder).toHaveBeenCalledTimes(2);
    expect(ordersService.releaseStalePendingOrder).toHaveBeenNthCalledWith(
      1,
      'order-1',
    );
    expect(ordersService.releaseStalePendingOrder).toHaveBeenNthCalledWith(
      2,
      'order-2',
    );
  });

  it('is a no-op when no order is stale', async () => {
    prisma.order.findMany.mockResolvedValue([]);

    await service.sweep();

    expect(ordersService.releaseStalePendingOrder).not.toHaveBeenCalled();
  });
});
