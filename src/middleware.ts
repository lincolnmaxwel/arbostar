import { withAuth } from 'next-auth/middleware';
import { authOptions } from '@/lib/auth';

// Bare `export { default } from 'next-auth/middleware'` doesn't know about
// our custom /login page — it redirects unauthenticated requests to
// NextAuth's own built-in /api/auth/signin instead, which is not something
// this app renders correctly (no styling, and it 500s if NEXTAUTH_SECRET
// isn't set in the deploy environment). Passing authOptions.pages here
// keeps the redirect target in sync with the actual sign-in page.
export default withAuth({
  pages: authOptions.pages,
});

export const config = { matcher: ['/quotes/:path*', '/profile/:path*'] };
