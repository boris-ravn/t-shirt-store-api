import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UnauthenticatedException } from '../exceptions/unauthenticated.exception';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

// Overrides AuthGuard('jwt')'s default handleRequest (which throws Nest's
// generic UnauthorizedException) so a missing/invalid/expired token raises
// our own `unauthenticated` Problem instead — see
// docs/api/components/responses.yaml#/Unauthorized.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: AuthenticatedUser | false,
  ): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthenticatedException();
    }
    return user as TUser;
  }
}
