import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route (or an entire controller) as exempt from SessionAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
