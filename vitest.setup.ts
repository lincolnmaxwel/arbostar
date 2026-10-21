import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

// The robot check is off by default in tests, whatever the local .env holds
// (tests that need it set TURNSTILE_SECRET_KEY themselves).
process.env.TURNSTILE_SECRET_KEY = ''; // empty (not deleted): Prisma re-reads .env on import and would fill a missing var
