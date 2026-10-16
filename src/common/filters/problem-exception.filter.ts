import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PROBLEM_BASE_URI, ProblemDocument } from '../problem/problem.types';
import { classifyUpstreamError } from './upstream-error.util';

const UPSTREAM_RETRY_AFTER_SECONDS = 30;

// Fallback shapes for exceptions that reach here without already being a
// ProblemDocument (a bare Nest HttpException from a guard, the platform's
// own 404 for an unmatched route, body-parser's JSON-parse failure, ...).
// Anything raised deliberately by a service throws a named AppException
// subclass instead and skips this map entirely.
const DEFAULT_PROBLEMS: Partial<
  Record<number, { slug: string; title: string }>
> = {
  [HttpStatus.BAD_REQUEST]: {
    slug: 'malformed-request',
    title: 'Malformed request body',
  },
  [HttpStatus.UNAUTHORIZED]: {
    slug: 'unauthenticated',
    title: 'Authentication required',
  },
  [HttpStatus.FORBIDDEN]: {
    slug: 'insufficient-permissions',
    title: 'Insufficient permissions',
  },
  [HttpStatus.NOT_FOUND]: { slug: 'not-found', title: 'Resource not found' },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    slug: 'rate-limit-exceeded',
    title: 'Too many requests',
  },
  // Safety net for multer's own MULTER_HARD_CEILING_BYTES (see
  // product-image.constants.ts) — the real, precise image-too-large
  // Problem (with maxBytes/receivedBytes) is thrown directly by
  // ProductImagesService against the fully-buffered file, so this only
  // fires if the generous streaming ceiling itself is hit first.
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    slug: 'image-too-large',
    title: 'Image too large',
  },
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: {
    slug: 'unsupported-image-type',
    title: 'Unsupported image type',
  },
};

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const dependency =
      exception instanceof HttpException
        ? undefined
        : classifyUpstreamError(exception);
    const problem = dependency
      ? this.upstreamUnavailableProblem()
      : this.toProblem(exception);
    problem.instance = request.originalUrl;

    if (problem.status >= 500) {
      this.logger.error(
        dependency
          ? `Upstream dependency '${dependency}' unavailable on ${request.method} ${request.originalUrl}`
          : `Unhandled error on ${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (dependency) {
      response.setHeader('Retry-After', String(UPSTREAM_RETRY_AFTER_SECONDS));
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .send(problem);
  }

  private toProblem(exception: unknown): ProblemDocument {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      if (this.isProblemDocument(body)) {
        return body;
      }

      return this.defaultProblem(exception.getStatus());
    }

    const status = this.extractStatus(exception);
    return this.defaultProblem(status ?? HttpStatus.INTERNAL_SERVER_ERROR);
  }

  private upstreamUnavailableProblem(): ProblemDocument {
    return {
      type: `${PROBLEM_BASE_URI}/upstream-unavailable`,
      title: 'Service temporarily unavailable',
      status: HttpStatus.SERVICE_UNAVAILABLE,
      detail:
        'A service this request depends on is temporarily unavailable. Retry later.',
      retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS,
    };
  }

  private isProblemDocument(value: unknown): value is ProblemDocument {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      'title' in value &&
      'status' in value
    );
  }

  // `expose` (http-errors, used by body-parser) marks a status meant for the
  // caller; a Stripe error's `statusCode` is Stripe's response to us.
  private extractStatus(exception: unknown): number | undefined {
    if (typeof exception === 'object' && exception !== null) {
      const candidate = exception as {
        status?: unknown;
        statusCode?: unknown;
        expose?: unknown;
      };
      if (candidate.expose !== true) {
        return undefined;
      }
      const status = candidate.status ?? candidate.statusCode;
      if (typeof status === 'number') {
        return status;
      }
    }
    return undefined;
  }

  private defaultProblem(status: number): ProblemDocument {
    const mapped = DEFAULT_PROBLEMS[status];
    if (mapped) {
      return {
        type: `${PROBLEM_BASE_URI}/${mapped.slug}`,
        title: mapped.title,
        status,
      };
    }

    const isServerError = status >= 500;
    return {
      type: `${PROBLEM_BASE_URI}/${isServerError ? 'internal-error' : 'unexpected-error'}`,
      title: isServerError ? 'Internal server error' : 'Unexpected error',
      status: isServerError ? HttpStatus.INTERNAL_SERVER_ERROR : status,
      ...(isServerError ? { detail: 'An unexpected error occurred.' } : {}),
    };
  }
}
