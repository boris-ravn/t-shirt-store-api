import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class InsufficientStockException extends AppException {
  constructor(skuId: string, requested: number, available: number) {
    super(
      HttpStatus.CONFLICT,
      'insufficient-stock',
      'Insufficient stock',
      'One or more items in the cart exceed the available stock.',
      { skuId, requested, available },
    );
  }
}
