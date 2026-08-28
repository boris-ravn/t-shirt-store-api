import { Injectable } from '@nestjs/common';
import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility,
} from '@casl/ability';
import { UserRole } from '../generated/prisma/enums';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';

// Subjects this week: Category/Product/Sku, the catalog's manager-gated
// surface. Order/Cart/PromoCode arrive in Week 4 alongside the features
// that need them — no ability is defined for a subject with no code behind
// it yet.
export type AppAction = 'manage' | 'create' | 'read' | 'update' | 'delete';
export type AppSubject = 'Category' | 'Product' | 'Sku' | 'all';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

@Injectable()
export class CaslAbilityFactory {
  createForUser(user: AuthenticatedUser): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (user.role === UserRole.manager) {
      // "Manage all products (create, read, update, delete, disable)" —
      // disable is a PATCH writing `status`, covered by `update`, not a
      // separate CASL action. Category/Sku are catalog sub-resources under
      // the same manager-only rule, not named individually by the
      // challenge brief but treated the same way for precision.
      can('manage', 'Category');
      can('manage', 'Product');
      can('manage', 'Sku');
    } else {
      can('read', 'Category');
      can('read', 'Product');
      can('read', 'Sku');
    }

    return build();
  }
}
