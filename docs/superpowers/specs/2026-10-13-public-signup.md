# Public sign-up with free trial, Terms of Service and Privacy Policy

Owner: Maestro (Claude Code). Implementers: Programmer (backend) and Frontend Designer (UI).
All user-facing text MUST be English (project rule in CLAUDE.md). Commit/push is done by the Git Manager
after the Maestro has verified (`tsc`, lint, tests) - implementers must NOT commit or push.

## Goal

Anyone can create an account from the landing page, verify their email, and start the admin-configured
free trial (`trial_days`, see `src/lib/billing.ts`), without an admin invitation. Terms of Service and
Privacy Policy exist as public pages and acceptance is recorded.

## Flow

1. Landing `/` -> "Start free trial" -> `/signup`: name, email, "I agree to the Terms and Privacy Policy" checkbox.
2. `POST /api/signup` stores a `PendingSignup` and emails a one-time link `/signup/verify/<token>` (valid 24 h).
   The page then shows "Check your email".
3. `/signup/verify/<token>`: user chooses a password (same fields/validation as `AcceptInviteForm`),
   `POST /api/signup/verify/<token>` creates the real user (trial starts now) and the browser signs in and goes to `/quotes`.

No password is stored for an unverified signup. No user row exists until the email is verified, so nobody
can burn a trial on someone else's address.

## Data model (Programmer)

- Prisma `PendingSignup`: `id uuid`, `email` (lowercased), `name`, `tokenHash` (unique, SHA-256 of token),
  `termsVersion`, `expiresAt`, `acceptedAt?`, `createdAt`. Index on `email`. No FK to User (same pattern as `UserInvite`).
- `User.termsAcceptedAt DateTime?` and `User.termsVersion String?`. Existing users stay null.
- Migration folder `prisma/migrations/20261015000000_add_public_signup/`.
- `src/lib/legal.ts`: `TERMS_VERSION = '2026-10-13'`, `SUPPORT_EMAIL = 'support@myjobbs.com'`,
  `LEGAL_LAST_UPDATED = 'October 13, 2026'`. UI imports these; do not hardcode them elsewhere.
- Extend `deleteUserCascade` (`src/lib/cascadeDelete.ts`) to delete `PendingSignup` rows for the user's email.

## API contract (Programmer implements, Frontend consumes)

`POST /api/signup` (public, outside the middleware matcher)
- Body: `{ name: string, email: string, acceptTerms: true, website?: string }`.
  `website` is a honeypot: if non-empty return the generic 200 and do nothing.
- Validation 400 `{ error }`: name 2-100 chars; email valid, <= 254; `acceptTerms !== true` -> "You must accept the Terms and Privacy Policy."
- Always 200 `{ ok: true, message }` with the SAME message otherwise, whether or not the email already has an account
  (no account enumeration): "If this email can be used to create an account, a verification link is on its way."
  - Email already has a User -> send nothing.
  - A `PendingSignup` for that email was created < 10 minutes ago -> send nothing.
  - Otherwise: delete older pending rows for that email, create one, send `sendSignupVerificationEmail`.
    If the email send throws, delete the row and still answer 200.
- Email is lowercased + trimmed before storing.

`POST /api/signup/verify/[token]` (public)
- Body: `{ password: string, name?: string }`. Password 6-200 chars (400 otherwise).
- Token states like invites: 404 invalid, 410 expired/used. 409 if a user with that email exists meanwhile.
- In ONE transaction: burn the token (`updateMany ... acceptedAt: null`, count must be 1), create the `User`
  (`role: 'staff'`, `status: 'active'`, `trialEndsAt: await trialEndsAtForNewUser()`, `termsAcceptedAt: now`,
  `termsVersion` from the pending row, feature flags = the same default set an admin-created staff user gets -
  inspect `src/app/api/admin/users/route.ts` and reuse its default list, all four features enabled), write an `AuditLog`
  (`action: 'self-signup'`, `actorId` = new user id).
- 201 `{ ok: true, email }`.

