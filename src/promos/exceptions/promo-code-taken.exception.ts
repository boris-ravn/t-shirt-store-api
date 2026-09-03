import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class PromoCodeTakenException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'promo-code-taken',
      'Promo code already in use',
      'A promo code with this code already exists.',
    );
  }
}
