import createMiddleware from 'next-intl/middleware';
import { locales } from './i18n.js';

export default createMiddleware({
  locales,
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
