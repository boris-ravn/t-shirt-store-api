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

      // Cart is client-only — manager and delivery_person get no ability
      // on it at all, not even read (decisions.md).
      if (user.role === UserRole.client) {
        can('manage', 'Cart');
      }
    }

    return build();
  }
}
