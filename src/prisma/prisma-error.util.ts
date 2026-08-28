import { Prisma } from '../generated/prisma/client';

function target(error: Prisma.PrismaClientKnownRequestError): string[] {
  const value = error.meta?.target;
  if (Array.isArray(value)) {
    return value as string[];
  }
  return typeof value === 'string' ? [value] : [];
}

// P2002: a `@unique`/`@@unique` constraint was violated. `field`, when
// given, checks the violation actually involves that column (via Prisma's
// `meta.target`) rather than some other unique constraint on the model.
export function isUniqueConstraintViolation(
  error: unknown,
  field?: string,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  return field === undefined || target(error).includes(field);
}

// P2025: the row a write targeted (update/delete/findUniqueOrThrow) doesn't
// exist.
export function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}
