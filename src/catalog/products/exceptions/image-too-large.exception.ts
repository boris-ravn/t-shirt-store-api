import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';

export class ImageTooLargeException extends AppException {
  constructor(maxBytes: number, receivedBytes: number) {
    super(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'image-too-large',
      'Image too large',
      `The uploaded file exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit.`,
      { maxBytes, receivedBytes },
    );
  }
}
