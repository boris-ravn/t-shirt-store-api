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

const DATABASE_UNAVAILABLE_KINDS = new Set([
  'DatabaseNotReachable',
  'ConnectionClosed',
  'SocketTimeout',
  'TooManyConnections',
]);

// Matches on the adapter kind, not the code: the same outage is P1001 from a
// model call and P2010 from $executeRaw.
export function isDatabaseUnavailable(error: unknown): boolean {
  if (isPgConnectionTerminated(error)) {
    return true;
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  const meta = error.meta as
    { driverAdapterError?: { cause?: { kind?: unknown } } } | undefined;
  const kind = meta?.driverAdapterError?.cause?.kind;
  return typeof kind === 'string' && DATABASE_UNAVAILABLE_KINDS.has(kind);
}

// pg raises this without a `code` and Prisma passes it through unwrapped, so
// the message is the only signal.
const PG_CONNECTION_TERMINATED = 'Connection terminated unexpectedly';

function isPgConnectionTerminated(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === PG_CONNECTION_TERMINATED &&
    !('code' in error)
  );
}

// Prisma 7's driver-adapter (@prisma/adapter-pg) P2002 errors do not carry
// the classic `meta.target: string[]` field-name array. The underlying
// Postgres constraint/index name (e.g. "skus_sku_code_key") lives at
// `meta.driverAdapterError.cause.constraint.index` instead — the only way
// to tell two unique constraints on the same model apart under this setup.
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
