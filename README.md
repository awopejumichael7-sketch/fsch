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

.github/workflows/            GitHub Actions — automatic deploy on push (see §12)

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
