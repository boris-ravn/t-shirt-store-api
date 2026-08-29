import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';

export class CategoryNotEmptyException extends AppException {
  constructor(productCount: number) {
    super(
      HttpStatus.CONFLICT,
      'category-not-empty',
      'Category is not empty',
      'This category still has products assigned to it.',
      { productCount },
    );
  }
}
