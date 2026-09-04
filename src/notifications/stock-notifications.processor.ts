import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { NotificationStatus } from '../generated/prisma/enums';
import { ImageUrlService } from '../storage/image-url.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { STOCK_NOTIFICATIONS_QUEUE } from './notifications.constants';

interface SendJobData {
  notificationId: string;
}

@Processor(STOCK_NOTIFICATIONS_QUEUE)
export class StockNotificationsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly imageUrlService: ImageUrlService,
  ) {
    super();
  }

  async process(job: Job<SendJobData>): Promise<void> {
    const notification = await this.prisma.stockNotification.findUniqueOrThrow({
      where: { id: job.data.notificationId },
      include: {
        user: { select: { email: true, firstName: true } },
        lowStockEvent: {
          include: {
            product: {
              include: { images: { orderBy: { position: 'asc' }, take: 1 } },
            },
          },
        },
      },
    });

    const image = notification.lowStockEvent.product.images[0];
    const imageUrl = image
      ? this.imageUrlService.buildUrl(image.s3Key)
      : undefined;

    try {
      await this.mailService.sendLowStockNotification(
        notification.user.email,
        notification.user.firstName,
        notification.lowStockEvent.product.name,
        imageUrl,
      );
      await this.prisma.stockNotification.update({
        where: { id: notification.id },
        data: { status: NotificationStatus.sent, sentAt: new Date() },
      });
    } catch (error) {
      await this.prisma.stockNotification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.failed,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}
