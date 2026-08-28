import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { ProductImagesService } from './products/product-images.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { SkusController } from './skus/skus.controller';
import { SkusService } from './skus/skus.service';

@Module({
  imports: [StorageModule],
  controllers: [CategoriesController, ProductsController, SkusController],
  providers: [
    CategoriesService,
    ProductsService,
    ProductImagesService,
    SkusService,
  ],
})
export class CatalogModule {}
