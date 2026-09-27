# Family Productivity Hub

**One Family • Individual Responsibilities • One Central Dashboard**

A production-ready family task, schedule, goal, and habit management web
application built with HTML5, CSS3, vanilla JavaScript (ES6+), and Firebase
(Authentication, Cloud Firestore, Cloud Functions, Hosting, Security Rules).

Every task, goal, and habit is individually assignable to a specific family
member — checking one child's task never affects another's.

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
auth.js                    Sign-up, sign-in, sign-out, password reset, route protection
family.js                   Family member CRUD + access-key management UI
tasks.js                    Task CRUD, recurring tasks, conflict detection, planners
goals.js                    Goals CRUD
habits.js                   Habits CRUD + streak tracking
reports.js                   Activity log, reports, points, CSV export
settings.js                  Theme, palette, categories, points toggle
dashboard.js                Main controller wiring every view together
utilities.js                Shared helpers (dates, formatting, toasts, dialogs)

functions-index.js           Cloud Functions: createFamily, generateAccessKey,
                              redeemAccessKey, revokeAccessKey
functions-package.json         Cloud Functions dependencies

firestore.rules               Firestore Security Rules (authentication, family
                              isolation, role-based access)
firestore.indexes.json         Composite indexes required by the app's queries
firebase.json                 Hosting + Functions + Firestore deployment config
```

### A note on `functions-index.js` and `functions-package.json`

Firebase's own tooling **requires** Cloud Functions source code to live in a
dedicated `functions/` directory (this is how `firebase deploy` locates and
packages it — it is not a structural choice made in this project). Before
deploying, create that one required folder and move the two functions files
into it:

```bash
mkdir functions
mv functions-index.js functions/index.js
mv functions-package.json functions/package.json
```

Everything else (HTML, CSS, JS, rules, indexes, `firebase.json`) stays
exactly where it is, in the project's single root folder, which is also what
`firebase.json`'s `"hosting": { "public": "." }` expects.

---

## 2. Prerequisites

- A Google account
- [Node.js](https://nodejs.org) 20 or later
- The Firebase CLI: `npm install -g firebase-tools`

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
   Firebase Authentication + `firestore.rules` + Cloud Functions, never from
   hiding this config.

   > ⚠️ **Never** put a Firebase **Admin SDK service-account key**, a Cloud
   > Function secret, or any "admin password" in this file or anywhere else
   > in the frontend. Those belong only in the Cloud Functions runtime
   > (`functions/index.js`), which Firebase runs on Google's servers, not in
   > the browser.

---

## 4. Install, log in, and link the project

```bash
firebase login
firebase init
```

When prompted by `firebase init`, choose **Hosting**, **Firestore**, and
**Functions**, select your existing project, and when it asks whether to
overwrite `firebase.json` / `firestore.rules` / `firestore.indexes.json`,
say **No** — keep the ones provided here.

Then install the Cloud Functions dependencies:

```bash
mkdir functions
mv functions-index.js functions/index.js
mv functions-package.json functions/package.json
cd functions && npm install && cd ..
```

---

## 5. Deploy

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions
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
   password. A Cloud Function (`createFamily`) securely makes you the
   family's Admin/Parent — the client never sets this role itself.
3. From the **Access Keys** page in the dashboard, generate an invitation
   (e.g. `FAM-7K2P-91XZ`) with a role (Parent/Child), an expiry, and a
   maximum number of uses.
4. Share the key with a family member. They open the site, choose **Join a
   Family**, enter the key plus their own name/email/password, and a second
   Cloud Function (`redeemAccessKey`) validates and redeems it server-side.
5. Start assigning tasks: **+ Add Task**, choose who it's for, set the date,
   time, category, and priority, and save.

---

## 7. Security model, in plain terms

| Concern | How it's handled |
|---|---|
| Who can sign in | Firebase Authentication (email/password, optional Google) |
| Who a user is (role, family) | Read from `users/{uid}`, a document the client can **never** write — only Cloud Functions can, via the Admin SDK |
| Cross-family data access | Every Firestore rule re-checks the caller's own `familyId` against the document path; a client-supplied `familyId` is never trusted |
| Access keys | Never stored or compared in plaintext — hashed with SHA-256 before touching Firestore; redemption count is incremented inside a transaction to prevent race-condition overuse |
| A child editing another child's task | Structurally impossible — task documents are addressed by ID, and rules additionally block a child from touching any task whose `assignedTo` isn't their own `memberId` |
| A child promoting themselves to admin | Rules make `users/{uid}` entirely client-write-proof; role changes only ever come from Cloud Functions |
| Deleting historical data | Tasks, goals, habits, and members use soft-delete (`archived: true` / `active: false`); hard deletes are denied by `firestore.rules` |

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
Firebase itself.

---

## 11. Install on any device (Progressive Web App)

The app is a fully installable Progressive Web App. Nothing about the
existing pages, styles, or app logic changed to add this — it is purely
additive: a manifest, a service worker, an install-prompt helper script,
one generated icon set, and a handful of new `<head>` tags.

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

**New files this added** (all free to host on Firebase Hosting's existing
free tier — they add a negligible ~20 KB total):

```
manifest.json              Web App Manifest (name, icons, colors, start URL)
service-worker.js           App-shell caching + offline fallback
pwa-register.js              Registers the service worker; shows the install banner / iOS tip
icon-192.png, icon-512.png,
icon-maskable-512.png,
apple-touch-icon.png,
favicon.ico, favicon-16.png,
favicon-32.png                Generated icon set matching the app's existing navy/blue palette
```

**The only edits to existing files** were strictly additive lines needed
because browsers require these tags to exist directly in each page's own
`<head>` — no manifest link or install prompt can work otherwise:
- `index.html`, `login.html`, `dashboard.html`: a `<link rel="manifest">`,
  icon links, `theme-color`/Apple meta tags, and one
  `<script defer src="pwa-register.js">` before `</body>`.
- `firebase.json`: one additional header rule so `service-worker.js` and
  `manifest.json` are never cached stale (installed apps must always see
  the latest version) — the existing CSS/JS caching rule was left exactly
  as it was.

No CSS rule, JavaScript function, Firestore query, security rule, or piece
of visual design from the original build was altered.

---

## 12. Deploying automatically with GitHub

This repo is ready to push to GitHub as-is — the flat file layout does not
need to change. Three workflows are included under `.github/workflows/`:

| Workflow | Runs on | What it does |
|---|---|---|
| `firebase-hosting-merge.yml` | every push to `main` | Deploys the app (HTML/CSS/JS/icons) to your live Hosting URL |
| `firebase-hosting-pull-request.yml` | every pull request | Publishes a temporary preview link (auto-expires in 7 days) so changes can be reviewed before merging |
| `firebase-backend-deploy.yml` | push to `main` that touches `functions-index.js`, `functions-package.json`, `firestore.rules`, or `firestore.indexes.json` | Stages the Cloud Functions file into the `functions/` folder Firebase's CLI requires (inside the CI runner only — your repo stays flat) and deploys Firestore rules/indexes + Cloud Functions |

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
5. Push to `main`. The two Hosting workflows will run immediately with no
   further setup. If you also want Cloud Functions/Firestore rules deployed
   by GitHub Actions, make sure your project is on the **Blaze plan** first
   (see the cost note below) — otherwise the `firebase-backend-deploy.yml`
   run will fail with a clear billing-related error, and you can simply run
   `firebase deploy --only functions` from your own machine instead.

No other configuration, build step, or paid GitHub feature is required —
GitHub Actions' free minutes allowance (unlimited for public repositories;
2,000 minutes/month for private repositories on a free personal account)
easily covers a project this size.

---

## 13. Cost transparency — what's actually free here

Every service this project uses has a permanent free tier. The one
exception, noted plainly below, is a Google platform requirement rather
than a paid feature you're opting into.

| Service | Plan needed | Cost for a typical family |
|---|---|---|
| Firebase Hosting | Spark (free) | $0 — 10 GB storage / 360 MB per day transfer included, far more than this app needs |
| Firebase Authentication | Spark (free) | $0 — unlimited email/password users |
| Cloud Firestore | Spark (free) | $0 — 1 GiB storage, 50K reads / 20K writes / 20K deletes per day, included free |
| GitHub + GitHub Actions | Free plan | $0 — unlimited Actions minutes on public repos; a generous free monthly allowance on private repos |
| The Web App Manifest, service worker, icons | N/A | $0 — static files served by Hosting's existing free tier |
| **Cloud Functions** (used only for `createFamily`, `generateAccessKey`, `redeemAccessKey`, `revokeAccessKey`) | **Blaze (pay-as-you-go)** | **$0 in practice for normal family use**, but Google requires a billing method on file to enable Cloud Functions at all, even within the free monthly quota |

**About the Blaze-plan requirement:** this isn't a design choice made in
this project — it's how Google Cloud packages Cloud Functions. The Blaze
plan itself doesn't cost anything to switch to; you're simply asked to add
a payment method, and you are only ever charged for usage **above** the
free monthly quota (2,000,000 invocations, 400,000 GB-seconds, 200,000
CPU-seconds, and 5 GB of outbound networking, every month, forever). A
family generating and redeeming a handful of access keys and occasionally
creating a family account will not come close to that ceiling. To keep
peace of mind, you can additionally set a **Budget Alert** for free
(Google Cloud Console → Billing → Budgets & alerts) so you're notified —
at no cost — if usage ever approaches a threshold you choose.
