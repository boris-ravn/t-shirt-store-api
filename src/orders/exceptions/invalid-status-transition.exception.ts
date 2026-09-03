import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { OrderStatus } from '../../generated/prisma/enums';

export class InvalidStatusTransitionException extends AppException {
  constructor(from: OrderStatus, to: OrderStatus, allowed: OrderStatus[]) {
    super(
      HttpStatus.CONFLICT,
      'invalid-status-transition',
      'Invalid order status transition',
      `Cannot move an order from ${from} to ${to}.`,
      { from, to, allowed },
    );
  }
}
