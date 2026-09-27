/**
 * auth.js
 * -----------------------------------------------------------------------
 * Handles: email/password auth, Google sign-in, password reset, logout,
 * session persistence, and route protection.
 *
 * ROLE & FAMILY RESOLUTION (Sections 6, 7, 51, 54)
 * The client never decides its own role or familyId. After sign-in we read
 * the user's own `users/{uid}` document, which is written ONLY by trusted
 * Cloud Functions (createFamily / redeemAccessKey). Firestore rules forbid
 * a user from writing role/familyId on their own document (see
 * firestore.rules). This prevents "role: admin" client-side tampering.
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
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { auth, db, functionsInstance, FN } from "./firebase-config.js";
import { friendlyError, showToast } from "./utilities.js";

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
// Role assignment happens server-side in the `createFamily` Cloud Function —
// the client only supplies display info, never a role (Section 51).
export async function signUpAsParent({ email, password, name, familyName }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const createFamily = httpsCallable(functionsInstance, FN.CREATE_FAMILY);
  await createFamily({ name, familyName });
  return cred.user;
}

// ---- Sign up / sign in while redeeming a family access key ----------------
// Used by children (or a second parent) joining an existing family. The
// Cloud Function verifies the key server-side and writes the resulting
// role + familyId to `users/{uid}` — the client cannot set these fields.
export async function joinFamilyWithAccessKey({ email, password, name, accessKey, isNewAccount }) {
  let user;
  if (isNewAccount) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    user = cred.user;
  } else {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    user = cred.user;
  }
  const redeem = httpsCallable(functionsInstance, FN.REDEEM_ACCESS_KEY);
  await redeem({ accessKey, name });
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
