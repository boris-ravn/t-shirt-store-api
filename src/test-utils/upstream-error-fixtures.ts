import Stripe from 'stripe';

// Shapes copied from real errors captured by pointing each client at a
// port with nothing listening (decisions.md, 2026-10-16) — not from docs.

export function buildStripeConnectionError(): Stripe.errors.StripeConnectionError {
  return new Stripe.errors.StripeConnectionError({
    message: 'An error occurred with our connection to Stripe.',
  });
}

export function buildStripeAuthenticationError(): Stripe.errors.StripeAuthenticationError {
  return new Stripe.errors.StripeAuthenticationError({
    message: 'Invalid API Key provided.',
    statusCode: 401,
  });
}

// nodemailer: a plain Error, `code` rewritten to 'ESOCKET', only `syscall`
// survives from the socket error.
export function buildSmtpConnectionError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1025'), {
    errno: -4078,
    code: 'ESOCKET',
    syscall: 'connect',
    address: '127.0.0.1',
    port: 1025,
    command: 'CONN',
  });
}

// AWS SDK v3: the socket error itself, plus the SDK's `$metadata`.
export function buildS3ConnectionError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9000'), {
    errno: -4078,
    code: 'ECONNREFUSED',
    syscall: 'connect',
    $metadata: { attempts: 1, totalRetryDelay: 0 },
  });
}

// What body-parser hands the filter for a malformed JSON body (http-errors).
export function buildExposedClientError(status = 400): Error {
  return Object.assign(new Error('Unexpected token } in JSON'), {
    status,
    statusCode: status,
    expose: true,
  });
}
