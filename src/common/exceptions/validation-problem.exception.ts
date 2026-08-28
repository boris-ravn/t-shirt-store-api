import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';
import { FlatValidationError } from '../pipes/validation-error-formatter';

export class ValidationProblemException extends AppException {
  constructor(errors: FlatValidationError[]) {
    super(
      HttpStatus.BAD_REQUEST,
      'validation-error',
      'Validation failed',
      'One or more fields failed validation.',
      { errors },
    );
  }
}
