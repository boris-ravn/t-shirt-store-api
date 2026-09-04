import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OrderStatus } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { isUniqueConstraintViolation } from '../prisma/prisma-error.util';
import {
  LOW_STOCK_THRESHOLD,
  STOCK_NOTIFICATIONS_QUEUE,
} from './notifications.constants';

@Injectable()
export class LowStockService {
  constructor(
    @InjectQueue(STOCK_NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async detectAndOpen(
    tx: Prisma.TransactionClient,
    productId: string,
    triggeredBySkuId: string,
    newStock: number,
  ): Promise<string[]> {
    if (newStock > LOW_STOCK_THRESHOLD) {
      return [];
    }

    let eventId: string;
    try {
      const event = await tx.lowStockEvent.create({
        data: { productId, triggeredBySkuId, stockAtTrigger: newStock },
      });
      eventId = event.id;
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      return [];
    }

    const recipients = await tx.like.findMany({
      where: {
        productId,
        user: {
          orders: {
            none: {
              status: { notIn: [OrderStatus.pending, OrderStatus.cancelled] },
              items: { some: { productId } },
            },
          },
        },
      },
      select: { userId: true },
    });

    const notificationIds: string[] = [];
    for (const recipient of recipients) {
      const notification = await tx.stockNotification.create({
        data: { lowStockEventId: eventId, userId: recipient.userId },
        select: { id: true },
      });
      notificationIds.push(notification.id);
    }
    return notificationIds;
  }

  async resolveIfCrossedAbove(
    tx: Prisma.TransactionClient,
    productId: string,
    newStock: number,
  ): Promise<void> {
    if (newStock <= LOW_STOCK_THRESHOLD) {
      return;
    }
    await tx.lowStockEvent.updateMany({
      where: { productId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  async enqueueNotifications(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) {
      return;
    }
    await this.queue.addBulk(
      notificationIds.map((notificationId) => ({
        name: 'send',
        data: { notificationId },
      })),
    );
  }
}
