# Family Productivity Hub

**One Family • Individual Responsibilities • One Central Dashboard**

A production-ready family task, schedule, goal, and habit management web
application built with HTML5, CSS3, vanilla JavaScript (ES6+), and Firebase
(Authentication, Cloud Firestore, Hosting, Security Rules).

Every task, goal, and habit is individually assignable to a specific family
member — checking one child's task never affects another's.

**This app runs entirely on Firebase's free "Spark" plan — no Cloud
Functions and no billing account are required.** See §14 for exactly how
that works and the trade-offs involved.

---

## 1. What's in this delivery

All application files are provided flat, in a single folder, as requested:

```
index.html              Landing page — create a family or join one with an access key
login.html               Returning-user sign-in
dashboard.html            The application shell (planners, goals, habits, reports, family, settings)

style.css                 Design system: tokens, typography, buttons, forms, modals
dashboard.css              App-shell layout: sidebar, KPI cards, task cards, planners
responsive.css              Tablet/mobile breakpoints, bottom nav, accessibility

firebase-config.js          Firebase initialization (fill in your Web config)
auth.js                    Sign-up, sign-in, sign-out, password reset, route protection,
                            family creation, access-key redemption
family.js                   Family member CRUD + access-key generation/revocation
tasks.js                    Task CRUD, recurring tasks, conflict detection, planners
goals.js                    Goals CRUD
habits.js                   Habits CRUD + streak tracking
reports.js                   Activity log, reports, points, CSV export
settings.js                  Theme, palette, categories, points toggle
dashboard.js                Main controller wiring every view together
utilities.js                Shared helpers (dates, formatting, toasts, dialogs,
                            SHA-256 hashing + secure key generation)
email-config.js              EmailJS credentials (fill in once — see §15)
email-reminders.js            Task-added / upcoming / completed / overdue email logic

manifest.json               Web App Manifest — installable on iPhone/Android/desktop
service-worker.js            App-shell caching + offline fallback
pwa-register.js               Registers the service worker; shows the install banner / iOS tip
icon-192.png, icon-512.png,
icon-maskable-512.png,
apple-touch-icon.png,
favicon.ico, favicon-16.png,
favicon-32.png                 Generated icon set matching the app's navy/blue palette

firestore.rules               Firestore Security Rules — authentication, family isolation,
                              role-based access, AND access-key/role-assignment security
                              (this replaces what a Cloud Function used to do — see §14)
firestore.indexes.json         Composite indexes required by the app's queries
firebase.json                 Hosting + Firestore deployment config
.firebaserc                    Firebase project alias (edit with your project ID)
.gitignore                     Keeps node_modules/, local Firebase cache, and secrets out of Git

privacy.html                   Privacy Policy page (see §22)

package.json                   devDependencies + scripts for running tests (see §19) —
                              never deployed to Hosting
tests/utilities.test.mjs        Unit tests (Node's built-in test runner, zero extra installs)
tests/firestore.rules.test.mjs    Security Rules tests, run against the free Firestore Emulator

.github/workflows/            GitHub Actions — automatic deploy on push (see §12) and
                              test runs on every push/PR (see §19)

functions-index.js            OPTIONAL, not deployed by default — legacy/upgrade-path
functions-package.json         Cloud Functions, kept only for anyone who later switches
                              to the paid Blaze plan for extra server-side hardening (§14)
```

---

## 2. Prerequisites

