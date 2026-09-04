import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CheckPolicies } from '../casl/check-policies.decorator';
import { PoliciesGuard } from '../casl/policies.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';
import { PaymentIntentSessionResponseDto } from './dto/payment-intent-session-response.dto';
import { PaymentsService } from './payments.service';

// Reuses Order's own 'create' ability (client-only), not a new CASL subject
// — creating a payment intent is the continuation of checkout, and per-order
// ownership is a service-layer 404, same as every other Order endpoint.
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PoliciesGuard)
@Controller('v1/orders')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':orderId/payment-intent')
  @CheckPolicies((ability) => ability.can('create', 'Order'))
  @ApiOperation({ summary: 'Create a Stripe payment intent for an order' })
  @ApiCreatedResponse({ type: PaymentIntentSessionResponseDto })
  createPaymentIntent(
    @CurrentUser() user: AuthenticatedUser | null,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<PaymentIntentSessionResponseDto> {
    return this.paymentsService.createPaymentIntent(user!, orderId);
  }
}
