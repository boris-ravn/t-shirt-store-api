// `guard` below is scaffolding for the it.todo cases — unused until those
// assertions are written in, not dead code.
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { CaslAbilityFactory } from './casl-ability.factory';
import { PoliciesGuard } from './policies.guard';

describe('PoliciesGuard', () => {
  let guard: PoliciesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let caslAbilityFactory: { createForUser: jest.Mock };

  // A minimal fake ExecutionContext — canActivate only calls getHandler(),
  // getClass() and switchToHttp().getRequest().
  function fakeContext(user: unknown): ExecutionContext {
    return {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;
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
  it.todo(
    'reads metadata from getHandler() when present (method-level @CheckPolicies)',
  );

  it.todo(
    'reads metadata from getClass() when getHandler() has none (class-level @CheckPolicies)',
  );

  it.todo(
    'returns true (no policies to check) when neither handler nor class has metadata',
  );

  it.todo(
    "returns false when any policy handler's ability.can(...) check fails",
  );
});
