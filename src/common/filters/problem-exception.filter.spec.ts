import { ArgumentsHost, ConflictException, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { buildDatabaseUnavailableError } from '../../test-utils/prisma-error-fixtures';
import {
  buildBodyTooLargeError,
  buildS3ConnectionError,
  buildSmtpConnectionError,
  buildStripeAuthenticationError,
  buildStripeConnectionError,
  buildUnsupportedCharsetError,
} from '../../test-utils/upstream-error-fixtures';
import { PROBLEM_BASE_URI } from '../problem/problem.types';
import { ProblemExceptionFilter } from './problem-exception.filter';

describe('ProblemExceptionFilter', () => {
  let filter: ProblemExceptionFilter;
  let response: {
    status: jest.Mock;
    type: jest.Mock;
    send: jest.Mock;
    setHeader: jest.Mock;
  };
  let loggerError: jest.SpyInstance;

  // catch() only calls switchToHttp().getResponse()/getRequest(); the
  // response methods are chained (status().type().send()), so each returns
  // the same object.
  function fakeHost(method = 'GET', originalUrl = '/v1/orders'): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method, originalUrl }),
      }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    filter = new ProblemExceptionFilter();
    response = {
      status: jest.fn(),
      type: jest.fn(),
      send: jest.fn(),
      setHeader: jest.fn(),
    };
    response.status.mockReturnValue(response);
    response.type.mockReturnValue(response);
    response.setHeader.mockReturnValue(response);
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  function sentBody(): Record<string, unknown> {
    expect(response.send).toHaveBeenCalledTimes(1);
    const [[body]] = response.send.mock.calls as [[Record<string, unknown>]];
    return body;
  }

  it('answers 503 upstream-unavailable with Retry-After for a database outage', () => {
    filter.catch(buildDatabaseUnavailableError(), fakeHost());

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(sentBody()).toEqual({
      type: `${PROBLEM_BASE_URI}/upstream-unavailable`,
      title: 'Service temporarily unavailable',
      status: 503,
      detail:
        'A service this request depends on is temporarily unavailable. Retry later.',
      instance: '/v1/orders',
      retryAfterSeconds: 30,
    });
  });

  it.each([
    ['database', buildDatabaseUnavailableError()],
    ['stripe', buildStripeConnectionError()],
    ['s3', buildS3ConnectionError()],
    ['smtp', buildSmtpConnectionError()],
  ])(
    'never names the failed dependency in the response body (%s)',
    (_name, error) => {
      filter.catch(error, fakeHost());

      const body = JSON.stringify(sentBody());
      expect(body).not.toMatch(
        /database|postgres|prisma|stripe|s3|aws|smtp|mail|127\.0\.0\.1|ECONNREFUSED|ESOCKET/i,
      );
    },
  );

  it('logs the dependency at error level for a 503', () => {
    const error = buildDatabaseUnavailableError();

    filter.catch(error, fakeHost('POST', '/v1/orders'));

    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      "Upstream dependency 'database' unavailable on POST /v1/orders",
      error.stack,
    );
  });

  it('answers 500 and logs a StripeAuthenticationError, not 401', () => {
    filter.catch(buildStripeAuthenticationError(), fakeHost());

    expect(response.status).toHaveBeenCalledWith(500);
    expect(sentBody()).toEqual({
      type: `${PROBLEM_BASE_URI}/internal-error`,
      title: 'Internal server error',
      status: 500,
      detail: 'An unexpected error occurred.',
      instance: '/v1/orders',
    });
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      'Unhandled error on GET /v1/orders',
      expect.any(String),
    );
  });

  // The slug is not asserted: DEFAULT_PROBLEMS maps any 413/415 to the
  // image-upload problems, which is wrong for a JSON body and predates this
  // branch. What this branch must keep is the status reaching the caller.
  it.each([
    [413, buildBodyTooLargeError()],
    [415, buildUnsupportedCharsetError()],
  ])(
    'still answers %i for an exposed body-parser error, unlogged',
    (status, error) => {
      filter.catch(error, fakeHost('POST', '/v1/cart'));

      expect(response.status).toHaveBeenCalledWith(status);
      expect(sentBody()).toMatchObject({ status, instance: '/v1/cart' });
      expect(response.setHeader).not.toHaveBeenCalled();
      expect(loggerError).not.toHaveBeenCalled();
    },
  );

  it('answers 500 for a statusCode the error does not expose', () => {
    const error = Object.assign(new Error('upstream said no'), {
      statusCode: 404,
    });

    filter.catch(error, fakeHost());

    expect(response.status).toHaveBeenCalledWith(500);
    expect(sentBody()).toMatchObject({
      type: `${PROBLEM_BASE_URI}/internal-error`,
      status: 500,
    });
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('answers 500 for a StripeInvalidRequestError, not 400', () => {
    const error = new Stripe.errors.StripeInvalidRequestError({
      message: 'No such price',
      statusCode: 400,
    });

    filter.catch(error, fakeHost());

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledTimes(1);
  });

  it('keeps an HttpException status even with a network error as cause', () => {
    const exception = new ConflictException('Already taken', {
      cause: buildS3ConnectionError(),
    });

    filter.catch(exception, fakeHost());

    expect(response.status).toHaveBeenCalledWith(409);
    expect(sentBody()).not.toHaveProperty('retryAfterSeconds');
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('does not set Retry-After on a plain 500', () => {
    filter.catch(new Error('boom'), fakeHost());

    expect(response.status).toHaveBeenCalledWith(500);
    expect(sentBody()).not.toHaveProperty('retryAfterSeconds');
    expect(response.setHeader).not.toHaveBeenCalled();
  });
});
