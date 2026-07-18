import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@inventory/shared';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

function contextFor(role: string | undefined, required?: UserRole[]): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () =>
        role === undefined ? {} : { user: { role, userId: 'u', email: 'e', mcp: false } },
    }),
    __required: required,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  function guardWith(required?: UserRole[]): RolesGuard {
    const reflector = {
      getAllAndOverride: () => required,
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }
  void ROLES_KEY;

  it('passes when no roles metadata is present', () => {
    expect(guardWith(undefined).canActivate(contextFor('viewer'))).toBe(true);
  });

  it.each([
    [UserRole.ADMIN, [UserRole.ADMIN], true],
    [UserRole.MANAGER, [UserRole.ADMIN], false],
    [UserRole.VIEWER, [UserRole.ADMIN], false],
    [UserRole.MANAGER, [UserRole.ADMIN, UserRole.MANAGER], true],
    [UserRole.VIEWER, [UserRole.ADMIN, UserRole.MANAGER], false],
    [UserRole.VIEWER, [UserRole.ADMIN, UserRole.MANAGER, UserRole.VIEWER], true],
  ])('role %s against %j → allowed=%s', (role, required, allowed) => {
    const guard = guardWith(required);
    if (allowed) {
      expect(guard.canActivate(contextFor(role))).toBe(true);
    } else {
      expect(() => guard.canActivate(contextFor(role))).toThrow(ForbiddenException);
    }
  });

  it('fails closed when roles are required but no user is attached', () => {
    expect(() => guardWith([UserRole.ADMIN]).canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('still passes user-less requests when no roles are required', () => {
    expect(guardWith(undefined).canActivate(contextFor(undefined))).toBe(true);
  });
});
