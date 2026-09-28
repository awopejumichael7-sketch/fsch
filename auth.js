/**
 * auth.js
 * -----------------------------------------------------------------------
 * Handles: email/password auth, Google sign-in, password reset, logout,
 * session persistence, and route protection.
 *
 * ROLE & FAMILY RESOLUTION — Spark (free) plan security model, no Cloud
 * Functions required (Sections 6, 7, 51, 54):
 * The client never decides its own role or familyId by simply writing
 * whatever it likes — `firestore.rules` only allows a `users/{uid}`
 * document to be CREATED, and only when the write satisfies one of two
 * narrow, rules-enforced conditions:
 *   1. role: 'admin' — allowed only if the caller is also the `ownerUid`
 *      of the brand-new `families/{familyId}` document referenced, which
 *      was itself just created moments earlier in this same sign-up flow.
 *   2. role: 'parent' | 'child' — allowed only if the caller supplies the
 *      SHA-256 hash of an access key that has ALREADY been validated and
 *      consumed (its usageCount just incremented) against that exact
 *      familyId/role, via `redeemAccessKey` below.
 * Once created, `users/{uid}` can never be updated by the client
 * (firestore.rules denies all updates to it) — role/familyId are
 * permanent from that point on. This is what stops "role: admin"
 * client-side tampering, without needing a paid Cloud Functions plan.
 * See README §14 for the full explanation and its trade-offs.
 * -----------------------------------------------------------------------
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  collection,
  getDoc,
  setDoc,
  addDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { friendlyError, showToast, sha256Hex, DEFAULT_CATEGORIES } from "./utilities.js";

/**
 * Returns the signed-in user's session profile:
 * { uid, email, role: 'admin'|'parent'|'child', familyId, memberId }
 * or null if not signed in / no profile yet (e.g. mid-onboarding).
 */
export async function getSessionProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

/** Wraps onAuthStateChanged with the resolved Firestore profile attached. */
export function watchSession(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null);
      return;
    }
    try {
      const profile = await getSessionProfile(user.uid);
      callback(profile ? { ...profile, authUser: user } : { uid: user.uid, authUser: user, pending: true });
    } catch (err) {
      console.error(err);
      callback({ uid: user.uid, authUser: user, pending: true });
    }
  });
}

/** Call at the top of any protected page. Redirects to login if needed. */
export function protectPage({ onReady }) {
  return watchSession((session) => {
    if (!session) {
      window.location.href = "login.html";
      return;
    }
    onReady(session);
  });
}

// ---- Sign up (new parent, becomes admin of a brand-new family) ------------
// Section 51's "controlled first-time setup" is now enforced by
// firestore.rules rather than a Cloud Function. The writes below MUST
// happen in this exact order: rules validate the `users/{uid}` write by
// checking that the referenced family already exists with ownerUid == you
// — which is only true once step 1 has actually committed.
export async function signUpAsParent({ email, password, name, familyName }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  const cleanName = name.trim();

  const existing = await getDoc(doc(db, "users", uid));
  if (existing.exists()) {
    throw new Error("This account is already linked to a family.");
  }

  const familyRef = doc(collection(db, "families"));
  const memberRef = doc(collection(db, "families", familyRef.id, "members"));

  // 1. Family document — rules require ownerUid === you and that you don't
  //    already have a users/{uid} profile.
  await setDoc(familyRef, {
    name: familyName.trim(),
    ownerUid: uid,
    createdAt: serverTimestamp(),
  });

  // 2. Your own member profile as the family's founding parent — rules
  //    check the family doc created above, which now exists.
  await setDoc(memberRef, {
    name: cleanName,
    role: "parent",
    uid,
    accountType: "linked",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
  });

  // 3. Default family settings.
  await setDoc(doc(db, "families", familyRef.id, "settings", "app"), {
    categories: DEFAULT_CATEGORIES,
    pointsEnabled: true,
    showLeaderboard: false,
    updatedAt: serverTimestamp(),
  });

  // 4. Your users/{uid} profile — the ONE write that grants role: 'admin'.
  //    Rules check that families/{familyId}.ownerUid === you, which is
  //    true because step 1 already committed.
  await setDoc(doc(db, "users", uid), {
    role: "admin",
    familyId: familyRef.id,
    memberId: memberRef.id,
    name: cleanName,
    email: cred.user.email,
    createdAt: serverTimestamp(),
  });

  await addDoc(collection(db, "families", familyRef.id, "activityLogs"), {
    familyId: familyRef.id,
    userId: uid,
    userName: cleanName,
    action: "Created the family",
    timestamp: serverTimestamp(),
  });

  return cred.user;
}

