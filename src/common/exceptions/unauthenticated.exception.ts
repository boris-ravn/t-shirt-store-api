import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';

export class UnauthenticatedException extends AppException {
  constructor() {
    super(
      HttpStatus.UNAUTHORIZED,
      'unauthenticated',
      'Authentication required',
      'The access token is missing or has expired.',
    );
  }
}