- A Google account
- [Node.js](https://nodejs.org) 20 or later
- The Firebase CLI: `npm install -g firebase-tools`

No credit card, billing account, or paid plan of any kind is required.

---

## 3. Firebase project setup

1. **Create a Firebase project** at https://console.firebase.google.com.
2. **Enable Authentication** → Sign-in method → enable **Email/Password**
   (and **Google**, optionally).
3. **Create a Firestore database** → Build → Firestore Database → Create
   database → start in **production mode** (the provided `firestore.rules`
   will govern access).
4. **Register a Web App**: Project settings → General → "Your apps" → Web
   (`</>`) → copy the resulting `firebaseConfig` object.
5. Paste that config into **`firebase-config.js`**, replacing the
   placeholder values:

   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```

   These values identify your project publicly and are safe to ship in
   client code — they are **not** secrets. Real protection comes from
   Firebase Authentication + `firestore.rules`, never from hiding this
   config.

   > ⚠️ **Never** put a Firebase **Admin SDK service-account key** or any
   > "admin password" in this file or anywhere else in the frontend.

That's it — no Functions, no billing, nothing else to enable.

---

## 4. Install, log in, and link the project

```bash
firebase login
firebase init
```

When prompted by `firebase init`, choose **Hosting** and **Firestore**
only (leave **Functions** unchecked — it isn't needed), select your
existing project, and when it asks whether to overwrite `firebase.json` /
`firestore.rules` / `firestore.indexes.json`, say **No** — keep the ones
provided here.

---

## 5. Deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only hosting
```

Or all at once:

```bash
firebase deploy
```

Firebase Hosting will print a live URL (`https://YOUR_PROJECT_ID.web.app`).

---

## 6. First-time use

1. Open the Hosting URL → you'll land on **index.html**.
2. Choose **Create a Family** → enter your name, a family name, email, and
   password. This makes you the family's Admin/Parent — `firestore.rules`
   verifies the write is legitimate before it's ever accepted (see §14);
   the client never simply "sets" this role.
3. From the **Access Keys** page in the dashboard, generate an invitation
   (e.g. `FAM-7K2P-91XZ`) with a role (Parent/Child), an expiry, and a
   maximum number of uses. The key is shown to you exactly once — copy it
   immediately.
4. Share the key with a family member. They open the site, choose **Join a
   Family**, enter the key plus their own name/email/password. Redemption
   is validated and atomically consumed via a Firestore transaction, so a
   single-use key can never be redeemed twice, even by two people at once.
5. Start assigning tasks: **+ Add Task**, choose who it's for, set the date,
   time, category, and priority, and save.

---

## 7. Security model, in plain terms

| Concern | How it's handled |
|---|---|
| Who can sign in | Firebase Authentication (email/password, optional Google) |
| Who a user is (role, family) | Read from `users/{uid}`, a document that can only ever be **created once** — `firestore.rules` requires the write to prove it either founded a brand-new family or redeemed a real, already-consumed access key — and can **never be updated** afterward |
| Cross-family data access | Every Firestore rule re-checks the caller's own `familyId` (from their own `users/{uid}` doc) against the document path; a client-supplied `familyId` is never trusted on its own |
| Access keys | Never stored or compared in plaintext — hashed with SHA-256 client-side (Web Crypto API) before touching Firestore; redemption count is incremented inside a Firestore transaction to prevent race-condition overuse |
| A child editing another child's task | Structurally impossible — task documents are addressed by ID, and rules additionally block a child from touching any task whose `assignedTo` isn't their own `memberId` |
| A child promoting themselves to admin | `users/{uid}` is create-once/never-updatable, and rules independently verify the family-ownership or key-redemption proof before allowing that one create |
| Deleting historical data | Tasks, goals, habits, and members use soft-delete (`archived: true` / `active: false`); hard deletes are denied by `firestore.rules` |

For the full reasoning behind this rules-only model — including what's
different from a Cloud-Functions-based design and the honest trade-offs —
see **§14**.

---

## 8. Testing checklist (Section 61)

Before considering a deployment complete, verify:

- [ ] Sign up, log in, log out, wrong password, password reset
- [ ] Valid / invalid / expired / revoked / max-used / reused access keys
- [ ] A second test family cannot see the first family's data
- [ ] Create, read, update, complete, uncomplete, and delete a task
- [ ] Child 1's checkbox never affects Child 2's task
- [ ] Dashboard KPI numbers update immediately after a change
- [ ] A recurring task creates the expected instances with no duplicates
- [ ] Two different family members with the same time slot do **not** show a
      conflict; the same member with overlapping times **does**
- [ ] Layout on an iPhone-width and Android-width viewport, and on desktop
- [ ] Two people attempting to redeem the same single-use key at the same
      moment — only one should succeed

---

## 9. Customization

- **Colors**: change the CSS variables at the top of `style.css`, or use the
  in-app **Settings → Appearance → Palette** picker (parents only).
- **Categories**: add custom categories from **Settings → Task Categories**.
- **Productivity points**: toggle on/off from **Settings → Productivity
  Points**; scoring logic lives in `reports.js` → `calculatePoints()`.
- **Dark mode**: `Settings → Appearance → Theme` (Light / Dark / System).

---

## 10. Support

This is a self-hosted application — you own the Firebase project and all
family data within it. There is no external service involved beyond
Firebase and (optionally) GitHub.

---

## 11. Install on any device (Progressive Web App)

The app is a fully installable Progressive Web App: a manifest, a service
worker, an install-prompt helper script, a generated icon set, and a
handful of `<head>` tags.

**How families install it:**

| Device | How |
|---|---|
| **Android (Chrome/Edge)** | A "Install" banner appears automatically (or use the browser menu → *Install app* / *Add to Home screen*). |
| **iPhone/iPad (Safari)** | A one-time tip points to it: tap the **Share** icon → **Add to Home Screen**. iOS does not offer an automatic install prompt — this is an Apple/WebKit platform restriction, not something a web app can override. |
| **Windows/Mac/Linux (Chrome, Edge, Brave)** | An install icon appears in the address bar, or use the same in-app "Install" banner. |

Once installed, the app opens in its own window (no browser address bar),
gets a home-screen/dock icon, and continues to work offline for
already-loaded screens thanks to the service worker's app-shell cache —
live family data itself is kept fresh separately by Firestore's own offline
persistence (already configured in `firebase-config.js`).

All of this is served for free from Firebase Hosting's existing free tier
(the whole icon set + manifest + service worker together add well under
50 KB).

---

## 12. Deploying automatically with GitHub

This repo is ready to push to GitHub as-is — the flat file layout does not
need to change. Workflows are included under `.github/workflows/`:

| Workflow | Runs on | What it does |
|---|---|---|
| `firebase-hosting-merge.yml` | every push to `main` | Deploys the app (HTML/CSS/JS/icons) to your live Hosting URL |
| `firebase-hosting-pull-request.yml` | every pull request | Publishes a temporary preview link (auto-expires in 7 days) so changes can be reviewed before merging |
| `firebase-backend-deploy.yml` | push to `main` that touches `firestore.rules` or `firestore.indexes.json` | Deploys the (free) Firestore rules & indexes |
| `firebase-functions-deploy-optional.yml` | **manual only** (Actions tab → Run workflow) | Deploys `functions-index.js` — only relevant if you've upgraded to Blaze (§14); does nothing unless you trigger it |

### One-time setup (5 minutes, free)

1. **Push this project to a new GitHub repository** (public or private —
   both work with everything below).
2. **Create a Firebase service account key** (this is free — it's an
   identity, not a paid product):
   - Firebase Console → ⚙️ **Project settings** → **Service accounts** →
     **Generate new private key**. This downloads a `.json` file.
   - ⚠️ Never commit this file to Git — `.gitignore` already excludes any
     file with "serviceAccount" in its name as a safeguard.
3. **Add two repository secrets** (GitHub repo → **Settings** → **Secrets
   and variables** → **Actions** → **New repository secret**):
   - `FIREBASE_SERVICE_ACCOUNT` — paste the *entire contents* of the JSON
     file from step 2.
   - `FIREBASE_PROJECT_ID` — your Firebase project ID (Project settings →
     General → "Project ID").
4. **Update `.firebaserc`** — replace `YOUR_FIREBASE_PROJECT_ID` with your
   real project ID (this just sets the CLI's default project for anyone
   running `firebase deploy` locally; GitHub Actions uses the secret above
   regardless).
5. Push to `main`. All three automatic workflows (Hosting live, Hosting
   preview, Firestore rules/indexes) run immediately, no further setup, and
   no billing account of any kind.

No other configuration, build step, or paid GitHub feature is required —
GitHub Actions' free minutes allowance (unlimited for public repositories;
2,000 minutes/month for private repositories on a free personal account)
easily covers a project this size.

