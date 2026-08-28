import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppAbility, CaslAbilityFactory } from './casl-ability.factory';
import { CHECK_POLICIES_KEY } from './check-policies.decorator';
import { PolicyHandler } from './policy-handler';
import { AuthenticatedUser } from '../common/types/authenticated-user.interface';

// Authorization only — always follows JwtAuthGuard in @UseGuards(), never
// used alone. A `false` return isn't handled specially here: Nest's own
// guard mechanism throws a plain ForbiddenException on a `false` return,
// which ProblemExceptionFilter's fallback already maps to the
// `insufficient-permissions` Problem.
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly caslAbilityFactory: CaslAbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride, not get(..., context.getHandler()) alone: a
    // method-level @CheckPolicies wins if present, but a class-level one is
    // still read as a fallback instead of being silently treated as [].
    const policyHandlers =
      this.reflector.getAllAndOverride<PolicyHandler[]>(CHECK_POLICIES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const request = context
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    const ability = this.caslAbilityFactory.createForUser(request.user);

    return policyHandlers.every((handler) =>
      this.execPolicyHandler(handler, ability),
    );
  }

  private execPolicyHandler(
    handler: PolicyHandler,
    ability: AppAbility,
  ): boolean {
    if (typeof handler === 'function') {
      return handler(ability);
    }
    return handler.handle(ability);
  }
}
