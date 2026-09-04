import {
  buildClientUser,
  buildDeliveryUser,
  buildManagerUser,
} from '../test-utils/user-fixtures';
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
    const ability = factory.createForUser(buildManagerUser());

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
    const ability = factory.createForUser(buildClientUser());

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
    const ability = factory.createForUser(buildDeliveryUser());

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
        const ability = factory.createForUser(buildClientUser());
        expect(ability.can('manage', clientOnlySubject)).toBe(true);
      });

      it.each(allActions)(
        `manager cannot %s ${clientOnlySubject}`,
        (action) => {
          const ability = factory.createForUser(buildManagerUser());
          expect(ability.cannot(action, clientOnlySubject)).toBe(true);
        },
      );

      it.each(allActions)(
        `delivery_person cannot %s ${clientOnlySubject}`,
        (action) => {
          const ability = factory.createForUser(buildDeliveryUser());
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
      const ability = factory.createForUser(buildManagerUser());
      expect(ability.can('manage', 'PromoCode')).toBe(true);
    });

    it('manager cannot apply PromoCode, despite manage', () => {
      const ability = factory.createForUser(buildManagerUser());
      expect(ability.cannot('apply', 'PromoCode')).toBe(true);
    });

    it('client can apply PromoCode', () => {
      const ability = factory.createForUser(buildClientUser());
      expect(ability.can('apply', 'PromoCode')).toBe(true);
    });

    it.each(nonApplyActions)('client cannot %s PromoCode', (action) => {
      const ability = factory.createForUser(buildClientUser());
      expect(ability.cannot(action, 'PromoCode')).toBe(true);
    });

    it.each([...nonApplyActions, 'apply'] as AppAction[])(
      'delivery_person cannot %s PromoCode',
      (action) => {
        const ability = factory.createForUser(buildDeliveryUser());
        expect(ability.cannot(action, 'PromoCode')).toBe(true);
      },
    );
  });

  // Order has a distinct action per role per docs/api's four-transition-
  // endpoints design (decisions.md) — each role's exact allowed/denied set
  // is asserted explicitly rather than derived from a shared list, since
  // that's the whole point of granular actions over a blanket 'manage'.
  describe('Order', () => {
    const allActions: AppAction[] = [
      'manage',
      'create',
      'read',
      'update',
      'delete',
      'apply',
      'cancel',
      'process',
      'ship',
      'deliver',
    ];

    it.each(['read', 'process', 'ship', 'cancel'] as AppAction[])(
      'manager can %s Order',
      (action) => {
        const ability = factory.createForUser(buildManagerUser());
        expect(ability.can(action, 'Order')).toBe(true);
      },
    );

    it.each(
      allActions.filter(
        (a) => !['read', 'process', 'ship', 'cancel'].includes(a),
      ),
    )('manager cannot %s Order', (action) => {
      const ability = factory.createForUser(buildManagerUser());
      expect(ability.cannot(action, 'Order')).toBe(true);
    });

    it.each(['create', 'read', 'cancel'] as AppAction[])(
      'client can %s Order',
      (action) => {
        const ability = factory.createForUser(buildClientUser());
        expect(ability.can(action, 'Order')).toBe(true);
      },
    );

    it.each(
      allActions.filter((a) => !['create', 'read', 'cancel'].includes(a)),
    )('client cannot %s Order', (action) => {
      const ability = factory.createForUser(buildClientUser());
      expect(ability.cannot(action, 'Order')).toBe(true);
    });

    it.each(['read', 'deliver'] as AppAction[])(
      'delivery_person can %s Order',
      (action) => {
        const ability = factory.createForUser(buildDeliveryUser());
        expect(ability.can(action, 'Order')).toBe(true);
      },
    );

    it.each(allActions.filter((a) => !['read', 'deliver'].includes(a)))(
      'delivery_person cannot %s Order',
      (action) => {
        const ability = factory.createForUser(buildDeliveryUser());
        expect(ability.cannot(action, 'Order')).toBe(true);
      },
    );
  });
});