---

## 13. Cost transparency — everything here is free

| Service | Plan needed | Cost for a typical family |
|---|---|---|
| Firebase Hosting | Spark (free) | $0 — 10 GB storage / 360 MB per day transfer included |
| Firebase Authentication | Spark (free) | $0 — unlimited email/password users |
| Cloud Firestore (data + the `get()` calls inside `firestore.rules`) | Spark (free) | $0 — 1 GiB storage, 50K reads / 20K writes / 20K deletes per day, included free |
| GitHub + GitHub Actions | Free plan | $0 — unlimited Actions minutes on public repos; a generous free monthly allowance on private repos |
| Web App Manifest, service worker, icons | N/A | $0 — static files served by Hosting's existing free tier |
| Cloud Functions (`functions-index.js`) | Not used by default | $0 — kept only as an optional future upgrade; see §14 |

There is no line item here that requires a credit card. The Blaze-plan
requirement described in earlier drafts of this project has been fully
removed from the default setup — see §14 for exactly how.

---

## 14. How Cloud Functions were bypassed (no Blaze plan needed)

The original design used four small Cloud Functions purely for one job:
proving that a `users/{uid}` document's `role` and `familyId` fields were
legitimate before they were written, so a family member could never simply
edit their own profile to claim `role: "admin"`. Cloud Functions are one
way to do that, but they're not the only way — **Firestore Security Rules
plus Firestore's own client-side transactions can enforce the identical
guarantee**, and both of those are fully included in Firebase's free Spark
plan.

