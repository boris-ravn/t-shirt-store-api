import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

@Module({
  imports: [StorageModule],
  controllers: [LikesController],
  providers: [LikesService],
})
export class LikesModule {}