// ---- Sign up / sign in while redeeming a family access key ----------------
// Used by children (or a second parent) joining an existing family.
// Redemption is a Firestore transaction (a database feature available on
// every plan, including free Spark) that atomically increments the key's
// usageCount within its bounds — this is what prevents a limited-use key
// from ever being over-redeemed, with no server function involved.
export async function joinFamilyWithAccessKey({ email, password, name, accessKey, isNewAccount }) {
  let user;
  if (isNewAccount) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    user = cred.user;
  } else {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    user = cred.user;
  }
  const uid = user.uid;
  const cleanName = (name || "New Member").trim();

  const existing = await getDoc(doc(db, "users", uid));
  if (existing.exists()) {
    throw new Error("This account already belongs to a family.");
  }

  const hashed = await sha256Hex(accessKey);
  const keyRef = doc(db, "accessKeys", hashed);

  // 1. Atomically validate + consume the key. Throws a friendly error if
  //    it's missing, revoked, expired, or already used up.
  const keyData = await runTransaction(db, async (tx) => {
    const snap = await tx.get(keyRef);
    if (!snap.exists()) throw new Error("This access key could not be found.");
    const data = snap.data();
    if (!data.active) throw new Error("This access key has been revoked.");
    if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
      throw new Error("This access key has expired.");
    }
    if (data.usageCount >= data.maxUses) {
      throw new Error("This access key has already reached its usage limit.");
    }
    const newCount = data.usageCount + 1;
    tx.update(keyRef, { usageCount: newCount, active: newCount < data.maxUses });
    return data;
  });

  // 2. Create your member profile — rules check that `joinedViaKeyHash`
  //    points to a key doc whose familyId/role match and whose usageCount
  //    now shows it has genuinely been consumed (step 1 already committed).
  const memberRef = doc(collection(db, "families", keyData.familyId, "members"));
  await setDoc(memberRef, {
    name: cleanName,
    role: keyData.role,
    uid,
    joinedViaKeyHash: hashed,
    accountType: "linked",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
  });

  // 3. Your users/{uid} profile — the same joinedViaKeyHash proof grants
  //    role: 'parent' | 'child' (never 'admin') for this exact family.
  await setDoc(doc(db, "users", uid), {
    role: keyData.role,
    familyId: keyData.familyId,
    memberId: memberRef.id,
    name: cleanName,
    email: user.email,
    joinedViaKeyHash: hashed,
    createdAt: serverTimestamp(),
  });

  await addDoc(collection(db, "families", keyData.familyId, "activityLogs"), {
    familyId: keyData.familyId,
    userId: uid,
    userName: cleanName,
    action: `Joined the family using an access key (${keyData.role})`,
    timestamp: serverTimestamp(),
  });

  return user;
}

export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
  window.location.href = "login.html";
}

// ---- Form wiring helpers used directly by login.html / index.html --------
export function bindAuthForms() {
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = loginForm.email.value.trim();
      const password = loginForm.password.value;
      const btn = loginForm.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await loginWithEmail(email, password);
        window.location.href = "dashboard.html";
      } catch (err) {
        showToast(friendlyError(err), "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  const googleBtn = document.getElementById("google-signin-btn");
  if (googleBtn) {
    googleBtn.addEventListener("click", async () => {
      try {
        await loginWithGoogle();
        window.location.href = "dashboard.html";
      } catch (err) {
        showToast(friendlyError(err), "error");
      }
    });
  }

  const resetLink = document.getElementById("forgot-password-link");
  if (resetLink) {
    resetLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = prompt("Enter your account email to receive a reset link:");
      if (!email) return;
      try {
        await resetPassword(email);
        showToast("Password reset email sent.", "success");
      } catch (err) {
        showToast(friendlyError(err), "error");
      }
    });
  }

  const parentSignupForm = document.getElementById("parent-signup-form");
  if (parentSignupForm) {
    parentSignupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = parentSignupForm.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await signUpAsParent({
          email: parentSignupForm.email.value.trim(),
          password: parentSignupForm.password.value,
          name: parentSignupForm.name.value.trim(),
          familyName: parentSignupForm.familyName.value.trim(),
        });
        showToast("Family created. Welcome!", "success");
        window.location.href = "dashboard.html";
      } catch (err) {
        showToast(friendlyError(err), "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  const joinForm = document.getElementById("join-family-form");
  if (joinForm) {
    joinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = joinForm.querySelector("button[type=submit]");
      btn.disabled = true;
      const isNewAccount = joinForm.querySelector("input[name=account-mode]:checked").value === "new";
      try {
        await joinFamilyWithAccessKey({
          email: joinForm.email.value.trim(),
          password: joinForm.password.value,
          name: joinForm.name.value.trim(),
          accessKey: joinForm.accessKey.value.trim().toUpperCase(),
          isNewAccount,
        });
        showToast("You've joined the family!", "success");
        window.location.href = "dashboard.html";
      } catch (err) {
        showToast(friendlyError(err), "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => logout());
  }
}