### What changed

| | Before (Cloud Functions) | Now (Spark/free) |
|---|---|---|
| Who creates the family + admin profile | `createFamily` Cloud Function | `auth.js` writes the documents directly, in a specific order (family → founding member → settings → your profile) that `firestore.rules` checks step-by-step |
| Who generates an access key | `generateAccessKey` Cloud Function | `family.js` generates it, hashes it with SHA-256 (Web Crypto API), and writes it directly — `firestore.rules` independently re-verifies you're a parent/admin of that family and that the starting values are sane |
| Who redeems an access key | `redeemAccessKey` Cloud Function | `auth.js` runs a **Firestore transaction** (a database feature on every plan, not a Cloud Functions feature) that atomically checks and increments the key's use count, then creates your member + profile documents, which `firestore.rules` verifies reference a key that was just genuinely consumed |
| Who revokes a key | `revokeAccessKey` Cloud Function | `family.js` flips `active: false` directly — `firestore.rules` only allows that single-field change, and only by that family's own parent/admin |

Nothing about *what* is protected changed — cross-family data isolation,
one-time role assignment, single-use/expiring/revocable keys, and
per-child task isolation are all still fully enforced. What changed is
*where* the enforcement lives: inside `firestore.rules` (evaluated by
Firestore itself, for free, on every request) instead of inside a
Cloud Function (which requires the Blaze plan to deploy at all).

### The honest trade-offs

This pattern is widely used by production Firebase apps that want to stay
on the free tier, but it isn't a byte-for-byte identical replacement for a
server function. Two differences are worth knowing about:

1. **No built-in rate limiting on key-redemption attempts.** A Cloud
   Function can throttle repeated wrong guesses by IP or account; Firestore
   rules cannot. In practice this is a small gap: access keys are drawn
   from a 32-character alphabet across 8 random characters (roughly
   10¹² combinations), and each guess costs a real Firestore document read
   against your project's daily quota — brute-forcing one is not
   practical for anyone targeting a private family's invite code.
