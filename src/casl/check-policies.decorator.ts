import { SetMetadata } from '@nestjs/common';
import { PolicyHandler } from './policy-handler';

export const CHECK_POLICIES_KEY = 'check_policies';

// @CheckPolicies((ability) => ability.can('manage', 'Product')) — always
// paired with @UseGuards(JwtAuthGuard, PoliciesGuard): this decorator only
// supplies metadata for PoliciesGuard to read, it doesn't authenticate on
// its own.
export const CheckPolicies = (
  ...handlers: PolicyHandler[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);
