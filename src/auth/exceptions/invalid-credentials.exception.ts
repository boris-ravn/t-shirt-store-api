import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

// Thrown for both an unknown email and a wrong password — same exception,
// same message, so the response can't be used to enumerate registered
// emails.
export class InvalidCredentialsException extends AppException {
  constructor() {
    super(
      HttpStatus.UNAUTHORIZED,
      'invalid-credentials',
      'Invalid credentials',
      'Email or password is incorrect.',
    );
  }
}
