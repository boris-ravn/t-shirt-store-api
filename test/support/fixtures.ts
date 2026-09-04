import { randomUUID } from 'node:crypto';

// Every test creates its own account with a unique email so a suite stays
// order-independent despite sharing one container/app across all tests.
export function signUpPayload(
  prefix: string,
  overrides: Partial<Record<string, string>> = {},
) {
  return {
    email: `${prefix}-${randomUUID()}@example.com`,
    password: 'Sup3rSecret!',
    firstName: 'Ada',
    lastName: 'Lovelace',
    ...overrides,
  };
}
