import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { STORE_CURRENCY } from '../common/money/store-currency.constant';
import { Prisma } from '../generated/prisma/client';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../generated/prisma/enums';
import { isUniqueConstraintViolation } from '../prisma/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../stripe/stripe.constants';

interface ShippingInfo {
  recipientName: string;
  phone: string | null;
  address: Stripe.Address;
}

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  constructEvent(
    rawBody: Buffer,
    signature: string,
    webhookSecret: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
  }

  // Stripe delivers at-least-once; the INSERT on the event's own id is the
  // idempotency gate — a P2002 here means this exact event was already
  // received, so it's skipped before any business logic runs.
  async handleEvent(event: Stripe.Event): Promise<void> {
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: {
          id: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return;
      }
      throw error;
    }

    try {
      await this.process(event);
      await this.prisma.stripeWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      // processedAt stays null — identifiable for manual retry
      // (docs/database/README.md §6). Stripe already got its 204.
      this.logger.error(
        `Failed to process Stripe event ${event.id} (${event.type})`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  private async process(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.fulfil(event.data.object);
        return;
      case 'checkout.session.completed':
        await this.directSale(event.data.object);
        return;
      default:
        return;
    }
  }

  private async fulfil(intent: Stripe.PaymentIntent): Promise<void> {
    const orderId = intent.metadata.orderId;
    if (!orderId) {
      throw new Error(
        `payment_intent.succeeded ${intent.id} carries no orderId metadata.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.pending },
        data: { status: OrderStatus.paid },
      });
      if (claimed.count === 0) {
        return;
      }

      const items = await tx.orderItem.findMany({
        where: { orderId },
        select: { skuId: true, quantity: true },
      });
      for (const item of items) {
        // No availability guard here (unlike Reserve/Direct sale) — Fulfil
        // converts a reservation Reserve already verified into a real sale
        // (docs/database/README.md §8).
        await tx.sku.update({
          where: { id: item.skuId },
          data: {
            stock: { decrement: item.quantity },
            reservedStock: { decrement: item.quantity },
          },
        });
      }

      await tx.payment.updateMany({
        where: {
          stripePaymentIntentId: intent.id,
          status: PaymentStatus.pending,
        },
        data: { status: PaymentStatus.succeeded },
      });

      if (intent.shipping?.address) {
        await this.writeShippingDetails(tx, orderId, {
          recipientName: intent.shipping.name ?? '',
          phone: intent.shipping.phone ?? null,
          address: intent.shipping.address,
        });
      }

      await tx.orderStatusHistory.create({
        data: { orderId, status: OrderStatus.paid, changedBy: null },
      });
    });
  }

  private async directSale(session: Stripe.Checkout.Session): Promise<void> {
    const orderId = session.client_reference_id;
    if (!orderId) {
      throw new Error(
        `checkout.session.completed ${session.id} carries no client_reference_id.`,
      );
    }

    // The webhook payload never carries the real purchased quantity — a
    // reused Payment Link lets the buyer adjust it on Stripe's page, so this
    // is the only authoritative source (decisions.md).
    const lineItems = await this.stripe.checkout.sessions.listLineItems(
      session.id,
    );
    const quantity = lineItems.data[0]?.quantity ?? 1;
    const amountTotal = session.amount_total ?? 0;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.pending },
        data: {
          status: OrderStatus.paid,
          subtotal: amountTotal,
          total: amountTotal,
        },
      });
      if (claimed.count === 0) {
        return;
      }

      const item = await tx.orderItem.findFirstOrThrow({ where: { orderId } });
      await tx.orderItem.update({ where: { id: item.id }, data: { quantity } });

      // 0 rows affected = the sale can't be honored from stock. The payment
      // already succeeded on Stripe's side, so this isn't unwound here — a
      // structural limitation of Payment Links, not a bug (README §9).
      await tx.$executeRaw`
        UPDATE skus SET stock = stock - ${quantity}, updated_at = now()
        WHERE id = ${item.skuId} AND stock - reserved_stock >= ${quantity}
      `;

      const sku = await tx.sku.findUniqueOrThrow({ where: { id: item.skuId } });
      if (sku.stock - sku.reservedStock <= 0) {
        await tx.paymentLink.updateMany({
          where: { skuId: item.skuId, deactivatedAt: null },
          data: { deactivatedAt: new Date() },
        });
      }

      const paymentLink =
        typeof session.payment_link === 'string'
          ? await tx.paymentLink.findUnique({
              where: { stripePaymentLinkId: session.payment_link },
            })
          : null;

      await tx.payment.create({
        data: {
          orderId,
          method: PaymentMethod.payment_link,
          paymentLinkId: paymentLink?.id,
          stripeCheckoutSessionId: session.id,
          amount: amountTotal,
          currency: session.currency ?? STORE_CURRENCY.toLowerCase(),
          status: PaymentStatus.succeeded,
        },
      });

      const shippingDetails = session.collected_information?.shipping_details;
      if (shippingDetails) {
        await this.writeShippingDetails(tx, orderId, {
          recipientName: shippingDetails.name,
          phone: session.customer_details?.phone ?? null,
          address: shippingDetails.address,
        });
      }

      await tx.orderStatusHistory.create({
        data: { orderId, status: OrderStatus.paid, changedBy: null },
      });
    });
  }

  private async writeShippingDetails(
    tx: Prisma.TransactionClient,
    orderId: string,
    info: ShippingInfo,
  ): Promise<void> {
    await tx.orderShippingDetails.create({
      data: {
        orderId,
        recipientName: info.recipientName,
        phone: info.phone,
        line1: info.address.line1 ?? '',
        line2: info.address.line2,
        city: info.address.city ?? '',
        state: info.address.state,
        postalCode: info.address.postal_code ?? '',
        country: info.address.country ?? '',
      },
    });
  }
}
