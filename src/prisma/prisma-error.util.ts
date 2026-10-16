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

// Adapter error kinds that mean Postgres itself is unavailable, as opposed
// to a query being wrong. AuthenticationFailed/DatabaseDoesNotExist are left
// out on purpose: those are our misconfiguration, not an outage to retry.
const DATABASE_UNAVAILABLE_KINDS = new Set([
  'DatabaseNotReachable',
  'ConnectionClosed',
  'SocketTimeout',
  'TooManyConnections',
]);

// Reproduced against a stopped Postgres: a model call fails with P1001 but
// $executeRaw with P2010, so the code alone can't be trusted — the
// driver-adapter kind is the one field both carry.
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

// When Postgres goes away under an idle pooled connection, pg raises a bare
// Error with no `code` (node_modules/pg/lib/client.js:204), adapter-pg's
// convertDriverError matches none of its branches, and that raw error is
// what reaches us — no Prisma wrapper, no `kind`. The message is the only
// signal, so it is matched exactly, and only on a code-less Error.
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
