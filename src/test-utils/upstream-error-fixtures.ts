import Stripe from 'stripe';

// Shapes captured from the real clients pointed at a closed port.

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

export function buildS3ConnectionError(): Error {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9000'), {
    errno: -4078,
    code: 'ECONNREFUSED',
    syscall: 'connect',
    $metadata: { attempts: 1, totalRetryDelay: 0 },
  });
}

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
