import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
import { CreatePaymentLinkCheckoutRequestDto } from './dto/create-payment-link-checkout-request.dto';
import { PaymentLinkCheckoutResponseDto } from './dto/payment-link-checkout-response.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PoliciesGuard)
@Controller('v1/checkout')
export class CheckoutController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('payment-link')
  @CheckPolicies((ability) => ability.can('create', 'Order'))
  @ApiOperation({ summary: 'Start a single-SKU payment-link checkout' })
  @ApiCreatedResponse({ type: PaymentLinkCheckoutResponseDto })
  createPaymentLinkCheckout(
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() dto: CreatePaymentLinkCheckoutRequestDto,
  ): Promise<PaymentLinkCheckoutResponseDto> {
    return this.paymentsService.createPaymentLinkCheckout(user!, dto);
  }
}
