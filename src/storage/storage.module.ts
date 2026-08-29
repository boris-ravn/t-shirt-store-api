import { Module } from '@nestjs/common';
import { ImageUrlService } from './image-url.service';
import { S3Service } from './s3.service';

@Module({
  providers: [ImageUrlService, S3Service],
  exports: [ImageUrlService, S3Service],
})
export class StorageModule {}
