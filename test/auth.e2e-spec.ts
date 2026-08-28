import { execSync } from 'node:child_process';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(120_000);

// Real Postgres via Testcontainers, migrated with `prisma migrate deploy`
// (not `db push` — that would skip the hand-written SQL in the migration
// file: the partial unique indexes and the stock CHECK constraint), and a
// real Nest app built the same way main.ts does (configureApp is shared
// between the two specifically so this suite can't silently drift from
// what actually runs in production).
describe('Auth (e2e)', () => {
  let container: StartedPostgreSqlContainer;
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine')
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
    // ConfigModule.forRoot({ validate }) snapshots and validates env vars
    // once, at AppModule's @Module() decorator evaluation (import time, via
    // test/env-setup.ts's placeholder) — ConfigService.getOrThrow keeps
    // serving that snapshot regardless of later process.env writes.
    // Overriding the PrismaService provider directly with a real instance
    // (pointed at the actual container) sidesteps that entirely.
    const testPrismaService = new PrismaService({
      getOrThrow: () => databaseUrl,
    } as unknown as ConfigService);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(testPrismaService)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await container.stop();
  });

  // Harness verified manually end-to-end (real container, real
  // `prisma migrate deploy`, real app, actual sign-up -> sign-in ->
  // refresh -> sign-out over HTTP, plus the refresh_tokens.revoked_at
  // persisted-state check) before being reduced to this it.todo — see the
  // commit message for the real run's output. Left as it.todo rather than
  // a written assertion sequence, per CLAUDE.md: don't write the
  // assertions for code written in this session, offer the harness and
  // let Boris write them.
  it.todo(
    'signs up, signs in, refreshes (rotating the token), and signs out — asserting HTTP responses and that refresh_tokens.revoked_at is set after sign-out, not just the 204',
  );

  // Reference for the assertions above, so the harness is ready to use:
  //   const agent = request(app.getHttpServer());
  //   const signUp = await agent.post('/v1/auth/sign-up').send({ email, password, firstName, lastName });
  //   const signIn = await agent.post('/v1/auth/sign-in').send({ email, password });
  //   const refreshed = await agent.post('/v1/auth/refresh').send({ refreshToken: signIn.body.refreshToken });
  //   await agent.post('/v1/auth/sign-out')
  //     .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
  //     .send({ refreshToken: refreshed.body.refreshToken });
  //   const tokenHash = createHash('sha256').update(refreshed.body.refreshToken).digest('hex');
  //   const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  void request;
  void prisma;
});
