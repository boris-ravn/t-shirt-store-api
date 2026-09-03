import { UserRole } from '../generated/prisma/enums';
import {
  AppAction,
  AppSubject,
  CaslAbilityFactory,
} from './casl-ability.factory';

// No mocking needed — createForUser(user) is pure given a {id, role} input.
describe('CaslAbilityFactory', () => {
  const factory = new CaslAbilityFactory();
  const subjects: AppSubject[] = ['Category', 'Product', 'Sku'];

  describe('manager', () => {
    const ability = factory.createForUser({
      id: 'user-1',
      role: UserRole.manager,
    });

    it.each(subjects)(
      'can manage (create/read/update/delete) %s',
      (subject) => {
        const actions: AppAction[] = [
          'manage',
          'create',
          'read',
          'update',
          'delete',
        ];
        for (const action of actions) {
          expect(ability.can(action, subject)).toBe(true);
        }
      },
    );
  });

  describe('client', () => {
    const ability = factory.createForUser({
      id: 'user-1',
      role: UserRole.client,
    });

    it.each(subjects)('can read %s', (subject) => {
      expect(ability.can('read', subject)).toBe(true);
    });

    // One case per action x subject rather than a single aggregate
    // assertion: this is the authorization-critical branch, so a failure
    // here should point straight at which action leaked, not just "client
    // can do something it shouldn't".
    it.each(
      (['create', 'update', 'delete', 'manage'] as AppAction[]).flatMap(
        (action) => subjects.map((subject) => [action, subject] as const),
      ),
    )('cannot %s %s', (action, subject) => {
      expect(ability.cannot(action, subject)).toBe(true);
    });
  });

  // The factory branches on `role === UserRole.manager`, with every other
  // role falling into the same read-only `else`. delivery_person exercises
  // that fallthrough directly, instead of trusting that "non-manager"
  // generalizes correctly from the client case alone.
  describe('delivery_person (non-manager fallthrough)', () => {
    const ability = factory.createForUser({
      id: 'user-1',
      role: UserRole.delivery_person,
    });

    it.each(subjects)('can read %s', (subject) => {
      expect(ability.can('read', subject)).toBe(true);
    });

    it.each(
      (['create', 'update', 'delete', 'manage'] as AppAction[]).flatMap(
        (action) => subjects.map((subject) => [action, subject] as const),
      ),
    )('cannot %s %s', (action, subject) => {
      expect(ability.cannot(action, subject)).toBe(true);
    });
  });

  // Cart doesn't fit the Category/Product/Sku pattern above (manager manages,
  // everyone else reads) — it's client-only, with no ability at all for the
  // other two roles, so it gets its own describe block.
  describe('Cart (client-only subject)', () => {
    const allActions: AppAction[] = [
      'manage',
      'create',
      'read',
      'update',
      'delete',
    ];

    it('client can manage Cart', () => {
      const ability = factory.createForUser({
        id: 'user-1',
        role: UserRole.client,
      });
      expect(ability.can('manage', 'Cart')).toBe(true);
    });

    it.each(allActions)('manager cannot %s Cart', (action) => {
      const ability = factory.createForUser({
        id: 'user-1',
        role: UserRole.manager,
      });
      expect(ability.cannot(action, 'Cart')).toBe(true);
    });

    it.each(allActions)('delivery_person cannot %s Cart', (action) => {
      const ability = factory.createForUser({
        id: 'user-1',
        role: UserRole.delivery_person,
      });
      expect(ability.cannot(action, 'Cart')).toBe(true);
    });
  });
});