`src/lib/signups.ts`: `generateSignupToken`, `hashSignupToken`, `lookupSignup(token)` -> `{state:'valid',signup}|{state:'invalid'|'expired'|'used'}`,
`signupVerifyUrl(token)` (`${appBaseUrl()}/signup/verify/${token}`), `SIGNUP_TTL_HOURS = 24`, `SIGNUP_COOLDOWN_MINUTES = 10`.
Mirror `src/lib/invites.ts`.

`sendSignupVerificationEmail({ to, name, verifyUrl, expiresInHours })` in `src/lib/email.ts`, wrapped by `emailLayout()`,
same visual style as `sendInviteEmail` / `sendPasswordResetEmail`.

## UI (Frontend Designer)

Reuse `src/app/login/login.module.css` (card, field, input, button, links, success, error) so pages match login.

- `src/app/signup/page.tsx` + `src/components/SignupForm.tsx`: name, email, terms checkbox with links to `/terms` and `/privacy`
  (open in a new tab), hidden honeypot input named `website` (visually hidden, `tabIndex=-1`, `autoComplete="off"`, `aria-hidden`).
  On success replace the form with the message from the API. Show trial length is NOT required (it is configurable); say
  "Start your free trial" generically. Link "Already have an account? Sign in".
- `src/app/signup/verify/[token]/page.tsx` (`force-dynamic`, server component using `lookupSignup`) + `src/components/VerifySignupForm.tsx`
  modelled on `AcceptInviteForm.tsx`; after success `signIn('credentials', { email, password, redirect: false })` then `window.location.href = '/quotes'`.
  Problem states (invalid/expired/used) get a clear message and a link to `/signup` or `/login`.
- `src/app/terms/page.tsx` and `src/app/privacy/page.tsx`: readable static pages (logo header, "Last updated", sections, back-to-home link).
  Content is a reasonable SaaS template for MyJobbs (service for tree-service/field-service businesses to build quotes,
  invoices, timesheets): Terms - acceptance, accounts and security (one device at a time), free trial and subscription billing via Stripe,
  cancellation, acceptable use, user data ownership, availability/no warranty, liability limit, changes, contact. Privacy - what is collected
  (account data, business data the user enters including their clients' contact details, usage/logs), purpose, processors (hosting, Stripe for
  payments, Resend for email), retention, user rights incl. access/deletion on request (Canadian PIPEDA wording is fine, no legal-entity name:
  say "MyJobbs"), security, cookies (session cookie only), contact via `SUPPORT_EMAIL`. Add a visible line at the top of each:
  none (do NOT put "this is a draft" text in the UI); the Maestro will tell the owner to have a lawyer review it.
- Landing `src/app/page.tsx`: add a primary "Start free trial" call to action (hero and wherever "Sign in" CTAs exist), plus a footer with
  Terms / Privacy links. Keep existing look.
- Login page: add "Create an account" link to `/signup`, and small footer links to Terms/Privacy.
- Responsive at 360px width, accessible labels, no new dependencies.

## File ownership (avoid conflicts - both agents work in the same checkout)

- Programmer: `prisma/**`, `src/lib/**`, `src/app/api/**`, `tests/**`, `CLAUDE.md`.
- Frontend Designer: `src/app/signup/**`, `src/app/terms/**`, `src/app/privacy/**`, `src/app/page.tsx`, `src/app/login/**`,
  `src/components/**` (new files for signup only).
- The Frontend Designer may import `lookupSignup` from `@/lib/signups`; the Programmer creates it FIRST and tells the Frontend Designer
  (via `maestri ask`) when `src/lib/signups.ts` and `src/lib/legal.ts` exist.

## Tests (Programmer)

`tests/integration/public-signup-api.test.ts`, mocking `@/lib/email` like `password-reset-api.test.ts`: signup sends one email and answers
identically for existing/new/cooldown; honeypot sends nothing; missing consent 400; verify creates user with trial + terms fields + features,
token single-use (410), expired (410), invalid (404), existing email (409). Clean up created rows.

## Definition of done

`npx tsc --noEmit`, `npx next lint` clean; new tests pass; no new failures vs the known baseline (timesheetClient x5, per-user-isolation x1,
flaky QuotesListPage). CLAUDE.md gets a short "Public sign-up" section (Programmer). Report back with the list of files changed.
