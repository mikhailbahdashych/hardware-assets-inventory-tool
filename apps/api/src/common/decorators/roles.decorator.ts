import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@inventory/shared';

export const ROLES_KEY = 'roles';

/** Restricts a route (or controller) to the given roles. No decorator = any authenticated user. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
