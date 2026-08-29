import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class EmailAlreadyRegisteredException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'email-already-registered',
      'Email already registered',
      'An account with this email already exists.',
    );
  }
}
