# Core Data Model + Offline Quote Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the internal quote-builder (staff login, client/quote/photo data model, offline-first drafts with guaranteed sync) as specified in `docs/superpowers/specs/2026-07-05-core-quote-builder-offline-design.md`.

**Architecture:** Single Next.js 14 (App Router) app, Postgres+Prisma for persistence, NextAuth credentials for staff login, Dexie/IndexedDB as the client-side source of truth for in-progress quotes with an outbox queue that syncs to the server once real connectivity is confirmed.

**Tech Stack:** TypeScript, Next.js 14, Prisma 5 + PostgreSQL, NextAuth 4, Dexie 4, Zod, Vitest + fake-indexeddb + Testing Library, Playwright.

## Global Constraints

- Node.js 20+, TypeScript strict mode.
- Next.js App Router only, code lives under `src/`.
- Single-tenant: no multi-company isolation anywhere in the schema.
- No payment gateway in this phase.
- Photos stored under `public/uploads/quotes/{quoteId}/`, served as static files — not object storage.
- Client-facing portal, order/scheduling, and invoicing are out of scope (separate future plans); `Quote.status` and `Quote.publicToken` exist now so those phases don't require a schema rewrite.
- Outbox sync must dedupe by client-generated `draftId` — retries must never create duplicate server-side quotes.
- Connectivity check before syncing must be a real request to the server, not just `navigator.onLine`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.js`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`

**Interfaces:**
- Produces: path alias `@/*` → `src/*`, used by every later task's imports.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "arbostar",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  },
  "prisma": {
    "seed": "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts"
  },
  "dependencies": {
    "next": "14.2.35",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@prisma/client": "5.18.0",
    "next-auth": "4.24.7",
    "bcryptjs": "2.4.3",
    "dexie": "4.0.8",
    "dexie-react-hooks": "1.1.7",
    "zod": "3.23.8",
    "next-pwa": "5.6.0"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "ts-node": "10.9.2",
    "@types/node": "20.14.15",
    "@types/react": "18.3.3",
    "@types/react-dom": "18.3.0",
    "@types/bcryptjs": "2.4.6",
    "prisma": "5.18.0",
    "vitest": "1.6.0",
    "fake-indexeddb": "6.0.0",
    "jsdom": "24.1.1",
    "@testing-library/react": "14.3.1",
    "@playwright/test": "1.45.3",
    "eslint": "8.57.0",
    "eslint-config-next": "14.2.35"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.js`**

```js
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
});

module.exports = withPWA({
  reactStrictMode: true,
});
```

- [ ] **Step 4: Write `.env.example`**

```
DATABASE_URL="postgresql://user:password@localhost:5432/arbostar"
DATABASE_URL_TEST="postgresql://user:password@localhost:5432/arbostar_test"
NEXTAUTH_SECRET="change-me"
NEXTAUTH_URL="http://localhost:3000"
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules
.next
.env
/public/uploads
/test-results
/playwright-report
```

- [ ] **Step 6: Write `src/app/layout.tsx`**

```tsx
export const metadata = {
  title: 'Arbostar Quotes',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#2c5f2d" />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Write `src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/quotes');
}
```

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
```

- [ ] **Step 9: Write `vitest.setup.ts`**

```ts
import 'fake-indexeddb/auto';
```

- [ ] **Step 10: Install dependencies**

Run: `npm install`
Expected: install completes with no error, `node_modules` created.

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json next.config.js .env.example .gitignore src vitest.config.ts vitest.setup.ts
git commit -m "chore: scaffold Next.js project"
```

---

### Task 2: Prisma schema and client

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var (Task 1).
- Produces: `prisma` singleton from `@/lib/db`, and generated `@prisma/client` types (`User`, `Client`, `Quote`, `QuoteItem`, `QuotePhoto`, `ServiceCatalogItem`, `AuditLog`, `Role`, `QuoteStatus`) used by every later task.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  admin
  staff
}

enum QuoteStatus {
  draft
  sent
  approved
  declined
  expired
}

model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role     @default(staff)
  createdAt    DateTime @default(now())
  quotes       Quote[]
}

model Client {
  id      String  @id @default(uuid())
  name    String
  email   String
  phone   String?
  address String?
  quotes  Quote[]
}

model ServiceCatalogItem {
  id           String  @id @default(uuid())
  name         String
  defaultPrice Decimal @db.Decimal(10, 2)
}

model Quote {
  id          String      @id @default(uuid())
  number      Int         @unique @default(autoincrement())
  revision    Int         @default(1)
  status      QuoteStatus @default(draft)
  draftId     String      @unique
  clientId    String
  client      Client      @relation(fields: [clientId], references: [id])
  createdById String
  createdBy   User        @relation(fields: [createdById], references: [id])
  subtotal    Decimal     @db.Decimal(10, 2) @default(0)
  taxRate     Decimal     @db.Decimal(5, 4) @default(0)
  taxAmount   Decimal     @db.Decimal(10, 2) @default(0)
  total       Decimal     @db.Decimal(10, 2) @default(0)
  publicToken String      @unique @default(uuid())
  sentAt      DateTime?
  respondedAt DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  items       QuoteItem[]
}

model QuoteItem {
  id          String       @id @default(uuid())
  quoteId     String
  quote       Quote        @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  localItemId String       @unique
  title       String
  description String?
  price       Decimal      @db.Decimal(10, 2)
  sortOrder   Int          @default(0)
  photos      QuotePhoto[]
}

model QuotePhoto {
  id          String    @id @default(uuid())
  quoteItemId String
  quoteItem   QuoteItem @relation(fields: [quoteItemId], references: [id], onDelete: Cascade)
  filePath    String
  sortOrder   Int       @default(0)
}

model AuditLog {
  id         String   @id @default(uuid())
  entityType String
  entityId   String
  action     String
  actorId    String?
  createdAt  DateTime @default(now())
}
```

- [ ] **Step 2: Write `src/lib/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 3: Create the database and run the migration**

Run: `npx prisma migrate dev --name init`
Expected: output ends with "Your database is now in sync with your schema."

- [ ] **Step 4: Commit**

```bash
git add prisma src/lib/db.ts
git commit -m "feat: add Prisma schema and client singleton"
```

---

### Task 3: Staff authentication

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Create: `prisma/seed.ts`
- Test: `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db` (Task 2).
- Produces: `authOptions` and `verifyCredentials(email, password)` from `@/lib/auth`, used by API routes in Tasks 7–8 via `getServerSession(authOptions)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/auth.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { verifyCredentials } from '@/lib/auth';

