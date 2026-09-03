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

  describe.each(['Cart', 'Like'] as AppSubject[])(
    '%s (client-only subject)',
    (clientOnlySubject) => {
      const allActions: AppAction[] = [
        'manage',
        'create',
        'read',
        'update',
        'delete',
      ];

      it(`client can manage ${clientOnlySubject}`, () => {
        const ability = factory.createForUser({
          id: 'user-1',
          role: UserRole.client,
        });
        expect(ability.can('manage', clientOnlySubject)).toBe(true);
      });

      it.each(allActions)(
        `manager cannot %s ${clientOnlySubject}`,
        (action) => {
          const ability = factory.createForUser({
            id: 'user-1',
            role: UserRole.manager,
          });
          expect(ability.cannot(action, clientOnlySubject)).toBe(true);
        },
      );

      it.each(allActions)(
        `delivery_person cannot %s ${clientOnlySubject}`,
        (action) => {
          const ability = factory.createForUser({
            id: 'user-1',
            role: UserRole.delivery_person,
          });
          expect(ability.cannot(action, clientOnlySubject)).toBe(true);
        },
      );
    },
  );

  // PromoCode doesn't fit either pattern above: manager gets full manage
  // (like Category/Product/Sku), but client only gets 'apply' — not 'read',
  // unlike the client-can-read subjects, and not 'manage', unlike Cart/Like.
  describe('PromoCode', () => {
    const nonApplyActions: AppAction[] = [
      'manage',
      'create',
      'read',
      'update',
      'delete',
    ];

    it('manager can manage PromoCode', () => {
      const ability = factory.createForUser({
        id: 'user-1',
        role: UserRole.manager,
      });
      expect(ability.can('manage', 'PromoCode')).toBe(true);
    });

    // CASL's 'manage' matches every action by default, including custom
    // ones — without an explicit cannot('apply', ...), this would silently
    // pass despite 'apply' being meant as client-only (found via manual
    // testing, not this test — see decisions.md).
    it('manager cannot apply PromoCode, despite manage', () => {
      const ability = factory.createForUser({
        id: 'user-1',
        role: UserRole.manager,
      });
      expect(ability.cannot('apply', 'PromoCode')).toBe(true);
    });

    it('client can apply PromoCode', () => {
      const ability = factory.createForUser({
        id: 'user-1',
        role: UserRole.client,
      });
      expect(ability.can('apply', 'PromoCode')).toBe(true);
    });

    it.each(nonApplyActions)('client cannot %s PromoCode', (action) => {
      const ability = factory.createForUser({
        id: 'user-1',
        role: UserRole.client,
      });
      expect(ability.cannot(action, 'PromoCode')).toBe(true);
    });

    it.each([...nonApplyActions, 'apply'] as AppAction[])(
      'delivery_person cannot %s PromoCode',
      (action) => {
        const ability = factory.createForUser({
          id: 'user-1',
          role: UserRole.delivery_person,
        });
        expect(ability.cannot(action, 'PromoCode')).toBe(true);
      },
    );
  });
});
