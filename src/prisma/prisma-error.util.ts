import { Prisma } from '../generated/prisma/client';

// P2002: a `@unique`/`@@unique` constraint was violated.
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// P2025: the row a write targeted (update/delete/findUniqueOrThrow) doesn't
// exist.
export function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

// Prisma 7's driver-adapter (@prisma/adapter-pg) P2002 errors do NOT carry
// the classic `meta.target: string[]` field-name array — verified
// empirically against this project's actual Postgres setup, not assumed:
// meta here is `{ driverAdapterError: { cause: { constraint: { index } } } }`,
// where `index` is the underlying Postgres constraint/index name (e.g.
// "skus_sku_code_key"). This is the only way to tell two unique
// constraints on the same model apart under this setup.
export function uniqueConstraintIndexName(error: unknown): string | undefined {
  if (!isUniqueConstraintViolation(error)) {
    return undefined;
  }
  const meta = (error as Prisma.PrismaClientKnownRequestError).meta as
    | { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } }
    | undefined;
  const index = meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === 'string' ? index : undefined;
}