describe('verifyCredentials', () => {
  const email = 'auth-test@example.com';

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 10);
    await prisma.user.create({
      data: { name: 'Auth Test', email, passwordHash, role: 'staff' },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { email } });
  });

  it('returns the user for correct credentials', async () => {
    const user = await verifyCredentials(email, 'correct-horse');
    expect(user?.email).toBe(email);
  });

  it('returns null for wrong password', async () => {
    const user = await verifyCredentials(email, 'wrong-password');
    expect(user).toBeNull();
  });

  it('returns null for unknown email', async () => {
    const user = await verifyCredentials('nobody@example.com', 'whatever');
    expect(user).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — `verifyCredentials` not exported from `@/lib/auth` (module doesn't exist yet).

- [ ] **Step 3: Write `src/lib/auth.ts`**

```ts
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        return verifyCredentials(credentials.email, credentials.password);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string; role?: string }).id = token.id as string;
        (session.user as { id?: string; role?: string }).role = token.role as string;
      }
      return session;
    },
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: PASS (3 tests). Requires `DATABASE_URL` pointed at a running Postgres instance with migrations applied (Task 2, Step 3).

- [ ] **Step 5: Write `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

- [ ] **Step 6: Write `src/middleware.ts`**

```ts
export { default } from 'next-auth/middleware';

export const config = { matcher: ['/quotes/:path*'] };
```

- [ ] **Step 7: Write `src/app/login/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await signIn('credentials', { email, password, redirect: false });
    if (result?.error) {
      setError('Invalid email or password');
      return;
    }
    router.push('/quotes');
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="password">Password</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign in</button>
    </form>
  );
}
```

- [ ] **Step 8: Write `prisma/seed.ts`**

```ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('changeme123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@tiptoptreesltd.com' },
    update: {},
    create: { name: 'Admin', email: 'admin@tiptoptreesltd.com', passwordHash, role: 'admin' },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 9: Run the seed**

Run: `npx prisma db seed`
Expected: no error; a `User` row with email `admin@tiptoptreesltd.com` exists (verify with `npx prisma studio` or a `SELECT`).

- [ ] **Step 10: Commit**

```bash
git add src/lib/auth.ts src/app/api/auth src/middleware.ts src/app/login prisma/seed.ts tests/integration/auth.test.ts
git commit -m "feat: add staff credentials auth"
```

---

### Task 4: Quote totals math

**Files:**
- Create: `src/lib/quoteMath.ts`
- Test: `tests/unit/quoteMath.test.ts`

**Interfaces:**
- Produces: `calculateTotals(items: {price: number}[], taxRate: number): {subtotal: number, taxAmount: number, total: number}` — used by the API route (Task 7) and the quote builder UI (Task 10).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/quoteMath.test.ts
import { describe, it, expect } from 'vitest';
import { calculateTotals } from '@/lib/quoteMath';

describe('calculateTotals', () => {
  it('computes subtotal, tax, and total', () => {
    const result = calculateTotals([{ price: 1250 }, { price: 500 }], 0.05);
    expect(result).toEqual({ subtotal: 1750, taxAmount: 87.5, total: 1837.5 });
  });

  it('handles an empty item list', () => {
    expect(calculateTotals([], 0.05)).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/quoteMath.test.ts`
Expected: FAIL — `@/lib/quoteMath` does not exist.

- [ ] **Step 3: Write `src/lib/quoteMath.ts`**

```ts
export interface QuoteLineItem {
  price: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateTotals(items: QuoteLineItem[], taxRate: number) {
  const subtotal = round2(items.reduce((sum, item) => sum + item.price, 0));
  const taxAmount = round2(subtotal * taxRate);
  const total = round2(subtotal + taxAmount);
  return { subtotal, taxAmount, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/quoteMath.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/quoteMath.ts tests/unit/quoteMath.test.ts
git commit -m "feat: add quote totals calculation"
```

---

### Task 5: Local IndexedDB schema (Dexie)

**Files:**
- Create: `src/lib/localDb.ts`
- Test: `tests/unit/localDb.test.ts`

**Interfaces:**
- Produces: `localDb` (Dexie instance) with tables `drafts` (`DraftQuote`), `photos` (`DraftPhoto`), `outbox` (`OutboxEntry`); and the types `DraftQuote`, `DraftQuoteItem`, `DraftPhoto`, `OutboxEntry`. Used by Tasks 6, 9, 10, 11, 13.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/localDb.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { localDb } from '@/lib/localDb';

describe('localDb drafts table', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
  });

  it('writes and reads back a draft', async () => {
    await localDb.drafts.put({
      draftId: 'draft-1',
      clientName: 'Nelson Costa',
      clientEmail: 'nelson@example.com',
      items: [],
      taxRate: 0.05,
      status: 'local',
      updatedAt: Date.now(),
    });
    const saved = await localDb.drafts.get('draft-1');
    expect(saved?.clientName).toBe('Nelson Costa');
    expect(saved?.status).toBe('local');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/localDb.test.ts`
Expected: FAIL — `@/lib/localDb` does not exist.

- [ ] **Step 3: Write `src/lib/localDb.ts`**

```ts
import Dexie, { Table } from 'dexie';

export interface DraftQuoteItem {
  id: string;
  serverItemId?: string;
  title: string;
  description?: string;
  price: number;
  photoIds: string[];
}

export interface DraftQuote {
  draftId: string;
  serverId?: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  clientAddress?: string;
  items: DraftQuoteItem[];
  taxRate: number;
  status: 'local' | 'syncing' | 'synced' | 'error';
  updatedAt: number;
}

export interface DraftPhoto {
  id: string;
  draftId: string;
  blob: Blob;
  fileName: string;
  status: 'pending' | 'uploaded';
}

export interface OutboxEntry {
  id?: number;
  draftId: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt: number;
  createdAt: number;
}

class LocalDb extends Dexie {
  drafts!: Table<DraftQuote, string>;
  photos!: Table<DraftPhoto, string>;
  outbox!: Table<OutboxEntry, number>;

  constructor() {
    super('arbostar');
    this.version(1).stores({
      drafts: 'draftId, status, updatedAt',
      photos: 'id, draftId',
      outbox: '++id, draftId, nextAttemptAt',
    });
  }
}

export const localDb = new LocalDb();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/localDb.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/localDb.ts tests/unit/localDb.test.ts
git commit -m "feat: add Dexie local database schema"
```

---

### Task 6: Outbox queue (enqueue, dedupe, backoff, stuck-entry handling)

**Files:**
- Create: `src/lib/outbox.ts`
- Test: `tests/unit/outbox.test.ts`

**Interfaces:**
- Consumes: `localDb` from `@/lib/localDb` (Task 5).
- Produces: `enqueueSync(draftId)`, `nextBackoffDelay(attempts)`, `recordFailure(entryId, error)`, `markStuck(entryId, error)`, `retryStuckEntry(entryId)`, `clearEntry(entryId)`, `dueEntries()`, `getEntryForDraft(draftId)` — used by the sync worker (Task 9) and the builder UI (Task 13).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/outbox.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { localDb } from '@/lib/localDb';
import {
  enqueueSync,
  nextBackoffDelay,
  recordFailure,
  markStuck,
  retryStuckEntry,
  clearEntry,
  dueEntries,
  getEntryForDraft,
} from '@/lib/outbox';

describe('outbox', () => {
  beforeEach(async () => {
    await localDb.outbox.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dedupes enqueue calls for the same draftId', async () => {
    await enqueueSync('draft-1');
    await enqueueSync('draft-1');
    const rows = await localDb.outbox.where('draftId').equals('draft-1').toArray();
    expect(rows).toHaveLength(1);
  });

  it('computes exponential backoff capped at 60s', () => {
    expect(nextBackoffDelay(0)).toBe(1000);
    expect(nextBackoffDelay(1)).toBe(2000);
    expect(nextBackoffDelay(6)).toBe(60000);
    expect(nextBackoffDelay(10)).toBe(60000);
  });

  it('recordFailure increments attempts and reschedules', async () => {
    await enqueueSync('draft-2');
    const entry = await getEntryForDraft('draft-2');
    await recordFailure(entry!.id!, 'network error');
    const updated = await getEntryForDraft('draft-2');
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBe('network error');
    expect(updated!.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it('markStuck stops the entry from being due, retryStuckEntry re-arms it', async () => {
    await enqueueSync('draft-3');
    const entry = await getEntryForDraft('draft-3');
    await markStuck(entry!.id!, 'conflict');
    expect(await dueEntries()).toHaveLength(0);
    await retryStuckEntry(entry!.id!);
    expect(await dueEntries()).toHaveLength(1);
  });

  it('clearEntry removes the row', async () => {
    await enqueueSync('draft-4');
    const entry = await getEntryForDraft('draft-4');
    await clearEntry(entry!.id!);
    expect(await getEntryForDraft('draft-4')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/outbox.test.ts`
Expected: FAIL — `@/lib/outbox` does not exist.

- [ ] **Step 3: Write `src/lib/outbox.ts`**

```ts
import { localDb, OutboxEntry } from '@/lib/localDb';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
const STUCK_DELAY_MS = Number.MAX_SAFE_INTEGER;

export async function enqueueSync(draftId: string): Promise<void> {
  const existing = await getEntryForDraft(draftId);
  if (existing) {
    await localDb.outbox.update(existing.id!, { nextAttemptAt: Date.now() });
    return;
  }
  await localDb.outbox.add({
    draftId,
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
}

export function nextBackoffDelay(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
}

export async function recordFailure(entryId: number, error: string): Promise<void> {
  const entry = await localDb.outbox.get(entryId);
  if (!entry) return;
  const attempts = entry.attempts + 1;
  await localDb.outbox.update(entryId, {
    attempts,
    lastError: error,
    nextAttemptAt: Date.now() + nextBackoffDelay(attempts),
  });
}

export async function markStuck(entryId: number, error: string): Promise<void> {
  await localDb.outbox.update(entryId, { lastError: error, nextAttemptAt: STUCK_DELAY_MS });
}

export async function retryStuckEntry(entryId: number): Promise<void> {
  await localDb.outbox.update(entryId, { nextAttemptAt: Date.now(), attempts: 0 });
}

export async function clearEntry(entryId: number): Promise<void> {
  await localDb.outbox.delete(entryId);
}

export async function dueEntries(): Promise<OutboxEntry[]> {
  const now = Date.now();
  return localDb.outbox.filter((e) => e.nextAttemptAt <= now).toArray();
}

export async function getEntryForDraft(draftId: string): Promise<OutboxEntry | undefined> {
  return localDb.outbox.where('draftId').equals(draftId).first();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/outbox.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/outbox.ts tests/unit/outbox.test.ts
git commit -m "feat: add offline outbox queue with backoff and stuck-entry handling"
```

---

### Task 7: Quotes API (create/upsert, list, optimistic-lock conflict)

**Files:**
- Create: `src/app/api/quotes/route.ts`
- Test: `tests/integration/quotes-api.test.ts`

**Interfaces:**
- Consumes: `prisma` (Task 2), `authOptions` (Task 3), `calculateTotals` (Task 4).
- Produces: `POST /api/quotes` (body: `{draftId, clientName, clientEmail, clientPhone?, clientAddress?, taxRate, items: {localItemId, title, description?, price}[], clientUpdatedAt?}` → `201`/`200` with `{quote}` where `quote.items[]` each carry both `id` (server `QuoteItem.id`, stable target for photo uploads) and `localItemId`, or `409` with `{error:'conflict', serverUpdatedAt}` on stale write) and `GET /api/quotes` (→ `{quotes}`). Consumed by the sync worker (Task 9).
- Note: items are reconciled by `localItemId` (matched, updated, or created) rather than deleted and recreated on every update — this keeps `QuoteItem.id` stable across syncs so `QuotePhoto` rows (which cascade-delete with their `QuoteItem`) are never orphaned by a routine text-only resync.

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/quotes-api.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { POST, GET } from '@/app/api/quotes/route';
import { prisma } from '@/lib/db';

describe('/api/quotes', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Test Staff', email: `staff-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({ where: { createdById: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('creates a quote on first POST and updates (not duplicates) on retry with the same draftId', async () => {
    const draftId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    const payload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      taxRate: 0.05,
      items: [
        { localItemId: itemA, title: 'Hedges', price: 1250 },
        { localItemId: itemB, title: 'Hedges', price: 500 },
      ],
    };

    const res1 = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payload) }) as any);
    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    expect(Number(body1.quote.total)).toBe(1837.5);
    const firstItemIds = body1.quote.items.map((i: { id: string }) => i.id).sort();

    const res2 = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(payload) }) as any);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    const secondItemIds = body2.quote.items.map((i: { id: string }) => i.id).sort();

    const count = await prisma.quote.count({ where: { draftId } });
    expect(count).toBe(1);
    expect(secondItemIds).toEqual(firstItemIds); // same QuoteItem rows reused, not recreated
  });

  it('drops an item that was removed from the payload and keeps the rest stable', async () => {
    const draftId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();
    const basePayload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      taxRate: 0.05,
      items: [
        { localItemId: itemA, title: 'Hedges', price: 1250 },
        { localItemId: itemB, title: 'Trim', price: 500 },
      ],
    };
    const res1 = await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(basePayload) }) as any);
    const body1 = await res1.json();
    const keptItemId = body1.quote.items.find((i: { localItemId: string }) => i.localItemId === itemA).id;

    const res2 = await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, items: [{ localItemId: itemA, title: 'Hedges', price: 1250 }] }),
      }) as any,
    );
    const body2 = await res2.json();
    expect(body2.quote.items).toHaveLength(1);
    expect(body2.quote.items[0].id).toBe(keptItemId);
  });

  it('returns 409 when clientUpdatedAt is older than the server row', async () => {
    const draftId = randomUUID();
    const basePayload = {
      draftId,
      clientName: 'Nelson Costa',
      clientEmail: `client-${draftId}@example.com`,
      taxRate: 0.05,
      items: [{ localItemId: randomUUID(), title: 'Hedges', price: 500 }],
    };
    await POST(new Request('http://localhost/api/quotes', { method: 'POST', body: JSON.stringify(basePayload) }) as any);

    const staleRes = await POST(
      new Request('http://localhost/api/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, clientUpdatedAt: 1 }),
      }) as any,
    );
    expect(staleRes.status).toBe(409);
  });

  it('lists quotes', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.quotes)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/quotes-api.test.ts`
Expected: FAIL — `@/app/api/quotes/route` does not exist.

- [ ] **Step 3: Write `src/app/api/quotes/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { calculateTotals } from '@/lib/quoteMath';

