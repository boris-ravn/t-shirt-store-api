import { Prisma } from '../generated/prisma/client';

export function buildUniqueConstraintError(
  indexName: string,
  message = 'Unique constraint failed',
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2002',
    clientVersion: '7.10.0',
    meta: {
      driverAdapterError: {
        cause: { constraint: { index: indexName } },
      },
    },
  });
}

export function buildDatabaseUnavailableError(
  kind = 'DatabaseNotReachable',
  code: 'P1001' | 'P2010' = 'P1001',
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "Can't reach database server at 127.0.0.1:5432",
    {
      code,
      clientVersion: '7.10.0',
      meta: {
        driverAdapterError: {
          cause: { kind, host: '127.0.0.1', port: 5432 },
        },
      },
    },
  );
}

export function buildPgConnectionTerminatedError(): Error {
  return new Error('Connection terminated unexpectedly');
}

export function buildRecordNotFoundError(
  message = 'An operation failed because it depends on one or more records that were required but not found.',
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2025',
    clientVersion: '7.10.0',
  });
}
