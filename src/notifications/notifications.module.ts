import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { LowStockService } from './low-stock.service';
import { STOCK_NOTIFICATIONS_QUEUE } from './notifications.constants';
import { StockNotificationsProcessor } from './stock-notifications.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: STOCK_NOTIFICATIONS_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
    MailModule,
    StorageModule,
  ],
  providers: [LowStockService, StockNotificationsProcessor],
  exports: [LowStockService],
})
export class NotificationsModule {}
