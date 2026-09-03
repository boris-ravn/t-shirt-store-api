import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class PromoMinimumNotMetException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'promo-minimum-not-met',
      'Promo code minimum purchase not met',
      "The cart's subtotal does not meet this promo code's minimum purchase amount.",
    );
  }
}
