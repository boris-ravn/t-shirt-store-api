import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
} from '@casl/ability';
import { UserRole } from '../generated/prisma/enums';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';

export type AppAction = 'manage' | 'create' | 'read' | 'update' | 'delete';
export type AppSubject = 'Category' | 'Product' | 'Sku' | 'Cart' | 'all';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

@Injectable()
export class CaslAbilityFactory {
  createForUser(user: AuthenticatedUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (user.role === UserRole.manager) {
      // Disable is a PATCH writing `status`, covered by `update` — not a
      // separate CASL action.
      can('manage', 'Category');
      can('manage', 'Product');
      can('manage', 'Sku');
    } else {
      can('read', 'Category');
      can('read', 'Product');
      can('read', 'Sku');

      // Cart is client-only — a manager has no ability on it at all (not
      // even read), and delivery_person falls through this branch too but
      // gets nothing extra: neither role ever needs another user's cart.
      if (user.role === UserRole.client) {
        can('manage', 'Cart');
      }
    }

    return build();
  }
}
