# Security Access & Tournament Bracket — Design Spec

Date: 2026-08-18
Status: Approved by user, ready for implementation planning

## 1. Problem & Context

The Anteraja Club Tournament app is currently a static site (HTML/vanilla JS + a
small React bracket module bundled with esbuild). There is no running backend
server. All tournament/participant/bracket data lives in the browser's
`localStorage`, and a Firebase Realtime Database is used only for an anonymous
"preview link" sharing feature (no authentication at all).

We need to add:
- Email-based login with two roles: `ADMIN` (two whitelisted emails) and
  `VIEWER` (everyone else), enforced server-side, not just hidden in the UI.
- Persistent, multi-tournament storage that survives refresh/logout/new
  device, replacing the single-tournament `localStorage` model.
- A Tournament List → Tournament Detail → Bracket View flow for viewers.
- 5-day retention for tournaments, enforced server-side.
- Field renames: "Biaya Pendaftaran" → "Nama Perlombaan"; payment method
  `TF/CASH` → attendance status `PRESENT/ABSENT` (displayed as
  `HADIR`/`TIDAK HADIR`).

## 2. Decisions Made During Brainstorming

| Decision | Choice |
|---|---|
| Backend platform | Firebase (Authentication + Firestore + Security Rules). No custom Node/Express server — none exists today and none is hosted. |
| Login method | Email + Password (Firebase Auth) |
| Role enforcement mechanism | Firestore Security Rules only (no Cloud Functions, stay on free Spark plan) |
| Database for tournaments/users/participants | Cloud Firestore (not Realtime Database) — needed for querying/retention filtering and richer rules |
| Old anonymous "preview link" (Firebase RTDB) feature | Removed entirely, replaced by authenticated Tournament List flow |
| Retention cleanup | Manual, admin-triggered "Cleanup Expired" button (no scheduled Cloud Function) |
| Firebase Console setup (enabling Email/Password auth, Firestore) | Done manually by the user, following step-by-step instructions provided as part of implementation |
| Legacy localStorage data | Not auto-migrated (structural change to multi-tournament model); optional one-time "Import from Local Storage" button for admins |

## 3. Data Model (Firestore)

```
users/{uid}
  - email: string
  - role: "ADMIN" | "VIEWER"      // set once at doc creation, immutable after
  - createdAt: timestamp
  - updatedAt: timestamp

tournaments/{tournamentId}
  - name: string                  // "Nama Perlombaan" — replaces old "Biaya Pendaftaran" fee field
  - size: number                  // 4 | 8 | 16 | 32 | 64 | 128
  - status: "UPCOMING" | "ONGOING" | "FINISHED" | "EXPIRED" (EXPIRED computed client-side from expiresAt, not a stored transition)
  - createdBy: string             // uid of admin who created it
  - createdAt: timestamp
  - updatedAt: timestamp
  - expiresAt: timestamp          // createdAt + 5 days, set at creation and immutable
  - bracketData: object           // full { rounds, size, generatedAt } structure, same shape produced by assets/js/tournament.js generateBracket()
  - liveMatchIds: array<string>

tournaments/{tournamentId}/participants/{participantId}
  - name: string
  - hc: string                    // handicap, unchanged from existing model
  - drawingNumber: number
  - seed: number
  - attendanceStatus: "PRESENT" | "ABSENT"   // replaces old tf/cash payment status
  - createdAt: timestamp
  - updatedAt: timestamp
```

Rationale:
- `participants` is a subcollection (not an array field) so individual
  attendance updates and rules can target a single participant doc rather
  than rewriting a whole array.
- `bracketData` stays a single JSON blob on the tournament document because
  the existing bracket generation/advance-winner logic in
  `assets/js/tournament.js` and `src/components/BracketPage.jsx` already
  treats the bracket as one atomic object; changing that shape is out of
  scope. Only the persistence layer changes (Firestore instead of
  `localStorage`).
