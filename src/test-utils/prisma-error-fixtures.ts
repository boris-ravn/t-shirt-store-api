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

export function buildRecordNotFoundError(
  message = 'An operation failed because it depends on one or more records that were required but not found.',
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2025',
    clientVersion: '7.10.0',
  });
}
