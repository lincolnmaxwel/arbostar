---
name: Arbostar
description: Offline-first quote/estimate builder for a tree service company
colors:
  forest-primary: "#2c5f2d"
  forest-primary-hover: "#1e4220"
  forest-primary-light: "#e8f0e8"
  gold-accent: "#d4a017"
  neutral-bg: "#f0f2f0"
  neutral-surface: "#ffffff"
  ink: "#111827"
  ink-secondary: "#6b7280"
  border: "#d1d5db"
  error: "#dc322f"
  error-bg: "#fef2f2"
  success: "#2aa198"
  success-bg: "#f0fdf9"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  md: "8px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.forest-primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 28px"
  button-primary-hover:
    backgroundColor: "{colors.forest-primary-hover}"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.forest-primary}"
    rounded: "{rounded.md}"
    padding: "12px 28px"
  input:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Arbostar

## 1. Overview

**Creative North Star: "The Field Ledger"**

Arbostar is the digital version of the leather-bound estimate book a foreman used to carry in the truck: precise, unglamorous, trusted. The interface earns confidence through order and legibility, not through spectacle — every screen should feel like it belongs to a company that's been doing this work for twenty years and doesn't need to prove it with decoration. This is a **product** surface first (staff use it daily, often mid-job, sometimes one-handed on a phone), but the client-facing portal, quote view, and invoice PDF are the company's handshake with a homeowner about to spend real money — those surfaces carry the same restraint, just with slightly more ceremony (clear totals, a confident approve/decline action, a solid party block).

Explicitly rejected: generic SaaS gradients, playful/rounded "friendly app" styling, cutesy icons, bright toy-like accent colors, glassmorphism, anything that reads as a template rather than a real trade business.

**Key Characteristics:**
- Flat-by-default surfaces with restrained, purposeful shadows
- One deep forest green carries authority; gold is a rare confirming accent, never decoration
- Generous whitespace and clear section boundaries over dense card grids
- System font stack — no display face, no personality font; hierarchy comes from weight and size
- Motion is a confirmation, not a performance: state changes ease in/out, nothing bounces

## 2. Colors

A deep forest green anchors the whole system; a muted gold is reserved for the single most important confirming signal per screen (an active status, an approval accent), never for general decoration.

