import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';

export class DuplicateSkuException extends AppException {
  constructor(conflictingField: 'skuCode' | 'size,color') {
    super(
      HttpStatus.CONFLICT,
      'duplicate-sku',
      'Duplicate SKU',
      conflictingField === 'skuCode'
        ? 'A SKU with this code already exists for this product.'
        : 'A SKU with this size/color already exists for this product.',
      { conflictingField },
    );
  }
}
