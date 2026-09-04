import { Module } from '@nestjs/common';
import { StripeModule } from '../stripe/stripe.module';
import { CheckoutController } from './checkout.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeWebhookService } from './stripe-webhook.service';

@Module({
  imports: [StripeModule],
  controllers: [
    PaymentsController,
    CheckoutController,
    StripeWebhookController,
  ],
  providers: [PaymentsService, StripeWebhookService],
})
export class PaymentsModule {}
