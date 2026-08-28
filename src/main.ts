import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import { flattenValidationErrors } from './common/pipes/validation-error-formatter';
import { ValidationProblemException } from './common/exceptions/validation-problem.exception';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.use(helmet());
  app.enableCors();

  app.useGlobalFilters(new ProblemExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ValidationProblemException(flattenValidationErrors(errors)),
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('T-Shirt Store API')
    .setDescription(
      'Generated from Nest decorators — reconciled against the hand-written contract in docs/api/, which stays authoritative (see docs/decisions.md).',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(configService.getOrThrow<number>('PORT'));
}
void bootstrap();
