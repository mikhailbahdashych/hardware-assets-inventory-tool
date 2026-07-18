import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Exempts a route (or controller) from the global JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
