import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

export class InvalidRefreshTokenException extends AppException {
  constructor() {
    super(
      HttpStatus.UNAUTHORIZED,
      'invalid-refresh-token',
      'Invalid refresh token',
      'This refresh token is invalid or has been revoked.',
    );
  }
}