2. **Slightly more surface area in the rules themselves.** The security
   logic now lives in a longer `firestore.rules` file instead of a
   separate, more easily unit-tested server file. It's still fully
   readable and commented section-by-section, and this README explains
   the reasoning behind every branch — but it does mean any future changes
   to the family/access-key flow should be made carefully, on both the
   client code *and* the matching rule.

If neither of those matters for your use case (a private, real-world
family sharing invite codes only with people they trust), this approach is
a reasonable, well-established, and completely free choice.

### If you ever want the stronger, Cloud-Functions version back

`functions-index.js` and `functions-package.json` were kept in this
project exactly as they were, unused by default. If you later decide the
extra hardening is worth adding a payment method for:

1. Upgrade your Firebase project to the **Blaze (pay-as-you-go)** plan
   (Firebase Console → bottom-left plan badge → Upgrade). You are only
   ever billed for usage **above** the free monthly quota (2,000,000
   function invocations, 400,000 GB-seconds, 200,000 CPU-seconds, and 5 GB
   of outbound networking, every month) — a family app's access-key
   traffic will not come close to that ceiling, but Google does require a
   card on file to enable Functions at all on this plan.
2. Run:
   ```bash
   mkdir functions
   cp functions-index.js functions/index.js
   cp functions-package.json functions/package.json
   cd functions && npm install && cd ..
   ```
3. Add back to `firebase.json`:
   ```json
   "functions": [
     { "source": "functions", "codebase": "default", "runtime": "nodejs20" }
   ]
   ```
4. Deploy with `firebase deploy --only functions`, or trigger the included
   `firebase-functions-deploy-optional.yml` GitHub Actions workflow.
5. You'd also want to point `auth.js`/`family.js` back at
   `httpsCallable(...)` calls instead of the direct Firestore writes shown
   above, mirroring the original Cloud Functions version of those two
   files — the previous conversation turn that built them is a ready
   reference for exactly what that looked like.

Until and unless you do that, the app works exactly as described in
sections 1–13 above, at $0/month, with no billing account anywhere in the
picture.

---

## 15. Free Gmail email reminders

The app can now email the family automatically when a task is added, when
one is about to start, when it's completed, and if it goes overdue — using
[EmailJS](https://www.emailjs.com), a free, client-side email service that
can send through a personal Gmail account. No backend, no Blaze plan, no
cost for normal family volumes (free tier: 200 emails/month).

**Be aware of one honest limit up front:** since this runs entirely in the
browser — matching the rest of this app's Cloud-Functions-free design (see
§14) — the "upcoming" and "overdue" checks only run while some device
actually has the dashboard open (the installed PWA counts). "Task added"
and "task completed" emails are fully reliable regardless, since they fire
at the exact moment those actions happen in an already-open app. If you
later want guaranteed delivery with nobody's app open, that requires a
scheduled Cloud Function — the same optional Blaze upgrade path described
in §14.

### One-time setup (free, ~10 minutes)

1. **Create a free EmailJS account** at https://www.emailjs.com.
2. **Connect Gmail as an Email Service**: Email Services → Add New Service
   → Gmail → follow the OAuth prompt to connect your Gmail account. Note
   the **Service ID** it generates.
3. **Create one Email Template** (Email Templates → Create New Template).
   Set the **To email** field to `{{to_email}}`, and use a subject and body
   like:

   **Subject:**
   ```
   Family Productivity Hub: {{event_type}} — {{task_title}}
   ```

   **Content:**
   ```
   Hi {{to_name}},

   {{event_message}}

   Task: {{task_title}}
   Date: {{task_date}}
   Time: {{task_time}}

   — {{family_name}}
   ```

   Save it and note the **Template ID**.
4. **Get your Public Key**: Account → General → **Public Key**.
5. Paste all three into **`email-config.js`**:
   ```js
   export const EMAILJS_PUBLIC_KEY = "...";
   export const EMAILJS_SERVICE_ID = "...";
   export const EMAILJS_TEMPLATE_ID = "...";
   ```
