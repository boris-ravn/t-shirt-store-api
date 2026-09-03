import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class CartEmptyException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'cart-empty',
      'Cart is empty',
      'The cart has no items.',
    );
  }
}
