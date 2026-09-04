import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

@Injectable()
export class StaleOrderSweepService {
  private readonly logger = new Logger(StaleOrderSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
    private readonly configService: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { waitForCompletion: true })
  async sweep(): Promise<void> {
    const maxAgeMinutes = this.configService.getOrThrow<number>(
      'STALE_ORDER_MAX_AGE_MINUTES',
    );
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);

    const staleOrders = await this.prisma.order.findMany({
      where: { status: OrderStatus.pending, createdAt: { lt: cutoff } },
      select: { id: true },
    });

    let cancelledCount = 0;
    for (const { id } of staleOrders) {
      const cancelled = await this.ordersService.releaseStalePendingOrder(id);
      if (cancelled) {
        cancelledCount += 1;
      }
    }

    if (cancelledCount > 0) {
      this.logger.log(`Cancelled ${cancelledCount} stale pending order(s).`);
    }
  }
}
