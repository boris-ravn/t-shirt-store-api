import { Module } from '@nestjs/common';
import { ImageUrlService } from './image-url.service';

@Module({
  providers: [ImageUrlService],
  exports: [ImageUrlService],
})
export class StorageModule {}