### Primary
- **Deep Forest** (#2c5f2d): header background, primary buttons, links, the one accent that says "this action matters" — the `scheduled` status pill also darkens it (#1e4220) for `completed`, an intentional darkening-with-progress metaphor.
- **Forest Hover** (#1e4220): hover state for anything using Deep Forest as a background.
- **Forest Wash** (#e8f0e8): the lightest tint of the primary — hover/active backgrounds on secondary buttons, locked-field notices, focus-ring halo.

### Secondary
- **Field Gold** (#d4a017): rare confirming accent (active nav underline). Not yet used broadly — reserve it for moments of genuine confirmation (an approved state, a completed milestone), never for routine UI chrome.

### Neutral
- **Ledger Paper** (#f0f2f0): page background — a cool, slightly gray-green-tinted off-white, never warm/cream.
- **Card White** (#ffffff): surface for cards, panels, table backgrounds, inputs.
- **Ink** (#111827): primary text.
- **Ink Muted** (#6b7280): secondary text, labels, metadata, timestamps.
- **Ledger Rule** (#d1d5db): borders, dividers, table rules.

### Status colors
- **Error** (#dc322f / bg #fef2f2): failed sync, validation errors, decline states.
- **Success** (#2aa198 / bg #f0fdf9): approved states.
- **Pending amber** (#b58900 / bg #fef9e7): sent/pending-sync banners — not in the primary token set above but used consistently for "waiting on someone else" states; promote to a named token if reused further.

### Named Rules
**The Single Accent Rule.** Deep Forest is the only color allowed to signal "primary action" on any given screen. Field Gold marks confirmation/active state only, never a second competing call-to-action.

## 3. Typography

**Body Font:** System UI stack (-apple-system, Segoe UI, Roboto, Helvetica Neue, Arial)
**Display Font:** none — the system deliberately has no display face; hierarchy is weight + size only.

**Character:** Utilitarian and quiet. No font personality to lean on, so hierarchy must do all the work: bold weight jumps (700 for titles/values, 600 for emphasis, 400 for body) and size steps, not typographic flourish.

### Hierarchy
- **Title** (700, 1.5rem–1.75rem, 1.3 line-height): page/quote titles.
- **Section heading** (600, 1rem, 1.4): card/section headers, e.g. "Client Details".
- **Body** (400, 0.9375rem, 1.6): form text, paragraph content. Cap prose at 65–75ch where it appears in longer client-facing copy.
- **Label** (700, 0.75rem, letter-spacing 0.05em, uppercase): totals labels, party labels ("BILL TO"), table headers.
- **Meta** (400, 0.75–0.8125rem): timestamps, secondary line under a name/title.

### Named Rules
**The No-Display-Font Rule.** Never introduce a decorative or serif display face to "add personality." Confidence here comes from restraint and precision, not typographic voice.

## 4. Elevation

Flat by default, confirmed deliberately for this system: surfaces sit at one of two levels (page background `#f0f2f0` and card/surface `#ffffff`), separated by a hairline border or a very subtue ambient shadow — never a heavy drop shadow. Shadows exist only to lift something briefly above the page (a dropdown, a modal, a lightbox), not to decorate resting cards.

### Shadow Vocabulary
- **Ambient** (`box-shadow: 0 1px 3px rgba(0,0,0,0.1)`): resting cards, header, buttons — barely-there separation from the page.
- **Lifted** (`box-shadow: 0 4px 12px rgba(0,0,0,0.1)`): dropdowns, popovers, modals, lightbox image — anything temporarily above the page flow.

### Named Rules
**The Flat-By-Default Rule.** A card at rest never uses more than the Ambient shadow. Lifted only applies to elements that are transiently above the page (menus, dialogs) — never a permanently resting card, however "important" it is.

## 5. Components

### Buttons
- **Shape:** 8px radius (`--radius`), consistent across primary/secondary/inputs — never pill-shaped except status badges.
- **Primary:** Deep Forest background, white text, 12px/28px padding, 600 weight. Hover darkens to Forest Hover and lifts 1px with an Ambient/Lifted shadow (`ease-out-expo`, 150ms) — a confirmation nudge, never a bounce.
- **Secondary ("Save"/"Copy link"):** white background, Deep Forest text and 1px Deep Forest border. Hover fills with Forest Wash and lifts the same 1px.
- **Ghost (remove/discard):** transparent background, colored text only (error red for destructive, muted gray for neutral discard), underline on hover instead of a background change.
- **Disabled:** 0.5 opacity, `cursor: not-allowed`, no color change beyond that.

### Chips / Status badges
- **Style:** pill radius (999px), 3px/10px padding, 600 weight, 0.75rem — background/text pair per status (sent = amber wash, approved = success wash, declined = error wash, draft/expired = neutral wash, scheduled/completed = solid Deep Forest / Forest Hover with white text).
- **State:** display-only, non-interactive.

### Cards / Containers
- **Corner Style:** 8px radius uniformly.
- **Background:** white surface on the gray-green page background.
- **Shadow Strategy:** Ambient at rest (see Elevation); no hover-lift on static section cards.
- **Border:** hairline `#d1d5db` used instead of shadow to separate sub-sections within a card (e.g. table header rule, `topBar` bottom border).
- **Internal Padding:** 24px desktop / 16-20px mobile.

### Inputs / Fields
- **Style:** 1px `#d1d5db` border, white background, 8px radius, 10-12px vertical padding.
- **Focus:** border shifts to Deep Forest + a 3px Forest Wash halo (`box-shadow: 0 0 0 3px #e8f0e8`) — no glow, no color-shifted background.
- **Disabled:** page-background gray fill, muted text, `not-allowed` cursor.

### Navigation
- Deep Forest header, sticky top, white brand wordmark. Nav links are translucent white (`rgba(255,255,255,0.8)`) with a 2px transparent underline that fills white on hover and Field Gold when active — the only place Field Gold appears as an ongoing UI element rather than a momentary confirmation.

## 6. Do's and Don'ts

### Do:
- **Do** keep Deep Forest (#2c5f2d) as the single primary-action color on every screen.
- **Do** use the 8px radius uniformly for cards, buttons, and inputs; pill radius (999px) only for status badges.
- **Do** keep shadows to the Ambient/Lifted two-step vocabulary — no card ever needs more than Ambient at rest.
- **Do** lead client-facing surfaces (portal, invoice PDF, emails) with the same restraint as staff screens — clear totals, a confident single CTA, no extra chrome.
- **Do** respect `prefers-reduced-motion`: any transition/animation needs a crossfade-or-instant fallback.

### Don't:
- **Don't** introduce purple/blue gradients or any gradient-filled surface — reads as generic SaaS template, explicitly rejected in PRODUCT.md.
- **Don't** use bright, toy-like accent colors or cutesy/rounded-blob icons — this is heavy outdoor labor and real invoices, not a consumer lifestyle app.
- **Don't** add glassmorphism (decorative blur-and-transparency cards) anywhere.
- **Don't** use `border-left`/`border-right` colored stripes as a card accent — use full borders, background tints, or nothing.
- **Don't** apply gradient text (`background-clip: text`) for emphasis — use weight or size.
- **Don't** let Field Gold spread beyond its one job (active nav state / genuine confirmation) — it is not a second brand color to sprinkle around.
