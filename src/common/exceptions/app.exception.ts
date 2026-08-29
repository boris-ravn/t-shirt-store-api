import { HttpException } from '@nestjs/common';
import { PROBLEM_BASE_URI, ProblemDocument } from '../problem/problem.types';

// Base for every domain-specific error in the app. A subclass fixes its own
// slug/title/status; services throw the named subclass (e.g.
// EmailAlreadyRegisteredException), never this class directly. `getResponse()`
// already returns a full ProblemDocument (minus `instance`, which only the
// filter can fill in, since it needs the request path) — the global
// ProblemExceptionFilter passes it through rather than re-deriving it.
export class AppException extends HttpException {
  constructor(
    status: number,
    slug: string,
    title: string,
    detail?: string,
    extensions?: Record<string, unknown>,
  ) {
    const problem: ProblemDocument = {
      type: `${PROBLEM_BASE_URI}/${slug}`,
      title,
      status,
      ...(detail !== undefined ? { detail } : {}),
      ...extensions,
    };
    super(problem, status);
  }
}
