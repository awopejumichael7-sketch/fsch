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
 * Role assignment and access-key redemption are enforced entirely by
 * firestore.rules + the client code in auth.js/family.js — no Cloud
 * Functions and no Blaze (paid) plan are required. See README §14 for the
 * full explanation and the trade-offs of this approach.
 *
 * NEVER put a Firebase Admin SDK service-account key or any "admin
 * password" in this file or anywhere in the frontend.
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

// NOTE ON CLOUD FUNCTIONS (intentionally not initialized here):
// Family setup and access-key security now run entirely on Firestore
// Security Rules + client code (see auth.js and family.js), so this app
// works on Firebase's free "Spark" plan with no billing account required.
// Cloud Functions require the paid "Blaze" plan even for free-tier usage,
// so the Functions SDK is intentionally not loaded. functions-index.js and
// functions-package.json remain in this project only as an optional
// upgrade path for anyone who later switches to Blaze — see README §14.

// -------------------------------------------------------------------------
// 1. YOUR FIREBASE WEB CONFIG — replace with your own project's values
// -------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyASpQ_H_wDS-0yHdOlF0PQsfNz2qagfBtk",
  authDomain: "sass-fdea0.firebaseapp.com",
  projectId: "sass-fdea0",
  storageBucket: "sass-fdea0.firebasestorage.app",
  messagingSenderId: "594232822730",
  appId: "1:594232822730:web:ffa02a88bc33c85aa71d33",
};

// -------------------------------------------------------------------------
// 2. Initialize Firebase once and export shared handles
// -------------------------------------------------------------------------
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

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