6. Deploy (or just refresh, if testing locally). In the app, go to
   **Settings → Email Reminders**, turn it on, enter the notification email
   (typically the parent's Gmail), and set how many minutes before a task
   starts you want the reminder.

That's the entire setup — everything else (sending, dedup so you're not
emailed twice for the same reminder, the periodic check) is already wired
up in `email-reminders.js`.

### Per-child email addresses (optional)

If a family member has their own email on file (set via **+ Add Family
Member** → Email, or when editing them), their task emails go to *their*
address instead of the shared notification address — useful for an older
child who checks their own inbox. Leave it blank to fall back to the
family's shared notification email.

---

## 16. Deleting a family member's information

A parent/admin can now permanently delete a child's (or any member's)
profile: open **Family** (or the family-progress grid on the Dashboard) →
**Manage** on that person → **Delete Permanently**, in the confirmation
that follows.

What happens: the member's own profile document is deleted outright. Their
existing tasks, goals, and habits are archived (removed from active views)
rather than destroyed outright, so historical reports and the activity log
stay intact — only the member's personal profile itself is truly and
permanently removed. A softer **Deactivate** option is also available in
the same dialog if you'd rather just hide them from active use without
deleting anything.

For safety, a parent cannot deactivate or delete their own account from
this dialog (to avoid ever leaving a family with no admin) — the two
buttons simply don't appear when editing your own profile.

**Known limitation:** once deactivated (not deleted), a member currently
has no "reactivate" button in the UI — the member list only shows active
members. Reactivating one today means editing that document directly in
the Firebase Console (Firestore → families/{familyId}/members/{memberId} →
set `active` back to `true`). Adding a proper "inactive members" view with
a reactivate button would be a natural next enhancement if you need it
regularly.

---

## 17. Bug-fix changelog

A thorough pass was made through the entire codebase looking for anything
that was silently broken. Everything below was found and fixed; nothing
else in the app was changed alongside these fixes.

