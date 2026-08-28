import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';

export class UnsupportedImageTypeException extends AppException {
  constructor(accepted: readonly string[]) {
    super(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'unsupported-image-type',
      'Unsupported image type',
      `Only ${accepted.join(', ')} are accepted.`,
      { accepted },
    );
  }
}