const quoteItemSchema = z.object({
  localItemId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  price: z.number().nonnegative(),
});

const upsertQuoteSchema = z.object({
  draftId: z.string().uuid(),
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  clientPhone: z.string().optional(),
  clientAddress: z.string().optional(),
  taxRate: z.number().min(0).max(1),
  items: z.array(quoteItemSchema).min(1),
  clientUpdatedAt: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = upsertQuoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const totals = calculateTotals(data.items, data.taxRate);

  const existing = await prisma.quote.findUnique({ where: { draftId: data.draftId } });
  if (existing && data.clientUpdatedAt !== undefined && existing.updatedAt.getTime() > data.clientUpdatedAt) {
    return NextResponse.json({ error: 'conflict', serverUpdatedAt: existing.updatedAt }, { status: 409 });
  }

  let client = await prisma.client.findFirst({ where: { email: data.clientEmail } });
  if (!client) {
    client = await prisma.client.create({
      data: { name: data.clientName, email: data.clientEmail, phone: data.clientPhone, address: data.clientAddress },
    });
  }

  const userId = (session.user as { id: string }).id;

  const quoteId = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.upsert({
      where: { draftId: data.draftId },
      create: {
        draftId: data.draftId,
        clientId: client.id,
        createdById: userId,
        subtotal: totals.subtotal,
        taxRate: data.taxRate,
        taxAmount: totals.taxAmount,
        total: totals.total,
      },
      update: {
        subtotal: totals.subtotal,
        taxRate: data.taxRate,
        taxAmount: totals.taxAmount,
        total: totals.total,
      },
    });

    // Reconcile items by localItemId instead of delete-all-recreate, so QuoteItem.id
    // stays stable across resyncs and previously uploaded QuotePhoto rows are never
    // orphaned by their QuoteItem's onDelete: Cascade.
    const existingItems = await tx.quoteItem.findMany({ where: { quoteId: quote.id } });
    const incomingLocalIds = new Set(data.items.map((i) => i.localItemId));
    const toDelete = existingItems.filter((ei) => !incomingLocalIds.has(ei.localItemId));
    for (const item of toDelete) {
      await tx.quoteItem.delete({ where: { id: item.id } });
    }
    for (const [index, item] of data.items.entries()) {
      await tx.quoteItem.upsert({
        where: { localItemId: item.localItemId },
        create: {
          localItemId: item.localItemId,
          quoteId: quote.id,
          title: item.title,
          description: item.description,
          price: item.price,
          sortOrder: index,
        },
        update: { title: item.title, description: item.description, price: item.price, sortOrder: index },
      });
    }

    return quote.id;
  });

  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  return NextResponse.json({ quote }, { status: existing ? 200 : 201 });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const quotes = await prisma.quote.findMany({
    include: { client: true, items: true },
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json({ quotes });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/quotes-api.test.ts`
Expected: PASS (3 tests). Requires a running Postgres with migrations applied.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/quotes/route.ts tests/integration/quotes-api.test.ts
git commit -m "feat: add quotes API with draftId dedupe and conflict detection"
```

---

### Task 8: Photo upload API

**Files:**
- Create: `src/app/api/quotes/photos/route.ts`
- Create: `src/lib/compressImage.ts`
- Test: `tests/integration/photos-api.test.ts`

**Interfaces:**
- Consumes: `prisma`, `authOptions`.
- Produces: `POST /api/quotes/photos` (multipart form: `quoteItemId`, `file`) → `201` with `{photo}`; files land at `public/uploads/quotes/{quoteId}/{uuid}.jpg`. `compressImage(blob, maxDimension?, quality?): Promise<Blob>` is wired into the builder UI in Task 14 — it requires browser `createImageBitmap`/`canvas` APIs unavailable in jsdom, so Task 14's unit tests mock it; the real implementation is exercised by the Playwright E2E test (Task 15).

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/photos-api.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { existsSync, rmSync } from 'fs';
import path from 'path';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/quotes/photos/route';
import { prisma } from '@/lib/db';

describe('/api/quotes/photos', () => {
  let userId: string;
  let quoteId: string;
  let quoteItemId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { name: 'Photo Test', email: `photo-${randomUUID()}@example.com`, passwordHash: 'x', role: 'staff' },
    });
    userId = user.id;
    const client = await prisma.client.create({ data: { name: 'Client', email: `client-${randomUUID()}@example.com` } });
    const quote = await prisma.quote.create({
      data: {
        draftId: randomUUID(),
        clientId: client.id,
        createdById: userId,
        items: { create: [{ title: 'Hedges', price: 100, sortOrder: 0 }] },
      },
      include: { items: true },
    });
    quoteId = quote.id;
    quoteItemId = quote.items[0].id;
    (getServerSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: { id: userId } });
  });

  afterAll(async () => {
    await prisma.quote.delete({ where: { id: quoteId } });
    await prisma.user.delete({ where: { id: userId } });
    const dir = path.join(process.cwd(), 'public', 'uploads', 'quotes', quoteId);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('stores the uploaded file and creates a QuotePhoto row', async () => {
    const form = new FormData();
    form.set('quoteItemId', quoteItemId);
    form.set('file', new Blob([Buffer.from([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), 'photo.jpg');
    const req = new Request('http://localhost/api/quotes/photos', { method: 'POST', body: form });

    const res = await POST(req as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.photo.filePath).toMatch(new RegExp(`^/uploads/quotes/${quoteId}/`));

    const filePath = path.join(process.cwd(), 'public', body.photo.filePath);
    expect(existsSync(filePath)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/photos-api.test.ts`
Expected: FAIL — `@/app/api/quotes/photos/route` does not exist.

- [ ] **Step 3: Write `src/app/api/quotes/photos/route.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const quoteItemId = formData.get('quoteItemId');
  const file = formData.get('file');
  if (typeof quoteItemId !== 'string' || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const item = await prisma.quoteItem.findUnique({ where: { id: quoteItemId } });
  if (!item) return NextResponse.json({ error: 'quote item not found' }, { status: 404 });

  const dir = path.join(process.cwd(), 'public', 'uploads', 'quotes', item.quoteId);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.jpg`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(dir, fileName), buffer);

  const photo = await prisma.quotePhoto.create({
    data: { quoteItemId, filePath: `/uploads/quotes/${item.quoteId}/${fileName}`, sortOrder: 0 },
  });

  return NextResponse.json({ photo }, { status: 201 });
}
```

- [ ] **Step 4: Write `src/lib/compressImage.ts`**

```ts
export async function compressImage(file: Blob, maxDimension = 1600, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('compression failed'))), 'image/jpeg', quality);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/integration/photos-api.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/quotes/photos src/lib/compressImage.ts tests/integration/photos-api.test.ts
git commit -m "feat: add photo upload API and client-side image compression"
```

---

### Task 9: Background sync worker

**Files:**
- Create: `src/app/api/health/route.ts`
- Create: `src/lib/syncWorker.ts`
- Test: `tests/unit/syncWorker.test.ts`

**Interfaces:**
- Consumes: `localDb` (Task 5), `dueEntries`/`recordFailure`/`markStuck`/`clearEntry` (Task 6).
- Produces: `runSyncCycle(): Promise<void>` and `startSyncLoop(intervalMs?): () => void` — used by the builder UI (Task 10) and the error-recovery UI (Task 13).

- [ ] **Step 1: Write `src/app/api/health/route.ts`**

```ts
import { NextResponse } from 'next/server';

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/syncWorker.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { enqueueSync, getEntryForDraft } from '@/lib/outbox';
import { runSyncCycle } from '@/lib/syncWorker';

describe('runSyncCycle', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
  });

  it('syncs a due draft successfully and clears the outbox entry', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d1');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 }) // /api/health HEAD
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ quote: { id: 'server-1', items: [] } }) }); // POST

    await runSyncCycle();

    const draft = await localDb.drafts.get('d1');
    expect(draft?.status).toBe('synced');
    expect(draft?.serverId).toBe('server-1');
    expect(await getEntryForDraft('d1')).toBeUndefined();
  });

  it('marks the draft as error and stops retrying on a 409 conflict', async () => {
    await localDb.drafts.put({
      draftId: 'd2', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d2');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 409 });

    await runSyncCycle();

    const draft = await localDb.drafts.get('d2');
    expect(draft?.status).toBe('error');
    const entry = await getEntryForDraft('d2');
    expect(entry?.nextAttemptAt).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('reschedules with backoff on a network error, without marking the draft as error', async () => {
    await localDb.drafts.put({
      draftId: 'd3', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d3');

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValueOnce(new Error('network down'));

    await runSyncCycle();

    const draft = await localDb.drafts.get('d3');
    expect(draft?.status).toBe('syncing');
    const entry = await getEntryForDraft('d3');
    expect(entry?.attempts).toBe(1);
    expect(entry!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(entry!.nextAttemptAt).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('does nothing when the health check fails (offline)', async () => {
    await localDb.drafts.put({
      draftId: 'd4', clientName: 'A', clientEmail: 'a@x.com', items: [], taxRate: 0.05, status: 'syncing', updatedAt: Date.now(),
    });
    await enqueueSync('d4');

    global.fetch = vi.fn().mockRejectedValueOnce(new Error('offline'));

    await runSyncCycle();

    const draft = await localDb.drafts.get('d4');
    expect(draft?.status).toBe('syncing');
    expect(await getEntryForDraft('d4')).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/syncWorker.test.ts`
Expected: FAIL — `@/lib/syncWorker` does not exist.

- [ ] **Step 4: Write `src/lib/syncWorker.ts`**

```ts
import { localDb } from '@/lib/localDb';
import { dueEntries, recordFailure, markStuck, clearEntry } from '@/lib/outbox';

async function isReallyOnline(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runSyncCycle(): Promise<void> {
  if (!(await isReallyOnline())) return;

  const entries = await dueEntries();
  for (const entry of entries) {
    const draft = await localDb.drafts.get(entry.draftId);
    if (!draft) {
      await clearEntry(entry.id!);
      continue;
    }
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: draft.draftId,
          clientName: draft.clientName,
          clientEmail: draft.clientEmail,
          clientPhone: draft.clientPhone,
          clientAddress: draft.clientAddress,
          taxRate: draft.taxRate,
          items: draft.items.map((i) => ({ localItemId: i.id, title: i.title, description: i.description, price: i.price })),
          clientUpdatedAt: draft.updatedAt,
        }),
      });

      if (res.ok) {
        const responseBody = await res.json();
        const serverItemByLocalId = new Map<string, string>(
          responseBody.quote.items.map((si: { id: string; localItemId: string }) => [si.localItemId, si.id]),
        );
        const items = draft.items.map((i) => ({ ...i, serverItemId: serverItemByLocalId.get(i.id) ?? i.serverItemId }));
        await localDb.drafts.update(draft.draftId, { serverId: responseBody.quote.id, status: 'synced', items });
        await clearEntry(entry.id!);
      } else if (res.status === 409 || (res.status >= 400 && res.status < 500)) {
        await localDb.drafts.update(draft.draftId, { status: 'error' });
        await markStuck(entry.id!, `sync failed: HTTP ${res.status}`);
      } else {
        await recordFailure(entry.id!, `server error ${res.status}`);
      }
    } catch (err) {
      await recordFailure(entry.id!, (err as Error).message);
    }
  }
}

export function startSyncLoop(intervalMs = 5000): () => void {
  const timer = setInterval(runSyncCycle, intervalMs);
  const onOnline = () => runSyncCycle();
  window.addEventListener('online', onOnline);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/syncWorker.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/health src/lib/syncWorker.ts tests/unit/syncWorker.test.ts
git commit -m "feat: add background sync worker with real connectivity check"
```

---

### Task 10: Quote builder UI (offline autosave)

**Files:**
- Create: `src/lib/debounce.ts`
- Create: `src/components/SyncStatusBadge.tsx`
- Create: `src/components/QuoteBuilderForm.tsx`
- Create: `src/app/quotes/new/page.tsx`
- Test: `tests/unit/QuoteBuilderForm.test.tsx`

**Interfaces:**
- Consumes: `localDb` (Task 5), `enqueueSync` (Task 6), `calculateTotals` (Task 4).
- Produces: `<QuoteBuilderForm draftId>` and `<SyncStatusBadge status>` — reused by the quotes list page (Task 11) and the conflict-recovery UI (Task 13).

- [ ] **Step 1: Write `src/lib/debounce.ts`**

```ts
export function debounce<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  }) as T;
}
```

- [ ] **Step 2: Write `src/components/SyncStatusBadge.tsx`**

```tsx
type Status = 'local' | 'syncing' | 'synced' | 'error';

const LABELS: Record<Status, string> = {
  local: 'Local',
  syncing: 'Syncing...',
  synced: 'Synced',
  error: 'Sync error',
};

const COLORS: Record<Status, string> = {
  local: '#b58900',
  syncing: '#268bd2',
  synced: '#2aa198',
  error: '#dc322f',
};

export function SyncStatusBadge({ status }: { status: Status }) {
  return (
    <span style={{ color: COLORS[status], fontWeight: 600 }} data-testid="sync-badge">
      {LABELS[status]}
    </span>
  );
}
```

- [ ] **Step 3: Write the failing test**

```tsx
// tests/unit/QuoteBuilderForm.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';
import { localDb } from '@/lib/localDb';

describe('QuoteBuilderForm', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.outbox.clear();
  });

  it('autosaves the client name locally after the debounce window', async () => {
    const draftId = 'test-draft-1';
    render(<QuoteBuilderForm draftId={draftId} />);
    await screen.findByLabelText('Client name');
    fireEvent.change(screen.getByLabelText('Client name'), { target: { value: 'Nelson Costa' } });

    await waitFor(
      async () => {
        const saved = await localDb.drafts.get(draftId);
        expect(saved?.clientName).toBe('Nelson Costa');
      },
      { timeout: 2000 },
    );
  });

  it('shows the Local badge for a freshly created draft', async () => {
    render(<QuoteBuilderForm draftId="test-draft-2" />);
    await waitFor(() => expect(screen.getByTestId('sync-badge')).toHaveTextContent('Local'));
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/unit/QuoteBuilderForm.test.tsx`
Expected: FAIL — `@/components/QuoteBuilderForm` does not exist.

- [ ] **Step 5: Write `src/components/QuoteBuilderForm.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb, DraftQuote, DraftQuoteItem } from '@/lib/localDb';
import { enqueueSync } from '@/lib/outbox';
import { debounce } from '@/lib/debounce';
import { calculateTotals } from '@/lib/quoteMath';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';

function emptyDraft(draftId: string): DraftQuote {
  return {
    draftId,
    clientName: '',
    clientEmail: '',
    items: [],
    taxRate: 0.05,
    status: 'local',
    updatedAt: Date.now(),
  };
}

export function QuoteBuilderForm({ draftId }: { draftId: string }) {
  const draft = useLiveQuery(() => localDb.drafts.get(draftId), [draftId]);

  useMemo(() => {
    localDb.drafts.get(draftId).then((existing) => {
      if (!existing) localDb.drafts.put(emptyDraft(draftId));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  const saveLocal = useMemo(
    () =>
      debounce((next: DraftQuote) => {
        localDb.drafts.put({ ...next, status: 'local', updatedAt: Date.now() });
      }, 500),
    [],
  );

  if (!draft) return <p>Loading draft...</p>;

  const totals = calculateTotals(draft.items, draft.taxRate);

  function updateField<K extends keyof DraftQuote>(field: K, value: DraftQuote[K]) {
    saveLocal({ ...draft!, [field]: value });
  }

  function addItem() {
    const item: DraftQuoteItem = { id: crypto.randomUUID(), title: '', price: 0, photoIds: [] };
    updateField('items', [...draft!.items, item]);
  }

  function updateItem(id: string, patch: Partial<DraftQuoteItem>) {
    updateField(
      'items',
      draft!.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  }

  async function handleSend() {
    await localDb.drafts.update(draftId, { status: 'syncing' });
    await enqueueSync(draftId);
  }

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <SyncStatusBadge status={draft.status} />
      <label htmlFor="clientName">Client name</label>
      <input id="clientName" value={draft.clientName} onChange={(e) => updateField('clientName', e.target.value)} />
      <label htmlFor="clientEmail">Client email</label>
      <input id="clientEmail" value={draft.clientEmail} onChange={(e) => updateField('clientEmail', e.target.value)} />
      {draft.items.map((item) => (
        <div key={item.id}>
          <label htmlFor={`title-${item.id}`}>Service title</label>
          <input id={`title-${item.id}`} value={item.title} onChange={(e) => updateItem(item.id, { title: e.target.value })} />
          <label htmlFor={`price-${item.id}`}>Price</label>
          <input
            id={`price-${item.id}`}
            type="number"
            value={item.price}
            onChange={(e) => updateItem(item.id, { price: Number(e.target.value) })}
          />
        </div>
      ))}
      <button type="button" onClick={addItem}>Add service</button>
      <p>Total: {totals.total}</p>
      <button type="button" onClick={handleSend}>Send</button>
    </form>
  );
}
```

- [ ] **Step 6: Write `src/app/quotes/new/page.tsx`**

```tsx
'use client';

import { useMemo } from 'react';
import { QuoteBuilderForm } from '@/components/QuoteBuilderForm';

export default function NewQuotePage() {
  const draftId = useMemo(() => crypto.randomUUID(), []);
  return <QuoteBuilderForm draftId={draftId} />;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/unit/QuoteBuilderForm.test.tsx`
Expected: PASS (2 tests). Note the label is "Client name", not an ARIA `aria-label` attribute — `<label htmlFor>` pairs with `getByLabelText`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/debounce.ts src/components/SyncStatusBadge.tsx src/components/QuoteBuilderForm.tsx src/app/quotes/new tests/unit/QuoteBuilderForm.test.tsx
git commit -m "feat: add offline-first quote builder form"
```

---

### Task 11: Quotes list page

**Files:**
- Create: `src/app/quotes/page.tsx`
- Test: `tests/unit/QuotesListPage.test.tsx`

**Interfaces:**
- Consumes: `localDb` (Task 5), `SyncStatusBadge` (Task 10).

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/QuotesListPage.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import QuotesListPage from '@/app/quotes/page';
import { localDb } from '@/lib/localDb';

describe('QuotesListPage', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
  });

  it('lists drafts with their sync status', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'Nelson Costa', clientEmail: 'n@x.com', items: [], taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
    });
    render(<QuotesListPage />);
    await waitFor(() => expect(screen.getByText('Nelson Costa')).toBeInTheDocument());
    expect(screen.getByTestId('sync-badge')).toHaveTextContent('Synced');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/QuotesListPage.test.tsx`
Expected: FAIL — `@/app/quotes/page` does not exist.

- [ ] **Step 3: Write `src/app/quotes/page.tsx`**

```tsx
'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '@/lib/localDb';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';

export default function QuotesListPage() {
  const drafts = useLiveQuery(() => localDb.drafts.orderBy('updatedAt').reverse().toArray(), []) ?? [];

  return (
    <div>
      <Link href="/quotes/new">New quote</Link>
      <ul>
        {drafts.map((d) => (
          <li key={d.draftId}>
            {d.clientName || 'Untitled'} <SyncStatusBadge status={d.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/QuotesListPage.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/app/quotes/page.tsx tests/unit/QuotesListPage.test.tsx
git commit -m "feat: add quotes list page with sync status"
```

---

### Task 12: PWA app-shell precache

**Files:**
- Create: `public/manifest.json`

**Interfaces:**
- Consumes: `next-pwa` config already wired in `next.config.js` (Task 1).

- [ ] **Step 1: Write `public/manifest.json`**

```json
{
  "name": "Arbostar Quotes",
  "short_name": "Arbostar",
  "start_url": "/quotes",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2c5f2d",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Note: drop real 192x192 and 512x512 PNG icons at `public/icons/` before shipping to production — they're cosmetic (install prompt/home-screen icon) and don't block service-worker precaching.

- [ ] **Step 2: Build and manually verify offline load**

Run: `npm run build && npm run start`
Then in a browser: visit `http://localhost:3000/quotes/new` once (to let the service worker install and precache), open DevTools → Application → Service Workers → check "Offline", reload the page.
Expected: the page still renders (no browser offline-dinosaur page).

- [ ] **Step 3: Commit**

```bash
git add public/manifest.json
git commit -m "feat: add PWA manifest for app-shell offline precache"
```

---

### Task 13: Conflict / sync-error recovery UI

**Files:**
- Modify: `src/components/QuoteBuilderForm.tsx`
- Test: `tests/unit/QuoteBuilderForm.test.tsx`

**Interfaces:**
- Consumes: `getEntryForDraft`, `retryStuckEntry`, `clearEntry` (Task 6), `runSyncCycle` (Task 9).

- [ ] **Step 1: Add the failing test case**

Append to `tests/unit/QuoteBuilderForm.test.tsx`:

```tsx
import { enqueueSync, markStuck, getEntryForDraft } from '@/lib/outbox';

it('shows a sync-error banner with Retry/Discard when the outbox entry is stuck', async () => {
  const draftId = 'test-draft-3';
  await localDb.drafts.put({
    draftId, clientName: 'Stuck Client', clientEmail: 'x@x.com', items: [], taxRate: 0.05, status: 'error', updatedAt: Date.now(),
  });
  await enqueueSync(draftId);
  const entry = await getEntryForDraft(draftId);
  await markStuck(entry!.id!, 'sync failed: HTTP 409');

  render(<QuoteBuilderForm draftId={draftId} />);

  await waitFor(() => expect(screen.getByTestId('conflict-banner')).toHaveTextContent('sync failed: HTTP 409'));

  fireEvent.click(screen.getByRole('button', { name: /discard/i }));

  await waitFor(async () => {
    const draft = await localDb.drafts.get(draftId);
    expect(draft?.status).toBe('local');
    expect(await getEntryForDraft(draftId)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/QuoteBuilderForm.test.tsx`
Expected: FAIL — no element with `data-testid="conflict-banner"`.

- [ ] **Step 3: Modify `src/components/QuoteBuilderForm.tsx`**

Add these imports:

```tsx
import { enqueueSync, getEntryForDraft, retryStuckEntry, clearEntry } from '@/lib/outbox';
import { runSyncCycle } from '@/lib/syncWorker';
```

Add this hook alongside the existing `draft` query:

```tsx
const outboxEntry = useLiveQuery(() => getEntryForDraft(draftId), [draftId]);
```

Add this block right before the closing `</form>`:

```tsx
{draft.status === 'error' && outboxEntry && (
  <div role="alert" data-testid="conflict-banner">
    <p>{outboxEntry.lastError}</p>
    <button
      type="button"
      onClick={async () => {
        await retryStuckEntry(outboxEntry.id!);
        await runSyncCycle();
      }}
    >
      Retry
    </button>
    <button
      type="button"
      onClick={async () => {
        await clearEntry(outboxEntry.id!);
        await localDb.drafts.update(draftId, { status: 'local' });
      }}
    >
      Discard sync, keep editing
    </button>
  </div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/QuoteBuilderForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/QuoteBuilderForm.tsx tests/unit/QuoteBuilderForm.test.tsx
git commit -m "feat: add conflict recovery UI with retry/discard"
```

---

### Task 14: Photo capture in the builder and deferred photo upload

**Files:**
- Create: `src/lib/photoSync.ts`
- Modify: `src/components/QuoteBuilderForm.tsx`
- Test: `tests/unit/photoSync.test.ts`
- Test: `tests/unit/QuoteBuilderForm.test.tsx`

**Interfaces:**
- Consumes: `localDb` (Task 5), `compressImage` (Task 8), `item.serverItemId` set by the sync worker (Task 9).
- Produces: `addPhotoToItem(draftId, itemId, blob, fileName)` and `uploadPendingPhotos(draftId)` — a photo is captured and stored locally immediately (works offline), and is only POSTed to `/api/quotes/photos` once its parent `QuoteItem` has a `serverItemId` (i.e., the quote text itself has synced at least once).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/photoSync.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { localDb } from '@/lib/localDb';
import { addPhotoToItem, uploadPendingPhotos } from '@/lib/photoSync';

describe('photoSync', () => {
  beforeEach(async () => {
    await localDb.drafts.clear();
    await localDb.photos.clear();
  });

  it('stores the photo locally and links it to the item, pending upload', async () => {
    await localDb.drafts.put({
      draftId: 'd1', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'local', updatedAt: Date.now(),
      items: [{ id: 'item-1', title: 'Hedges', price: 100, photoIds: [] }],
    });
    const blob = new Blob(['fake'], { type: 'image/jpeg' });

    await addPhotoToItem('d1', 'item-1', blob, 'photo.jpg');

    const draft = await localDb.drafts.get('d1');
    expect(draft?.items[0].photoIds).toHaveLength(1);
    const photoId = draft!.items[0].photoIds[0];
    const photo = await localDb.photos.get(photoId);
    expect(photo?.status).toBe('pending');
  });

  it('skips items with no serverItemId yet', async () => {
    await localDb.drafts.put({
      draftId: 'd2', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'local', updatedAt: Date.now(),
      items: [{ id: 'item-2', title: 'Hedges', price: 100, photoIds: [] }],
    });
    await addPhotoToItem('d2', 'item-2', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn();
    await uploadPendingPhotos('d2');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uploads a pending photo once the item has a serverItemId, then marks it uploaded', async () => {
    await localDb.drafts.put({
      draftId: 'd3', clientName: 'A', clientEmail: 'a@x.com', taxRate: 0.05, status: 'synced', updatedAt: Date.now(),
      items: [{ id: 'item-3', serverItemId: 'server-item-3', title: 'Hedges', price: 100, photoIds: [] }],
    });
    await addPhotoToItem('d3', 'item-3', new Blob(['x']), 'p.jpg');

    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    await uploadPendingPhotos('d3');

    const draft = await localDb.drafts.get('d3');
    const photo = await localDb.photos.get(draft!.items[0].photoIds[0]);
    expect(photo?.status).toBe('uploaded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/photoSync.test.ts`
Expected: FAIL — `@/lib/photoSync` does not exist.

- [ ] **Step 3: Write `src/lib/photoSync.ts`**

```ts
import { localDb } from '@/lib/localDb';

export async function addPhotoToItem(draftId: string, itemId: string, blob: Blob, fileName: string): Promise<void> {
  const photoId = crypto.randomUUID();
  await localDb.photos.add({ id: photoId, draftId, blob, fileName, status: 'pending' });

  const draft = await localDb.drafts.get(draftId);
  if (!draft) return;
  const items = draft.items.map((i) => (i.id === itemId ? { ...i, photoIds: [...i.photoIds, photoId] } : i));
  await localDb.drafts.put({ ...draft, items, updatedAt: Date.now() });
}

export async function uploadPendingPhotos(draftId: string): Promise<void> {
  const draft = await localDb.drafts.get(draftId);
  if (!draft) return;

  for (const item of draft.items) {
    if (!item.serverItemId) continue;
    for (const photoId of item.photoIds) {
      const photo = await localDb.photos.get(photoId);
      if (!photo || photo.status === 'uploaded') continue;

      const form = new FormData();
      form.set('quoteItemId', item.serverItemId);
      form.set('file', photo.blob, photo.fileName);
      try {
        const res = await fetch('/api/quotes/photos', { method: 'POST', body: form });
        if (res.ok) {
          await localDb.photos.update(photoId, { status: 'uploaded' });
        }
      } catch {
        // network error: photo stays 'pending', retried on the next call
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/photoSync.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the failing UI test case**

jsdom (this test file's environment) doesn't implement `createImageBitmap`/`canvas`, which `compressImage` needs. Add this mock right after the existing imports at the top of `tests/unit/QuoteBuilderForm.test.tsx` — it must come before the `QuoteBuilderForm` import so Vitest hoists it correctly:

```tsx
vi.mock('@/lib/compressImage', () => ({ compressImage: async (blob: Blob) => blob }));
```

Then append this test case at the bottom of the same file:

```tsx
it('lets staff attach a photo to a service line item', async () => {
  const draftId = 'test-draft-4';
  render(<QuoteBuilderForm draftId={draftId} />);
  await screen.findByLabelText('Client name');
  fireEvent.click(screen.getByRole('button', { name: /add service/i }));

  const draft = await waitFor(async () => {
    const d = await localDb.drafts.get(draftId);
    if (!d || d.items.length === 0) throw new Error('item not added yet');
    return d;
  });
  const itemId = draft.items[0].id;

  const file = new File(['fake-bytes'], 'hedge.jpg', { type: 'image/jpeg' });
  const input = screen.getByLabelText(/add photo/i);
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByTestId(`photo-count-${itemId}`)).toHaveTextContent('1 photo'));
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run tests/unit/QuoteBuilderForm.test.tsx`
Expected: FAIL — no element matches label `/add photo/i`.

- [ ] **Step 7: Modify `src/components/QuoteBuilderForm.tsx`**

Add these imports:

```tsx
import { useEffect } from 'react';
import { compressImage } from '@/lib/compressImage';
import { addPhotoToItem, uploadPendingPhotos } from '@/lib/photoSync';
```

Add this effect (fires the deferred photo upload once the quote text itself has synced):

```tsx
useEffect(() => {
  if (draft?.status === 'synced') {
    uploadPendingPhotos(draftId);
  }
}, [draft?.status, draftId]);
```

Inside the `draft.items.map(...)` block, right after the price input, add:

```tsx
<label htmlFor={`photo-${item.id}`}>Add photo for {item.title || 'this service'}</label>
<input
  id={`photo-${item.id}`}
  type="file"
  accept="image/*"
  onChange={async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const compressed = await compressImage(file);
    await addPhotoToItem(draftId, item.id, compressed, file.name);
  }}
/>
<span data-testid={`photo-count-${item.id}`}>{item.photoIds.length} photo(s)</span>
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/unit/QuoteBuilderForm.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/photoSync.ts src/components/QuoteBuilderForm.tsx tests/unit/photoSync.test.ts tests/unit/QuoteBuilderForm.test.tsx
git commit -m "feat: capture photos offline and upload once the parent item has synced"
```

---

### Task 15: End-to-end offline reload test

**Files:**
- Create: `playwright.config.ts`
- Test: `tests/e2e/offline-quote.spec.ts`

**Interfaces:**
- Consumes: the running app (Tasks 1–13), the seeded admin user (Task 3, `admin@tiptoptreesltd.com` / `changeme123`).

- [ ] **Step 1: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'npm run build && npm run start',
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  use: { baseURL: 'http://localhost:3000' },
});
```

- [ ] **Step 2: Write `tests/e2e/offline-quote.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('quote builder keeps unsynced data through an offline reload, then syncs when back online', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@tiptoptreesltd.com');
  await page.getByLabel('Password').fill('changeme123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/quotes');

  await page.goto('/quotes/new');
  await page.getByLabel('Client name').fill('Nelson Costa');
  await page.waitForTimeout(700); // allow the 500ms autosave debounce to fire

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByLabel('Client name')).toHaveValue('Nelson Costa');
  await expect(page.getByTestId('sync-badge')).toHaveText('Local');

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('sync-badge')).toHaveText('Synced', { timeout: 15000 });
});
```

- [ ] **Step 3: Prepare the database and run the test**

Run:
```bash
npx prisma migrate deploy
npx prisma db seed
npx playwright install --with-deps chromium
npx playwright test
```
Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/offline-quote.spec.ts
git commit -m "test: add e2e offline reload coverage for the quote builder"
```

---

## Post-implementation manual check

- Sign in as `admin@tiptoptreesltd.com`, create a quote with two line items matching the reference estimate ($1250 + $500, 5% tax) and confirm the total reads $1837.50.
- Disconnect Wi-Fi mid-fill on a real device, reload the tab, and confirm the draft reappears with a "Local" badge.
- Reconnect and confirm the badge flips to "Synced" without manual intervention.
