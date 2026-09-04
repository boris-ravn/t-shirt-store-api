import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Prisma } from '../generated/prisma/client';
import { LowStockService } from './low-stock.service';
import { STOCK_NOTIFICATIONS_QUEUE } from './notifications.constants';

describe('LowStockService', () => {
  let service: LowStockService;
  let tx: {
    lowStockEvent: { create: jest.Mock; updateMany: jest.Mock };
    like: { findMany: jest.Mock };
    stockNotification: { create: jest.Mock };
  };
  let queue: { addBulk: jest.Mock };

  const openEventConflict = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: {
        driverAdapterError: {
          cause: {
            constraint: { index: 'low_stock_events_product_id_open_key' },
          },
        },
      },
    },
  );

  beforeEach(async () => {
    tx = {
      lowStockEvent: { create: jest.fn(), updateMany: jest.fn() },
      like: { findMany: jest.fn() },
      stockNotification: { create: jest.fn() },
    };
    queue = { addBulk: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        LowStockService,
        { provide: getQueueToken(STOCK_NOTIFICATIONS_QUEUE), useValue: queue },
      ],
    }).compile();

    service = module.get(LowStockService);
  });

  describe('detectAndOpen', () => {
    it('does nothing when the resulting stock is above the threshold', async () => {
      const result = await service.detectAndOpen(
        tx as never,
        'product-1',
        'sku-1',
        4,
      );

      // TODO(testing agent): assert tx.lowStockEvent.create was NOT called;
      // assert result is [].
      void result;
    });

    it('opens an event and notifies likers who have not bought the product', async () => {
      tx.lowStockEvent.create.mockResolvedValue({ id: 'event-1' });
      tx.like.findMany.mockResolvedValue([
        { userId: 'liker-1' },
        { userId: 'liker-2' },
      ]);
      tx.stockNotification.create
        .mockResolvedValueOnce({ id: 'notification-1' })
        .mockResolvedValueOnce({ id: 'notification-2' });

      const result = await service.detectAndOpen(
        tx as never,
        'product-1',
        'sku-1',
        2,
      );

      // TODO(testing agent): assert tx.lowStockEvent.create was called with
      // { data: { productId: 'product-1', triggeredBySkuId: 'sku-1',
      // stockAtTrigger: 2 } }; assert tx.like.findMany's where clause
      // excludes users with a confirmed (not pending/cancelled) order
      // containing this product — see decisions.md for the exact shape;
      // assert result is ['notification-1', 'notification-2'].
      void result;
    });

    it('treats the partial-unique-index conflict as "someone else already opened it", not an error', async () => {
      tx.lowStockEvent.create.mockRejectedValue(openEventConflict);

      const result = await service.detectAndOpen(
        tx as never,
        'product-1',
        'sku-1',
        1,
      );

      // TODO(testing agent): assert tx.like.findMany was NOT called; assert
      // result is [].
      void result;
    });

    it('rethrows an unrelated database error', async () => {
      tx.lowStockEvent.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.detectAndOpen(tx as never, 'product-1', 'sku-1', 1),
      ).rejects.toThrow('db down');
    });
  });

  describe('resolveIfCrossedAbove', () => {
    it('does nothing when the resulting stock is still at or below the threshold', async () => {
      await service.resolveIfCrossedAbove(tx as never, 'product-1', 3);

      // TODO(testing agent): assert tx.lowStockEvent.updateMany was NOT
      // called.
    });

    it('resolves the open event once stock crosses back above the threshold', async () => {
      await service.resolveIfCrossedAbove(tx as never, 'product-1', 4);

      // TODO(testing agent): assert tx.lowStockEvent.updateMany was called
      // with { where: { productId: 'product-1', resolvedAt: null }, data:
      // { resolvedAt: expect.any(Date) } }.
    });
  });

  describe('enqueueNotifications', () => {
    it('is a no-op for an empty list', async () => {
      await service.enqueueNotifications([]);

      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('adds one job per notification id', async () => {
      await service.enqueueNotifications(['notification-1', 'notification-2']);

      // TODO(testing agent): assert queue.addBulk was called with jobs named
      // 'send' carrying { notificationId: 'notification-1' } and
      // { notificationId: 'notification-2' }, in order.
    });
  });
});
