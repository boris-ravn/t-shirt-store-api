import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface E2eApp {
  app: INestApplication<Server>;
  prisma: PrismaService;
  container: StartedPostgreSqlContainer;
}

// Real Postgres via Testcontainers, migrated with `prisma migrate deploy`
// (not `db push` — that would skip the hand-written SQL in the migration
// files: partial unique indexes, the stock CHECK constraint), and a real
// Nest app built the same way main.ts does (configureApp is shared between
// the two specifically so a suite can't silently drift from what actually
// runs in production).
export async function bootstrapE2eApp(
  options: { rawBody?: boolean } = {},
): Promise<E2eApp> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('tshirt_store_test')
    .withUsername('tshirt_store_test')
    .withPassword('tshirt_store_test')
    .start();

  const databaseUrl = container.getConnectionUri();

  execSync('npx prisma migrate deploy', {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DOTENV_CONFIG_QUIET: 'true',
    },
    stdio: 'inherit',
  });

  // Overriding process.env.DATABASE_URL here doesn't reach PrismaService:
  // ConfigModule.forRoot({ validate }) snapshots and validates env vars once,
  // at AppModule's @Module() decorator evaluation (import time, via
  // test/env-setup.ts's placeholder) — ConfigService.getOrThrow keeps
  // serving that snapshot regardless of later process.env writes. Overriding
  // the PrismaService provider directly with a real instance (pointed at the
  // actual container) sidesteps that entirely.
  const testPrismaService = new PrismaService({
    getOrThrow: () => databaseUrl,
  } as unknown as ConfigService);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(testPrismaService)
    .compile();
  const app: INestApplication<Server> = moduleRef.createNestApplication(
    options.rawBody ? { rawBody: true } : undefined,
  );
  configureApp(app);
  await app.init();

  const prisma = moduleRef.get(PrismaService);

  return { app, prisma, container };
}

export async function teardownE2eApp({
  app,
  container,
}: E2eApp): Promise<void> {
  await app.close();
  await container.stop();
}
