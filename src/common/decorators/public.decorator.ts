import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_SITE_PUBLIC_KEY = 'isSitePublic';
export const SITE_PUBLIC_ANONYMOUS_USER_ID = '__site_public__';

export const SitePublic = () => SetMetadata(IS_SITE_PUBLIC_KEY, true);

export const isSitePublicAnonymousUserId = (
  userId: string | null | undefined,
): userId is typeof SITE_PUBLIC_ANONYMOUS_USER_ID => userId === SITE_PUBLIC_ANONYMOUS_USER_ID;
