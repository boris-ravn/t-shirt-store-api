import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { PromosController } from './promos.controller';
import { PromosService } from './promos.service';

@Module({
  imports: [CartModule],
  controllers: [PromosController],
  providers: [PromosService],
})
export class PromosModule {}
