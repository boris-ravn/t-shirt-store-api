import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';

export class SkuReservedException extends AppException {
  constructor(reservedQuantity: number) {
    super(
      HttpStatus.CONFLICT,
      'sku-reserved',
      'SKU has reserved stock',
      'This SKU has units reserved by pending orders and cannot be deleted.',
      { reservedQuantity },
    );
  }
}