| # | Bug | Impact | Fix |
|---|---|---|---|
| 1 | `todayKey()` combined `setHours(0,0,0,0)` (local midnight) with `toISOString()` (which converts to UTC first) | For **every timezone ahead of UTC** — Lagos and effectively all of Africa, Europe, Asia, and Australia — "today," new-task defaults, the daily planner, and overdue detection were all silently off by one day | Added a timezone-safe `dateKey()` helper (uses local calendar fields directly, never converts to UTC) and routed every date-to-string conversion in the app through it |
| 2 | `confirmAction()`'s dialog element never received the `modal-overlay--visible` CSS class | Every confirmation dialog (delete task, delete goal, delete habit, deactivate member) was invisible — clicking Delete appeared to do nothing, forever | Added the visible class when the dialog is built |
| 3 | Clicking "Manage" on an existing family member and hitting Save always called `createMember` | Editing a member's name/age/email **created a duplicate member** instead of updating the original; `updateMember` and `deactivateMember` were both imported but never actually called anywhere | The member modal now tracks which member (if any) is being edited and calls the correct function |
| 4 | `deactivateMember()` called `confirmAction()` without importing it | Would have thrown `ReferenceError: confirmAction is not defined` the instant it was used — invisible until now only because it was never wired to a button | Added the missing import |
| 5 | Editing a task always submitted `recurring: "none"` | Editing any field (e.g. priority) on an existing recurring task instance silently wiped its recurrence metadata | Edits no longer touch `recurring` at all (it's a create-time-only concept here); the dropdown is disabled and shown correctly when editing |
| 6 | Editing a task's start/end time never recomputed `duration` | Cards and reports kept showing the *original* duration forever after a time edit | `updateTask()` now recomputes `duration` whenever a full field edit is submitted |
| 7 | If a parent declined to proceed past a schedule-conflict warning, the app still showed "Task created successfully" and closed the modal | Misleading — no task was actually saved, but nothing told the parent that | The create handler now checks `createTask`'s return value and reports "Task not saved" when it's `null` |
| 8 | The Reports view's Export CSV / Print buttons re-attached a click listener every time that view re-rendered (which happens on almost every state change) | After a few renders, one click could trigger several simultaneous CSV downloads or print dialogs | Moved to one-time wiring (`wireReportsActions()`, called once at startup) instead of re-binding on every render |
| 9 | The Weekly planner's task toggle/delete had no error handling | A failed action (permission or network error) failed silently there, while the same action showed a friendly error everywhere else | Added the same `.catch()` + toast used by every other task list |
| 10 | `findConflict()` opened a realtime `onSnapshot` listener just to read data once, unsubscribing inside its own callback | Worked, but was an unnecessary listener for a one-time check | Switched to `getDocs()`, the correct one-time-read API |

None of these required changing what any feature is *supposed* to do —
each one is a restoration of the behavior the app already documented
elsewhere (in this README, in code comments, or in the UI itself).

---

## 18. Adding several tasks at once, and custom date ranges

Two additions on top of everything above, both free and requiring no
Cloud Functions or Blaze plan:

**Add Multiple Tasks, from anywhere you plan.** The bulk-add modal (title,
assignee, date, times, category, priority per row, with "+ Add Another
Task") now has an entry point on the Dashboard *and* on the Daily, Weekly,
and Monthly planner headers — so a parent can jump straight into adding a
whole day's or week's tasks without leaving whichever view they're already
looking at. Every row still goes through the exact same `createTask()`
used for a single task, so validation and schedule-conflict warnings work
identically either way.

**Custom date ranges for the Weekly and Monthly planners.** Both planners
keep their original Previous/Next/"This Week" and calendar-month
navigation exactly as before — that's still the default. Alongside it,
each now has a **Start Date** / **End Date** picker: choose any range (up
to 90 days) and both planners render it as a horizontally-scrollable row
of day cards, so you're no longer limited to a fixed Monday–Sunday week or
a single calendar month. "Reset to This Week" / "Reset to Calendar View"
— or simply using Previous/Next again — returns to the standard view.

---

## 19. Testing

A real, runnable test suite now exists under `tests/`. Both suites are free
to run — no paid service, no Blaze plan.

```bash
npm install        # one-time; installs devDependencies only (see package.json)
npm run test:unit  # tests/utilities.test.mjs — dates, formatting, crypto helpers
npm run test:rules # tests/firestore.rules.test.mjs — runs against the free Firestore Emulator
npm test           # both, in sequence
```

**`tests/utilities.test.mjs`** uses Node's own built-in test runner
(`node:test`) — no test framework to install. It specifically regression-
tests the timezone bug from section 17 (`dateKey()` must never shift to a
different calendar day, in any timezone), plus `startOfWeek()`,
`formatTime()`, `minutesBetween()`, the status/overdue logic, and the
access-key crypto helpers (`sha256Hex()`, `generateReadableKey()`,
`maskKeyDisplay()`). Every assertion in it has been run and verified to
pass against this exact codebase.

**`tests/firestore.rules.test.mjs`** uses `@firebase/rules-unit-testing`
against the local Firestore Emulator (`npm run test:rules` starts and
stops the emulator for you automatically). It covers the three properties
the whole Cloud-Functions-free security model depends on (section 14):
family data isolation, `users/{uid}` role-assignment being create-once and
never updatable, and access-key redemption only ever moving `usageCount`
forward by exactly 1 and never past `maxUses`. This is a representative,
high-value subset of `firestore.rules`, not exhaustive coverage — extend it
alongside any future change to those areas.

**CI:** `.github/workflows/run-tests.yml` runs both suites on every push
and pull request. It's intentionally a separate, parallel check rather
than a hard gate wired into the existing deploy workflows (so as not to
modify those files) — if you want a merge to `main` blocked until tests
pass, add a GitHub branch protection rule requiring the "Run Tests" check,
from your repo's Settings → Branches (no workflow file changes needed).

---

## 20. Observability and App Check

Three more free Firebase features, all guarded so the app behaves exactly
as it does today if you leave them unconfigured — nothing breaks either
way.

**Analytics + Performance Monitoring** (`firebase-config.js`): free on
every Firebase plan, including Spark. Performance Monitoring needs no
setup beyond your existing config. Analytics only activates if you add a
real `measurementId` (Project settings → General → "Your apps" — only
present if you enabled Google Analytics for the project) in place of the
`YOUR_MEASUREMENT_ID` placeholder; otherwise it silently does nothing.

**App Check** (`firebase-config.js`): confirms that requests reaching
Firestore are genuinely coming from this deployed app, not a script
calling the Firestore REST API directly from outside it. Also free — the
reCAPTCHA v3 provider has no paid tier. To enable:

1. Register a site key at https://www.google.com/recaptcha/admin,
   choosing **reCAPTCHA v3**.
2. Firebase Console → **App Check** → register your web app → choose the
   **reCAPTCHA v3** provider → paste the same site key.
3. Paste that site key into `firebase-config.js`, replacing
   `YOUR_RECAPTCHA_V3_SITE_KEY`.
4. In Firebase Console → App Check → Firestore, you can optionally switch
   enforcement from "Monitor" to "Enforce" once you've confirmed the app
   still works normally with App Check active.

Left as the placeholder, App Check simply isn't active — every feature in
this app works exactly as it did before this section existed.

---

## 21. Security headers (Content-Security-Policy)

`firebase.json` now sends a real `Content-Security-Policy` header, plus
`X-Content-Type-Options` and `Referrer-Policy`, on every response — free,
since these are just HTTP headers Firebase Hosting serves for you. The
policy only allows scripts from this app's own origin, Google's Firebase
CDN, the EmailJS CDN, and Google's reCAPTCHA (for App Check); everything
else is blocked by default.

One deliberate, documented trade-off: `style-src` includes `'unsafe-inline'`
because a couple of existing, working features (the goal progress bar,
the custom date-range day grid) set inline `style` values directly. This
is a common, pragmatic choice — the primary XSS protection CSP provides
comes from restricting `script-src`, which remains strict with no
`'unsafe-inline'` or `'unsafe-eval'`.

---

## 22. Privacy Policy and accessibility

A **`privacy.html`** page was added — plain-language, and accurate to
exactly what this specific app collects (it's written for a self-hosted,
one-family deployment, not a multi-tenant product; see section 7's note
on that architectural fork if that ever changes). It's linked from the
sign-up page, the sign-in page, and the dashboard's Settings view.

**Modal focus-trapping** (`utilities.js`'s new `trapFocus()`, wired into
every modal in `dashboard.js` plus `confirmAction()`'s own dialog): keyboard
and screen-reader users can no longer Tab out of an open modal into the
page behind it, Escape now closes any modal the same way Cancel does, and
focus correctly returns to whatever triggered the modal once it closes —
the standard WAI-ARIA dialog pattern.

---

## 23. What's intentionally still on the roadmap

In the interest of landing a focused, well-tested slice rather than a
sprawling, harder-to-verify one, this pass did not include two items from
the original suggestions list:

- **Bounding the live Firestore listeners to a rolling date window.**
  `watchTasks`/`watchGoals`/`watchHabits` still load every non-archived
  record. This is genuinely fine at today's scale and remains free either
  way, but is worth a focused pass of its own once a family's history
  grows large, since it touches the core data-loading path in several
  files at once.
- **Recurring-series management** ("this occurrence / this and future /
  entire series"), **undo toasts**, and **drag-to-reschedule** — all still
  valid ideas from section's earlier review, not yet built.

Happy to take on any of these next, the same way: carefully, with tests
where it matters, and without disturbing what already works.
