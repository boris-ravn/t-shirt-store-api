import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';

export class CategoryNameTakenException extends AppException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      'category-name-taken',
      'Category name or slug already in use',
      'A category with this name or slug already exists.',
    );
  }
}
