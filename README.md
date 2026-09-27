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
