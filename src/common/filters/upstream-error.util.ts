import Stripe from 'stripe';
import { isDatabaseUnavailable } from '../../prisma/prisma-error.util';

// Never sent to the caller — only logged, so an operator knows which
// dependency to look at without the API advertising its own stack.
export type UpstreamDependency = 'database' | 'stripe' | 's3' | 'unknown';

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
// nodemailer wraps a refused connection as code 'ESOCKET', keeping only
// syscall 'connect' from the original socket error.
const NETWORK_SYSCALLS = new Set(['connect', 'getaddrinfo']);

// Classifies an error as "a dependency is unavailable, retrying later can
// succeed" (503) versus anything else (500). A Stripe authentication or
// invalid-request error is deliberately not here: that is our bug, and
// retrying it changes nothing.
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
    // Every AWS SDK v3 error carries `$metadata`; nothing else here does.
    return isObject(error) && '$metadata' in error ? 's3' : 'unknown';
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

// One level only: fetch-based clients wrap the socket error as `cause`.
function causeOf(value: unknown): unknown {
  return isObject(value) ? (value as { cause?: unknown }).cause : undefined;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
