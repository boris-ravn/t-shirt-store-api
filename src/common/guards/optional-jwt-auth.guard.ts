import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user.interface';

// For endpoints that are public but shape their response by role
// (listProducts, getProduct): decodes a bearer token if one is present and
// populates req.user, but never rejects the request for a missing or
// invalid one — canActivate() from the base AuthGuard always returns true
// as long as handleRequest doesn't throw (see @nestjs/passport's
// auth.guard.js), so this guard effectively always passes.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser | null>(
    _err: unknown,
    user: AuthenticatedUser | false,
  ): TUser {
    return (user || null) as TUser;
  }
}
