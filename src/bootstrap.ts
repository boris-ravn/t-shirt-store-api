import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ProblemExceptionFilter } from './common/filters/problem-exception.filter';
import { ValidationProblemException } from './common/exceptions/validation-problem.exception';
import { flattenValidationErrors } from './common/pipes/validation-error-formatter';

// Shared between main.ts and the e2e test setup so the two can't drift —
// an e2e suite that skips helmet/the validation pipe/the exception filter
// isn't testing the app that actually runs.
export function configureApp(app: INestApplication): void {
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
}

export function setupSwagger(app: INestApplication): void {
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
}
