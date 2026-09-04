# Design: Per-User Isolation, Administration, Feature Flags, and Timesheets

**Status:** approved for implementation  
**Date:** 2026-09-04  
**Scope:** single-tenant deployment only; intentionally compatible with the
future `Tenant`/`tenantId` SaaS pivot.

## Context

Arbostar currently treats every authenticated staff user as an equal member of
one shared company environment. `Client.email` is globally unique,
`Quote.createdById` is recorded but not enforced as an owner, `Invoice` has no
direct owner, and `CompanyProfile` is a fixed-id singleton. The application
needs user-level data boundaries before the SaaS tenant model is introduced:
each user owns their clients, quotes, invoices, and timesheet entries.

Administrators retain full access. An administrator may select a user in a
validated “view as” context and read or write that user’s data. Writes made in
that context record the real administrator as `actorId` and the viewed user as
`targetUserId` in `AuditLog`.

The offline-first quote pipeline remains authoritative for local quote drafts,
but Dexie rows and outbox work must be namespaced by the effective user. A
one-time browser migration assigns legacy pre-isolation local drafts to the
first authenticated user because their original owner cannot be reconstructed
from the old schema.

## Decisions

### Ownership model

- `Client.userId` is the required owner and replaces global email uniqueness
  with `@@unique([userId, email])`.
- `Quote.createdById` is the owner of a quote; all authenticated quote reads
  and writes are scoped by it.
- `Invoice.userId` is a required direct owner. Quote-generated invoices copy
  `Quote.createdById`; timesheet-generated invoices use the effective user.
- `TimesheetEntry.userId` is the required owner. Its `hourlyRate` is a Decimal
  snapshot, not a live relation to `User.hourlyRate`.
- `CompanyProfile.userId @unique` replaces the fixed `id = 'company'`
  convention. `getCompanyProfile(userId)` returns the profile for the effective
  user. When `Tenant` exists, these ownership queries also gain `tenantId`.

### Invoice architecture

The existing `Invoice` model is reused. `quoteId` becomes nullable and
`source` distinguishes `quote` from `timesheet`. A required `clientId` and
`userId` make both sources listable through one `/invoices` experience.
`InvoiceLineItem` stores immutable timesheet-derived line snapshots. Quote
invoices continue to use quote items for compatibility, while the invoice
detail, PDF, email, and payment-receipt paths render either source.

This is preferred over a separate `TimesheetInvoice` model: it keeps invoice
search, payment status, deletion policy, PDF download, and future payment
features in one place. The migration is more involved, but the data model is
clearer for users and avoids two lists that must later be reconciled.

### Timesheets

`TimesheetEntry` stores `workDate`, `startedAt`, `endedAt`, persisted
`durationMinutes`, snapshot `hourlyRate`, `clientId`, and status `open` or
`invoiced`. `TimesheetProduct` stores product name, quantity, unit price, and
line total snapshots. The API validates end-after-start and computes duration
and all Decimal totals server-side.

Invoice generation is explicit: select open entries for one client and a date
range (or explicit IDs), then create exactly one invoice in a serializable
transaction. The transaction locks the logical set by rechecking `status =
'open'`, creates invoice lines, and marks every selected entry `invoiced` with
that invoice ID. A timesheet invoice cannot be deleted, preserving the rule
that an entry can belong to only one generated invoice.

### Administration and feature flags

`User.status` is `active`, `inactive`, or `blocked`. Credentials are checked
against the status after password verification and reject inactive/blocked
accounts with clear English messages. Active status is backfilled for current
users.

`UserFeatureFlag` is normalized with a unique `(userId, feature)` key. The
initial optional features are `invoices`, `timesheet`, and `clients_crm`;
quotes are always available and are not represented as a flag. Existing users
are backfilled with optional features enabled to avoid regressions. New
admin-created users start with optional features disabled unless the admin
explicitly enables them.

The admin user-management surface creates users with name, email, initial
password, role, and status, and edits status/role/password and feature flags.
It prevents disabling the last active administrator or the current admin’s
own account.

### View-as context

An admin-only `/api/admin/view-as` route sets or clears an HttpOnly cookie
containing the selected user ID. Every authenticated scope helper validates
the cookie against the current real session and resolves:

```ts
{
  actorUserId: string;       // real logged-in user
  ownerUserId: string;       // data owner being queried/written
  isViewAs: boolean;
  targetUserId?: string;
}
```

Staff sessions ignore the cookie. The same effective owner is used by clients,
quotes, invoices, timesheets, feature checks, and profile/company-branding
operations. Every successful mutation while `isViewAs` is true writes an
`AuditLog` row with `actorId`, `targetUserId`, entity, and action. Public portal
responses and public upload serving remain unauthenticated by design; they are
not authenticated user data surfaces.

### Offline compatibility

`DraftQuote.ownerUserId` and `OutboxEntry.ownerUserId` are added to Dexie,
with owner-filtered queries in the quote list, builder, pull, sync, delete,
and photo paths. The server still receives the normal quote payload; ownership
comes from the authenticated effective-user scope, never from a client-supplied
owner ID.

## Out of scope

- The future SaaS `Tenant` model, tenant signup, tenant routing, billing, and
  Stripe integrations.
- Payment collection or accounting beyond the existing invoice payment-status
  flow.
- A generic service-catalog redesign; timesheet products are immutable
  snapshots and do not depend on a live catalog item.
