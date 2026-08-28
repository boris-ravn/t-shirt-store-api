import { UserRole } from '../../generated/prisma/enums';

// What ends up on `req.user` after JwtStrategy.validate() — deliberately
// minimal (id + role), not the full User row. Anything else a handler needs
// is fetched from the DB, not trusted from the token payload.
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}
