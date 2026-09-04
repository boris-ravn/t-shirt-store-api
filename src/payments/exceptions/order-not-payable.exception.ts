import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { OrderStatus } from '../../generated/prisma/enums';

export class OrderNotPayableException extends AppException {
  constructor(orderStatus: OrderStatus) {
    super(
      HttpStatus.CONFLICT,
      'order-not-payable',
      'Order is not payable',
      'The order is not pending, or already has a succeeded payment.',
      { orderStatus },
    );
  }
}
