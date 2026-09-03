import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CaslModule } from './casl/casl.module';
import { CatalogModule } from './catalog/catalog.module';
import { validate } from './config/env.validation';
import { LikesModule } from './likes/likes.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromosModule } from './promos/promos.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.getOrThrow<number>('THROTTLE_TTL') * 1000,
            limit: configService.getOrThrow<number>('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),
    PrismaModule,
    CaslModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    CartModule,
    LikesModule,
    PromosModule,
    OrdersModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
