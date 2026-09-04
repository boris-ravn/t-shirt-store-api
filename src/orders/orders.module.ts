import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StaleOrderSweepService } from './stale-order-sweep.service';

@Module({
  imports: [CartModule],
  controllers: [OrdersController],
  providers: [OrdersService, StaleOrderSweepService],
})
export class OrdersModule {}
