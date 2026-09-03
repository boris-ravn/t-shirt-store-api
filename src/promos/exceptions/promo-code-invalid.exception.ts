import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class PromoCodeInvalidException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'promo-code-invalid',
      'Promo code invalid',
      'This promo code does not exist or is not active.',
    );
  }
}