- No changes to the internal round/match schema (`p1`, `p2`, `score1`,
  `score2`, `winner`, `status`) — only the storage location changes.

## 4. Authentication & Authorization

### Registration flow
1. User signs up via Firebase Auth (email + password). No role selector is
   ever shown in the UI.
2. Immediately after auth account creation, the client writes
   `users/{uid}` with a `role` value it computes from the email
   (`ADMIN` if email is in the whitelist, else `VIEWER`).
3. Firestore Security Rules **re-derive the same whitelist check
   server-side** and reject the write if the claimed role doesn't match what
   the server computes from `request.auth.token.email`. This is the actual
   security boundary — the client-side computation is only for immediate UX,
   never trusted.

Admin whitelist (hardcoded in security rules, not user-editable at runtime):
```
['v-rabbani.ihsani@anteraja.id', 'ghozi.ruci@anteraja.id']
```

### Security Rules (illustrative, final syntax written during implementation)

```
function isSignedIn() { return request.auth != null; }
function isAdmin() {
  return isSignedIn() &&
    get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'ADMIN';
}
function computedRole() {
  return request.auth.token.email in
    ['v-rabbani.ihsani@anteraja.id', 'ghozi.ruci@anteraja.id'] ? 'ADMIN' : 'VIEWER';
}

match /users/{uid} {
  allow create: if isSignedIn() && request.auth.uid == uid
                && request.resource.data.role == computedRole();
  allow update, delete: if false; // role immutable once created
  allow read: if isSignedIn() && request.auth.uid == uid;
}

match /tournaments/{tournamentId} {
  allow read: if isAdmin() ||
              (isSignedIn() && resource.data.expiresAt > request.time);
  allow create, update, delete: if isAdmin();

  match /participants/{participantId} {
    allow read: if isSignedIn();
    allow write: if isAdmin();
  }
}
```

Key guarantee: any direct API/SDK call (not just UI buttons) from a VIEWER
account to create/update/delete a tournament, its bracket, or its
participants is rejected by Firestore with `PERMISSION_DENIED`
(Firestore's equivalent of HTTP 403), independent of any frontend hiding.

## 5. Frontend Changes

### New pages/screens
- **Login** and **Register** (email + password only; no role field/selector)
- **Tournament List** ("Dashboard" landing after login) — cards for each
  non-expired tournament: name, status, created date, `[VIEW BRACKET]`
  button. Admins additionally see `[CREATE TOURNAMENT]` and per-card
  edit/delete controls.
- **Tournament Detail / Bracket View** — reached by selecting a tournament
  from the list. Renders the existing `BracketPage`/`BracketView` React
  component tree, now bound to a specific `tournamentId` and backed by
  Firestore instead of `localStorage`.
- **Expired Tournaments** (admin only) with a **"Cleanup Expired"** action
  that permanently deletes the tournament document and its participants
  subcollection.

### Role-based navigation
Sidebar/nav items are rendered conditionally based on the `role` loaded from
the signed-in user's Firestore doc (never assumed or hardcoded client-side
default):
- **ADMIN**: Dashboard, Tournament List, Create Tournament, Tournament Setup,
  Manage Participants, Manage Bracket, Expired Tournaments/Cleanup.
- **VIEWER**: Dashboard, Tournament List → Bracket View only. No
  Create/Edit/Delete/Generate/Manage controls are rendered.

Hiding these controls is a UX convenience only — every action they'd trigger
is independently blocked by the Security Rules above.

### Live updates for viewers
The Bracket View subscribes to the open tournament's Firestore document via
`onSnapshot`. When an admin updates a score, winner, or attendance status,
any viewer currently viewing that tournament sees the change reflected
without needing a manual page refresh.

### Field renames (UI, data model, exports)
- Remove the "Biaya Pendaftaran" card/input (`#input-fee`) from Tournament
  Setup. Replace with a "Nama Perlombaan" text input, stored as
  `tournaments/{id}.name`. Displayed in: Tournament List, Tournament Detail,
  Bracket header, Dashboard.
