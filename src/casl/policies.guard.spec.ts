import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { buildClientUser } from '../test-utils/user-fixtures';
import { AppAbility, CaslAbilityFactory } from './casl-ability.factory';
import { CHECK_POLICIES_KEY } from './check-policies.decorator';
import { PoliciesGuard } from './policies.guard';
import { PolicyHandler } from './policy-handler';

describe('PoliciesGuard', () => {
  let guard: PoliciesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let caslAbilityFactory: { createForUser: jest.Mock };

  const fakeAbility = {} as AppAbility;

  // A minimal fake ExecutionContext — canActivate only calls getHandler(),
  // getClass() and switchToHttp().getRequest().
  function fakeContext(user: unknown): ExecutionContext {
    return {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  // Same shape, but hands back the exact handler/class references passed
  // in — needed when a test attaches metadata to specific targets and must
  // have getHandler()/getClass() resolve to those same references.
  function fakeContextWithTargets(
    handlerFn: object,
    classFn: object,
    user: unknown,
  ): ExecutionContext {
    return {
      getHandler: () => handlerFn,
      getClass: () => classFn,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
  }

  // Attaches metadata the same way @CheckPolicies/SetMetadata does
  // (Reflect.defineMetadata under the target, no descriptor) without
  // fighting the MethodDecorator/ClassDecorator call-signature typing for a
  // plain test double.
  function attachCheckPolicies(
    target: object,
    handlers: PolicyHandler[],
  ): void {
    Reflect.defineMetadata(CHECK_POLICIES_KEY, handlers, target);
  }

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() };
    caslAbilityFactory = { createForUser: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        PoliciesGuard,
        { provide: Reflector, useValue: reflector },
        { provide: CaslAbilityFactory, useValue: caslAbilityFactory },
      ],
    }).compile();

    guard = module.get(PoliciesGuard);
  });

  // The regression this guard actually hit: @CheckPolicies applied at the
  // class level was silently never read when the guard only checked
  // context.getHandler() — a client request went on to create a SKU.
  // getAllAndOverride([handler, class]) is what fixes it; these tests are
  // here specifically to keep that fixed.
  //
  // Both use a real Reflector (not the jest.fn() mock above): a mocked
  // getAllAndOverride would just echo back whatever we tell it to,
  // regardless of which targets the guard actually passed in, so it can't
  // prove precedence. The real Reflector.getAllAndOverride walks its
  // `targets` argument in order and returns the first defined match, so
  // these tests genuinely exercise "handler metadata wins" / "class
  // metadata is used as fallback".
  it('reads metadata from getHandler() when present (method-level @CheckPolicies)', () => {
    const handlerFn = function handler() {};
    const classFn = class Controller {};
    const policyHandler: PolicyHandler = jest.fn().mockReturnValue(true);
    attachCheckPolicies(handlerFn, [policyHandler]);

    caslAbilityFactory.createForUser.mockReturnValue(fakeAbility);
    const realGuard = new PoliciesGuard(new Reflector(), caslAbilityFactory);

    const result = realGuard.canActivate(
      fakeContextWithTargets(handlerFn, classFn, buildClientUser()),
    );

    expect(result).toBe(true);
    expect(policyHandler).toHaveBeenCalledWith(fakeAbility);
  });

  it('reads metadata from getClass() when getHandler() has none (class-level @CheckPolicies)', () => {
    const handlerFn = function handler() {};
    const classFn = class Controller {};
    // Deliberately denies: if the guard regressed to reading only
    // getHandler(), this class-level handler would never run, policyHandlers
    // would default to [], and canActivate would return the open-by-default
    // `true` instead of `false`.
    const policyHandler: PolicyHandler = jest.fn().mockReturnValue(false);
    attachCheckPolicies(classFn, [policyHandler]);

    caslAbilityFactory.createForUser.mockReturnValue(fakeAbility);
    const realGuard = new PoliciesGuard(new Reflector(), caslAbilityFactory);

    const result = realGuard.canActivate(
      fakeContextWithTargets(handlerFn, classFn, buildClientUser()),
    );

    expect(result).toBe(false);
    expect(policyHandler).toHaveBeenCalledWith(fakeAbility);
  });

  it('returns true (no policies to check) when neither handler nor class has metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    caslAbilityFactory.createForUser.mockReturnValue(fakeAbility);

    const result = guard.canActivate(fakeContext(buildClientUser()));

    expect(result).toBe(true);
  });

  it("returns false when any policy handler's ability.can(...) check fails", () => {
    const allow: PolicyHandler = jest.fn().mockReturnValue(true);
    const deny: PolicyHandler = jest.fn().mockReturnValue(false);
    reflector.getAllAndOverride.mockReturnValue([allow, deny]);
    caslAbilityFactory.createForUser.mockReturnValue(fakeAbility);

    const result = guard.canActivate(fakeContext(buildClientUser()));

    expect(result).toBe(false);
    expect(allow).toHaveBeenCalledWith(fakeAbility);
    expect(deny).toHaveBeenCalledWith(fakeAbility);
  });
});
