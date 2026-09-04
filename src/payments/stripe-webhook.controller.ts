import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import Stripe from 'stripe';
import { StripeWebhookService } from './stripe-webhook.service';

// No JwtAuthGuard/PoliciesGuard — the contract sets `security: []` here,
// Stripe isn't a CASL-scoped actor. The Stripe-Signature header is this
// endpoint's entire authentication.
@ApiTags('payments')
@Controller('v1/webhooks')
export class StripeWebhookController {
  constructor(
    private readonly stripeWebhookService: StripeWebhookService,
    private readonly configService: ConfigService,
  ) {}

  @Post('stripe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Receive a Stripe webhook event' })
  @ApiHeader({ name: 'Stripe-Signature', required: true })
  @ApiNoContentResponse({
    description: 'Event received and, if verified, stored for processing.',
  })
  @ApiBadRequestResponse({
    description: 'The Stripe-Signature header did not verify.',
  })
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<void> {
    if (!req.rawBody) {
      throw new BadRequestException();
    }

    let event: Stripe.Event;
    try {
      event = this.stripeWebhookService.constructEvent(
        req.rawBody,
        signature,
        this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException();
    }

    await this.stripeWebhookService.handleEvent(event);
  }
}
