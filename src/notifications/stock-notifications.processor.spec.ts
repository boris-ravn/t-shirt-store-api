import { Test } from '@nestjs/testing';
import { Job } from 'bullmq';
import { NotificationStatus } from '../generated/prisma/enums';
import { ImageUrlService } from '../storage/image-url.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockNotificationsProcessor } from './stock-notifications.processor';

describe('StockNotificationsProcessor', () => {
  let processor: StockNotificationsProcessor;
  let prisma: {
    stockNotification: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  };
  let mailService: { sendLowStockNotification: jest.Mock };
  let imageUrlService: { buildUrl: jest.Mock };

  const notification = {
    id: 'notification-1',
    user: { email: 'liker@example.com', firstName: 'Ada' },
    lowStockEvent: {
      product: {
        name: 'Classic Tee',
        images: [{ s3Key: 'products/product-1/front.jpg' }],
      },
    },
  };

  beforeEach(async () => {
    prisma = {
      stockNotification: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    };
    mailService = { sendLowStockNotification: jest.fn() };
    imageUrlService = { buildUrl: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        StockNotificationsProcessor,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
        { provide: ImageUrlService, useValue: imageUrlService },
      ],
    }).compile();

    processor = module.get(StockNotificationsProcessor);
  });

  it('sends the email with the product image and marks the notification sent', async () => {
    prisma.stockNotification.findUniqueOrThrow.mockResolvedValue(notification);
    imageUrlService.buildUrl.mockReturnValue(
      'http://localhost:9000/bucket/products/product-1/front.jpg',
    );

    await processor.process({
      data: { notificationId: 'notification-1' },
    } as Job<{ notificationId: string }>);

    expect(mailService.sendLowStockNotification).toHaveBeenCalledWith(
      'liker@example.com',
      'Ada',
      'Classic Tee',
      'http://localhost:9000/bucket/products/product-1/front.jpg',
    );
    expect(prisma.stockNotification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: {
        status: NotificationStatus.sent,
        sentAt: expect.any(Date) as Date,
      },
    });
  });

  it('sends no image url when the product has none', async () => {
    prisma.stockNotification.findUniqueOrThrow.mockResolvedValue({
      ...notification,
      lowStockEvent: { product: { name: 'Classic Tee', images: [] } },
    });

    await processor.process({
      data: { notificationId: 'notification-1' },
    } as Job<{ notificationId: string }>);

    expect(imageUrlService.buildUrl).not.toHaveBeenCalled();
    expect(mailService.sendLowStockNotification).toHaveBeenCalledWith(
      'liker@example.com',
      'Ada',
      'Classic Tee',
      undefined,
    );
  });

  it('marks the notification failed and rethrows when MailService fails', async () => {
    prisma.stockNotification.findUniqueOrThrow.mockResolvedValue(notification);
    mailService.sendLowStockNotification.mockRejectedValue(
      new Error('SMTP timeout'),
    );

    await expect(
      processor.process({
        data: { notificationId: 'notification-1' },
      } as Job<{ notificationId: string }>),
    ).rejects.toThrow('SMTP timeout');

    expect(prisma.stockNotification.update).toHaveBeenCalledWith({
      where: { id: 'notification-1' },
      data: {
        status: NotificationStatus.failed,
        errorMessage: 'SMTP timeout',
      },
    });
  });
});
