import { ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import {
  buildDatabaseUnavailableError,
  buildPgConnectionTerminatedError,
  buildUniqueConstraintError,
} from '../../test-utils/prisma-error-fixtures';
import {
  buildS3ConnectionError,
  buildSmtpConnectionError,
  buildStripeAuthenticationError,
  buildStripeConnectionError,
} from '../../test-utils/upstream-error-fixtures';
import { classifyUpstreamError } from './upstream-error.util';

describe('classifyUpstreamError', () => {
  it('classifies DatabaseNotReachable as database, for both P1001 and P2010', () => {
    expect(
      classifyUpstreamError(
        buildDatabaseUnavailableError('DatabaseNotReachable', 'P1001'),
      ),
    ).toBe('database');
    expect(
      classifyUpstreamError(
        buildDatabaseUnavailableError('DatabaseNotReachable', 'P2010'),
      ),
    ).toBe('database');
  });

  it.each(['ConnectionClosed', 'SocketTimeout', 'TooManyConnections'])(
    'classifies %s as database',
    (kind) => {
      expect(classifyUpstreamError(buildDatabaseUnavailableError(kind))).toBe(
        'database',
      );
    },
  );

  it("classifies pg's bare 'Connection terminated unexpectedly' as database", () => {
    expect(classifyUpstreamError(buildPgConnectionTerminatedError())).toBe(
      'database',
    );
  });

  it('does not classify that message when the error carries a code', () => {
    const coded = Object.assign(
      new Error('Connection terminated unexpectedly'),
      { code: 'SOMETHING_ELSE' },
    );

    expect(classifyUpstreamError(coded)).toBeUndefined();
  });

  it("does not classify pg's plain 'Connection terminated'", () => {
    expect(
      classifyUpstreamError(new Error('Connection terminated')),
    ).toBeUndefined();
  });

  it('does not classify DatabaseDoesNotExist as an outage', () => {
    expect(
      classifyUpstreamError(
        buildDatabaseUnavailableError('DatabaseDoesNotExist'),
      ),
    ).toBeUndefined();
  });

  it('does not classify AuthenticationFailed or a P2002 as an outage', () => {
    expect(
      classifyUpstreamError(
        buildDatabaseUnavailableError('AuthenticationFailed'),
      ),
    ).toBeUndefined();
    expect(
      classifyUpstreamError(buildUniqueConstraintError('skus_sku_code_key')),
    ).toBeUndefined();
  });

  it.each([
    ['StripeConnectionError', buildStripeConnectionError()],
    [
      'StripeAPIError',
      new Stripe.errors.StripeAPIError({
        message: 'Something went wrong on Stripe’s end.',
        statusCode: 500,
      }),
    ],
    [
      'StripeRateLimitError',
      new Stripe.errors.StripeRateLimitError({
        message: 'Too many requests hit the API too quickly.',
        statusCode: 429,
      }),
    ],
  ])('classifies %s as stripe', (_name, error) => {
    expect(classifyUpstreamError(error)).toBe('stripe');
  });

  it('does not classify StripeAuthenticationError', () => {
    expect(
      classifyUpstreamError(buildStripeAuthenticationError()),
    ).toBeUndefined();
  });

  it('classifies the nodemailer ESOCKET shape as unknown', () => {
    expect(classifyUpstreamError(buildSmtpConnectionError())).toBe('unknown');
  });

  it('classifies an AWS SDK network error as s3', () => {
    expect(classifyUpstreamError(buildS3ConnectionError())).toBe('s3');
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN'])(
    'classifies a %s DNS failure as an outage',
    (code) => {
      const error = Object.assign(
        new Error(`getaddrinfo ${code} mail.example.test`),
        { code, syscall: 'getaddrinfo', hostname: 'mail.example.test' },
      );

      expect(classifyUpstreamError(error)).toBe('unknown');
    },
  );

  it('recognises a network error carried on `cause`', () => {
    const socketError = Object.assign(
      new Error('connect ECONNREFUSED 127.0.0.1:443'),
      { code: 'ECONNREFUSED', syscall: 'connect' },
    );
    const fetchError = Object.assign(new TypeError('fetch failed'), {
      cause: socketError,
    });

    expect(classifyUpstreamError(fetchError)).toBe('unknown');
  });

  it('returns undefined for a plain bug and for an HttpException', () => {
    expect(
      classifyUpstreamError(
        new TypeError("Cannot read properties of undefined (reading 'id')"),
      ),
    ).toBeUndefined();
    expect(
      classifyUpstreamError(new ServiceUnavailableException()),
    ).toBeUndefined();
  });
});
