import { User } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';

export function buildClientUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return { id: 'client-1', role: UserRole.client, ...overrides };
}

export function buildManagerUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return { id: 'manager-1', role: UserRole.manager, ...overrides };
}

export function buildDeliveryUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return { id: 'delivery-1', role: UserRole.delivery_person, ...overrides };
}

export function buildUserRow(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    passwordHash: 'hashed-password',
    firstName: 'Jane',
    lastName: 'Doe',
    role: UserRole.client,
    passwordChangedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
