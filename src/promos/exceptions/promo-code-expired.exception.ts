import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class PromoCodeExpiredException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'promo-code-expired',
      'Promo code expired',
      'This promo code has expired.',
    );
  }
}
