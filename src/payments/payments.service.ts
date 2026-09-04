import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { STORE_CURRENCY } from '../common/money/store-currency.constant';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { OrderEntity } from '../orders/dto/order-response.dto';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { uniqueConstraintIndexName } from '../prisma/prisma-error.util';
import { PrismaService } from '../prisma/prisma.service';
import { STRIPE_CLIENT } from '../stripe/stripe.constants';
import { CreatePaymentLinkCheckoutRequestDto } from './dto/create-payment-link-checkout-request.dto';
import { PaymentIntentSessionResponseDto } from './dto/payment-intent-session-response.dto';
import { PaymentLinkCheckoutResponseDto } from './dto/payment-link-checkout-response.dto';
import { OrderNotPayableException } from './exceptions/order-not-payable.exception';

const ORDER_INCLUDE = {
  items: true,
  shippingDetails: true,
  promoCode: { select: { id: true, code: true } },
  payments: {
    where: { status: PaymentStatus.succeeded },
    select: { method: true },
  },
} satisfies Prisma.OrderInclude;

type SkuWithProduct = Prisma.SkuGetPayload<{ include: { product: true } }>;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  async createPaymentIntent(
    user: AuthenticatedUser,
    orderId: string,
  ): Promise<PaymentIntentSessionResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.userId !== user.id) {
      throw new NotFoundException();
    }

    const succeededPayment = await this.prisma.payment.findFirst({
      where: { orderId, status: PaymentStatus.succeeded },
    });
    if (order.status !== OrderStatus.pending || succeededPayment) {
      throw new OrderNotPayableException(order.status);
    }

    // Retry fast path — reuses an already-open intent (decisions.md).
    const existingPending = await this.prisma.payment.findFirst({
      where: {
        orderId,
        method: PaymentMethod.payment_intent,
        status: PaymentStatus.pending,
      },
    });
    if (existingPending) {
      return this.reusePaymentIntent(existingPending);
    }

    const currency = STORE_CURRENCY.toLowerCase();
    const intent = await this.stripe.paymentIntents.create({
      amount: order.total,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata: { orderId: order.id },
    });
    if (!intent.client_secret) {
      throw new Error(
        'Stripe returned no client_secret for the created payment intent.',
      );
    }

    try {
      const payment = await this.prisma.payment.create({
        data: {
          orderId: order.id,
          method: PaymentMethod.payment_intent,
          stripePaymentIntentId: intent.id,
          amount: order.total,
          currency,
        },
      });
      return PaymentIntentSessionResponseDto.of(
        payment.id,
        intent.client_secret,
        order.total,
      );
    } catch (error) {
      if (
        uniqueConstraintIndexName(error) !== 'payments_order_id_pending_key'
      ) {
        throw error;
      }
      // Lost the claim race — cancel and reuse the winner (decisions.md).
      await this.stripe.paymentIntents.cancel(intent.id).catch(() => {});
      const winner = await this.prisma.payment.findFirstOrThrow({
        where: {
          orderId: order.id,
          method: PaymentMethod.payment_intent,
          status: PaymentStatus.pending,
        },
      });
      return this.reusePaymentIntent(winner);
    }
  }

  private async reusePaymentIntent(payment: {
    id: string;
    amount: number;
    stripePaymentIntentId: string | null;
  }): Promise<PaymentIntentSessionResponseDto> {
    if (!payment.stripePaymentIntentId) {
      throw new Error(`Payment ${payment.id} has no stripePaymentIntentId.`);
    }
    const intent = await this.stripe.paymentIntents.retrieve(
      payment.stripePaymentIntentId,
    );
    if (!intent.client_secret) {
      throw new Error(
        'Stripe returned no client_secret for the retrieved payment intent.',
      );
    }
    return PaymentIntentSessionResponseDto.of(
      payment.id,
      intent.client_secret,
      payment.amount,
    );
  }

  async createPaymentLinkCheckout(
    user: AuthenticatedUser,
    dto: CreatePaymentLinkCheckoutRequestDto,
  ): Promise<PaymentLinkCheckoutResponseDto> {
    const sku = await this.prisma.sku.findUnique({
      where: { id: dto.skuId },
      include: { product: true },
    });
    if (!sku || sku.deletedAt || sku.product.deletedAt) {
      throw new NotFoundException();
    }

    // Provisional total; the webhook overwrites it once quantity is
    // confirmed (README §6/§8, decisions.md).
    const total = sku.price * dto.quantity;
    const order = (await this.prisma.order.create({
      data: {
        userId: user.id,
        subtotal: total,
        total,
        items: {
          create: {
            skuId: sku.id,
            productId: sku.productId,
            quantity: dto.quantity,
            unitPrice: sku.price,
            productName: sku.product.name,
            size: sku.size,
            color: sku.color,
          },
        },
        statusHistory: {
          create: { status: OrderStatus.pending, changedBy: user.id },
        },
      },
      include: ORDER_INCLUDE,
    })) as OrderEntity;

    const linkUrl = await this.getOrCreatePaymentLinkUrl(sku);
    const checkoutUrl = `${linkUrl}?client_reference_id=${order.id}`;

    return PaymentLinkCheckoutResponseDto.of(order, checkoutUrl);
  }

  private async getOrCreatePaymentLinkUrl(
    sku: SkuWithProduct,
  ): Promise<string> {
    const existing = await this.prisma.paymentLink.findFirst({
      where: { skuId: sku.id, deactivatedAt: null },
    });
    if (existing) {
      return this.retrievePaymentLinkUrl(existing.stripePaymentLinkId);
    }

    const currency = STORE_CURRENCY.toLowerCase();
    const price = await this.stripe.prices.create({
      currency,
      unit_amount: sku.price,
      product_data: { name: `${sku.product.name} (${sku.size}/${sku.color})` },
    });
    // adjustable_quantity: the real quantity is confirmed on Stripe's page,
    // not here (decisions.md).
    const paymentLink = await this.stripe.paymentLinks.create({
      line_items: [
        {
          price: price.id,
          quantity: 1,
          adjustable_quantity: { enabled: true, minimum: 1 },
        },
      ],
    });

    try {
      await this.prisma.paymentLink.create({
        data: {
          skuId: sku.id,
          stripePaymentLinkId: paymentLink.id,
          stripePriceId: price.id,
          unitAmount: sku.price,
        },
      });
      return paymentLink.url;
    } catch (error) {
      if (
        uniqueConstraintIndexName(error) !== 'payment_links_sku_id_active_key'
      ) {
        throw error;
      }
      // Lost the claim race — deactivate and reuse the winner (decisions.md).
      await this.stripe.paymentLinks
        .update(paymentLink.id, { active: false })
        .catch(() => {});
      const winner = await this.prisma.paymentLink.findFirstOrThrow({
        where: { skuId: sku.id, deactivatedAt: null },
      });
      return this.retrievePaymentLinkUrl(winner.stripePaymentLinkId);
    }
  }

  private async retrievePaymentLinkUrl(
    stripePaymentLinkId: string,
  ): Promise<string> {
    const link = await this.stripe.paymentLinks.retrieve(stripePaymentLinkId);
    return link.url;
  }
}
