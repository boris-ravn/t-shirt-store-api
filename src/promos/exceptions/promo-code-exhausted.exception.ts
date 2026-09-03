import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class PromoCodeExhaustedException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'promo-code-exhausted',
      'Promo code exhausted',
      'This promo code has reached its usage limit.',
    );
  }
}
