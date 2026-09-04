import { config } from 'dotenv';

// Loaded first so a real .env's STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET (if
// the developer has added them) survive the `??=` defaults below — dotenv
// does not override already-set process.env vars, and every other var here
// is set unconditionally right after, so this can't leak a real DATABASE_URL
// or JWT secret into the test run.
config();

// Runs before any e2e spec file is required — critically, before
// `../src/app.module`'s `@Module()` decorator evaluates ConfigModule.forRoot(),
// which calls env.validation.ts's validate() at import time, not at
// beforeAll() time. DATABASE_URL is a placeholder that's never actually
// used to connect: ConfigService snapshots and validates env vars once, at
// that import-time evaluation, so overwriting process.env.DATABASE_URL
// later (e.g. once a spec's Testcontainers Postgres is up) does NOT reach
// PrismaService's ConfigService.getOrThrow('DATABASE_URL') — each spec
// instead overrides the PrismaService provider directly with an instance
// pointed at its real container (see auth.e2e-spec.ts's beforeAll).
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DATABASE_URL =
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';
process.env.JWT_ACCESS_SECRET = 'e2e-test-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.PASSWORD_RESET_TOKEN_EXPIRES_IN = '1h';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '1025';
process.env.SMTP_FROM = 'no-reply@tshirt-store.example';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_S3_BUCKET = 'unused-in-e2e-tests';
process.env.AWS_ACCESS_KEY_ID = 'unused';
process.env.AWS_SECRET_ACCESS_KEY = 'unused';
process.env.THROTTLE_TTL = '60';
process.env.THROTTLE_LIMIT = '1000';

// Left as-is if already exported (a developer's real Stripe test-mode key,
// for specs that call the live Stripe API) — defaulted only so every other
// spec, which never touches Stripe, still passes env validation at boot.
process.env.STRIPE_SECRET_KEY ??= 'sk_test_e2e_placeholder';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_e2e_placeholder';