- Remove participant payment status `tf`/`cash`. Replace with
  `attendanceStatus: PRESENT | ABSENT` on each participant doc. UI always
  displays `HADIR` (PRESENT) / `TIDAK HADIR` (ABSENT). Update:
  - Participant table column ("PEMBAYARAN" → "KEHADIRAN")
  - Dashboard stat cards ("BAYAR CASH"/"TRANSFER"/"BELUM BAYAR" →
    "HADIR"/"TIDAK HADIR"/"TOTAL PESERTA")
  - Excel import/export column headers
  - Any PDF export labels

## 6. Retention (5 Days)

- `expiresAt = createdAt + 5 days`, computed and stored at tournament
  creation time. Security rules validate `expiresAt` equals `createdAt + 5d`
  on create so it can't be tampered with to extend retention.
- Tournament List query for all users filters
  `where('expiresAt', '>', now())`; VIEWER reads of expired tournaments are
  additionally rejected server-side by the rule
  `resource.data.expiresAt > request.time` (defense in depth — not relying
  on the client query alone).
- Admins can still read expired tournaments (`isAdmin()` bypass) in order to
  review/clean them up.
- "EXPIRED" status shown in the UI is computed at render time by comparing
  `expiresAt` to the current time — it is not a stored field that flips via
  a background job (no Cloud Functions per the chosen approach).
- Physical deletion happens only through the admin-triggered "Cleanup
  Expired" action, which deletes the tournament doc and its participants
  subcollection. This never runs automatically, so active/non-expired
  tournaments are never at risk.

## 7. Migration of Existing Data

The existing `localStorage`-based single-tournament model is not
automatically migrated, since moving to multi-tournament Firestore documents
is a structural change with no 1:1 mapping (and old `fee`/`tf`/`cash` fields
have no valid equivalent under the new model). Instead, a one-time **"Import
from Local Storage"** action is added to the Create Tournament screen for
admins who still have an old browser-local tournament, which reads
`AnterajaStorage.exportAll()` and creates a new Firestore tournament (with a
generated `name`, mapping legacy participants and dropping `fee`/`tf`/`cash`
fields since there is no equivalent).

## 8. Testing Plan

1. **Bracket logic regression** — verify `assets/js/tournament.js`
   (`generateBracket`, `advanceWinner`, `autoAdvanceByes`, `getStats`) and
   `src/components/bracketUtils.js` behavior is unchanged; only their
   read/write target moves from `AnterajaStorage` to Firestore.
2. **Firestore Security Rules unit tests** using
   `@firebase/rules-unit-testing`, covering:
   - Whitelisted email → `ADMIN` role accepted; non-whitelisted → `VIEWER`
     accepted; either self-assigning the other role is rejected.
   - VIEWER attempting create/update/delete on `tournaments` or
     `participants` is rejected.
   - VIEWER reading an expired tournament is rejected; ADMIN reading it
     succeeds.
   - Role document `update`/`delete` is always rejected (immutable role).
3. **Manual end-to-end** — admin login (whitelisted email) → create
   tournament → generate bracket → add participants → set attendance →
   update match score/winner → log out → log in as a second, non-whitelisted
   account → confirm it lands as VIEWER → Tournament List shows the
   tournament → open Bracket View → confirm latest data is visible and no
   admin controls are rendered → attempt a direct Firestore write from the
   browser console as VIEWER and confirm `PERMISSION_DENIED`.

## 9. Out of Scope / Non-Goals

- No Cloud Functions (custom claims auto-assignment or scheduled cleanup) —
  explicitly deferred per user decision; can be revisited later if the
  project moves to the Blaze plan.
- No automatic migration of legacy `localStorage` fee/payment data.
- No password reset / email verification flows beyond Firebase Auth's
  built-in defaults (not requested).
- No new hosting/server infrastructure — app remains a static site.
