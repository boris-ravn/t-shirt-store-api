import Stripe from 'stripe';
import { isDatabaseUnavailable } from '../../prisma/prisma-error.util';

export type UpstreamDependency = 'database' | 'stripe' | 's3' | 'unknown';

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
// nodemailer replaces the socket's code with 'ESOCKET'; only syscall survives.
const NETWORK_SYSCALLS = new Set(['connect', 'getaddrinfo']);

export function classifyUpstreamError(
  error: unknown,
): UpstreamDependency | undefined {
  if (isDatabaseUnavailable(error)) {
    return 'database';
  }
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeAPIError ||
    error instanceof Stripe.errors.StripeRateLimitError
  ) {
    return 'stripe';
  }
  if (hasNetworkSignature(error) || hasNetworkSignature(causeOf(error))) {
    return isAwsSdkError(error) ? 's3' : 'unknown';
  }
  return undefined;
}

function hasNetworkSignature(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }
  const { code, syscall } = value as { code?: unknown; syscall?: unknown };
  return (
    (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) ||
    (typeof syscall === 'string' && NETWORK_SYSCALLS.has(syscall))
  );
}

function isAwsSdkError(value: unknown): boolean {
  return isObject(value) && '$metadata' in value;
}

function causeOf(value: unknown): unknown {
  return isObject(value) ? (value as { cause?: unknown }).cause : undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
