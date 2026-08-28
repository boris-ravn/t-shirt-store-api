import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

// Thrown for a token that is unknown, expired, or already used — one
// message for all three, so a caller can't distinguish them (see
// docs/api/paths/auth.yaml#/resetPassword).
export class InvalidResetTokenException extends AppException {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      'invalid-reset-token',
      'Invalid reset token',
      'This password reset token is invalid or has expired.',
    );
  }
}
