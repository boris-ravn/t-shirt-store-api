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

// What body-parser hands the filter past its size limit and for a charset it
// can't decode: http-errors instances, with status/statusCode/expose set by
// createError (node_modules/http-errors/index.js:92-96). Props copied from
// node_modules/raw-body/index.js:163 and node_modules/body-parser/lib/read.js:73.
// A malformed JSON body never arrives here: Nest turns it into a
// BadRequestException first.
export function buildBodyTooLargeError(): Error {
  return Object.assign(new Error('request entity too large'), {
    status: 413,
    statusCode: 413,
    expose: true,
    expected: 204800,
    length: 204800,
    limit: 102400,
    type: 'entity.too.large',
  });
}

export function buildUnsupportedCharsetError(): Error {
  return Object.assign(new Error('unsupported charset "UTF-7"'), {
    status: 415,
    statusCode: 415,
    expose: true,
    charset: 'utf-7',
    type: 'charset.unsupported',
  });
}
