/**
 * firebase-config.js
 * -----------------------------------------------------------------------
 * Family Productivity Hub — Firebase bootstrap.
 *
 * SECURITY NOTE:
 * The values below are the Firebase **Web App configuration**. They are
 * safe to ship in client-side code — they identify your Firebase project,
 * they are NOT secrets. Real protection of your data comes from:
 *   1. Firebase Authentication (who is signed in)
 *   2. Firestore Security Rules (firestore.rules — what they may read/write)
 *   3. Cloud Functions (functions-index.js — sensitive server-side logic)
 *
 * NEVER put a Firebase Admin SDK service-account key, a Cloud Functions
 * secret, or any "admin password" in this file or anywhere in the
 * frontend. Those belong only on the server (Cloud Functions runtime).
 *
 * Replace the placeholder values with the config from:
 * Firebase Console → Project Settings → General → Your apps → Web app
 * -----------------------------------------------------------------------
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

// -------------------------------------------------------------------------
// 1. YOUR FIREBASE WEB CONFIG — replace with your own project's values
// -------------------------------------------------------------------------
const firebaseConfig = {
 apiKey: "AIzaSyASpQ_H_wDS-0yHdOlF0PQsfNz2qagfBtk",
  authDomain: "sass-fdea0.firebaseapp.com",
  projectId: "sass-fdea0",
  storageBucket: "sass-fdea0.firebasestorage.app",
  messagingSenderId: "594232822730",
  appId: "1:594232822730:web:ffa02a88bc33c85aa71d33"
};

// -------------------------------------------------------------------------
// 2. Initialize Firebase once and export shared handles
// -------------------------------------------------------------------------
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functionsInstance = getFunctions(app);

// Keep users signed in across tabs/reloads (session persistence requirement).
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Auth persistence could not be set:", err);
});

// Offline support (Section 38): cached data stays available without a
// connection and local writes sync automatically once it returns.
// This can only be enabled in one browser tab at a time, so we fail quietly
// if a second tab already claimed it.
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Offline persistence disabled: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("Offline persistence not supported in this browser.");
  }
});

// -------------------------------------------------------------------------
// 3. Cloud Function callable names (kept in one place to avoid typos)
// -------------------------------------------------------------------------
export const FN = {
  CREATE_FAMILY: "createFamily",
  GENERATE_ACCESS_KEY: "generateAccessKey",
  REDEEM_ACCESS_KEY: "redeemAccessKey",
  REVOKE_ACCESS_KEY: "revokeAccessKey",
  DEACTIVATE_MEMBER: "deactivateMember",
};
