import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
} from '@casl/ability';
import { UserRole } from '../generated/prisma/enums';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';

export type AppAction =
  'manage' | 'create' | 'read' | 'update' | 'delete' | 'apply';
export type AppSubject =
  'Category' | 'Product' | 'Sku' | 'Cart' | 'Like' | 'PromoCode' | 'all';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

@Injectable()
export class CaslAbilityFactory {
  createForUser(user: AuthenticatedUser): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createMongoAbility,
    );

    if (user.role === UserRole.manager) {
      // Disable is a PATCH writing `status`, covered by `update` — not a
      // separate CASL action.
      can('manage', 'Category');
      can('manage', 'Product');
      can('manage', 'Sku');
      can('manage', 'PromoCode');
      // 'manage' matches every action, including custom ones like 'apply'
      // — this carve-out is not redundant (decisions.md).
      cannot('apply', 'PromoCode');
    } else {
      can('read', 'Category');
      can('read', 'Product');
      can('read', 'Sku');

      // Cart and Like are client-only — manager and delivery_person get no
      // ability on either, not even read (decisions.md).
      if (user.role === UserRole.client) {
        can('manage', 'Cart');
        can('manage', 'Like');
        can('apply', 'PromoCode');
      }
    }

    return build();
  }
}
