/**
 * functions-index.js
 * -----------------------------------------------------------------------
 * Firebase Cloud Functions (2nd gen, callable) for Family Productivity Hub.
 *
 * DEPLOYMENT NOTE: Firebase requires Cloud Functions source code to live in
 * its own directory (referenced by firebase.json → functions.source).
 * Rename/move this file to  functions/index.js  and functions-package.json
 * to  functions/package.json  before running `firebase deploy`. See
 * README.md for the exact commands.
 *
 * WHY THESE OPERATIONS ARE SERVER-SIDE (Sections 5, 34, 36, 51, 54, 60):
 *   - Role/familyId assignment must never be trusted from the client.
 *   - Access keys are never stored or compared in plaintext; the code the
 *     family sees is hashed (SHA-256) before it touches Firestore, so a
 *     database read alone can never reveal a usable key.
 *   - Usage counters are incremented inside a Firestore transaction so
 *     concurrent redemptions can't exceed maxUses (race-condition safe).
 *   - The Admin SDK used here bypasses firestore.rules by design — this is
 *     the ONLY place allowed to write `users/{uid}.role` and `.familyId`.
 * -----------------------------------------------------------------------
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const crypto = require("crypto");

initializeApp();
const db = getFirestore();

// ---- Helpers ----------------------------------------------------------------
function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to do this.");
  }
  return request.auth.uid;
}

async function requireAdminOrParent(uid) {
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("failed-precondition", "No family profile found for this account.");
  }
  const data = userSnap.data();
  if (data.role !== "admin" && data.role !== "parent") {
    throw new HttpsError("permission-denied", "Only a parent or admin can do this.");
  }
  return data;
}

function generateReadableKey() {
  // Format: FAM-XXXX-XXXX using an unambiguous alphabet (no 0/O/1/I).
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `FAM-${block()}-${block()}`;
}

function hashKey(plainKey) {
  return crypto.createHash("sha256").update(plainKey.trim().toUpperCase()).digest("hex");
}

function maskKey(plainKey) {
  const parts = plainKey.split("-");
  return `${parts[0]}-••••-${parts[2].slice(-2).padStart(4, "•")}`;
}

// =============================================================================
// createFamily — turns a brand-new signed-up user into the Admin/Parent owner
// of a brand-new family. (Section 51: controlled first-time setup.)
// =============================================================================
exports.createFamily = onCall(async (request) => {
  const uid = requireAuth(request);
  const { name, familyName } = request.data || {};
  if (!name || !name.trim()) throw new HttpsError("invalid-argument", "Please provide your name.");
  if (!familyName || !familyName.trim()) throw new HttpsError("invalid-argument", "Please provide a family name.");

  const existing = await db.collection("users").doc(uid).get();
  if (existing.exists) {
    throw new HttpsError("already-exists", "This account is already linked to a family.");
  }

  const familyRef = db.collection("families").doc();
  const memberRef = familyRef.collection("members").doc();
  const batch = db.batch();

  batch.set(familyRef, {
    name: familyName.trim(),
    ownerUid: uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  batch.set(memberRef, {
    name: name.trim(),
    role: "parent",
    uid,
    accountType: "linked",
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  batch.set(familyRef.collection("settings").doc("app"), {
    categories: [
      "Spiritual", "Education", "Homework", "Reading", "Work", "Household",
      "Chores", "Health/Fitness", "Personal Development", "Family", "Finance",
      "Appointment", "Rest", "Other",
    ],
    pointsEnabled: true,
    showLeaderboard: false,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // The ONLY place role='admin' and familyId are ever written for this user.
  batch.set(db.collection("users").doc(uid), {
    role: "admin",
    familyId: familyRef.id,
    memberId: memberRef.id,
    name: name.trim(),
    email: request.auth.token.email || null,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { familyId: familyRef.id, memberId: memberRef.id };
});

// =============================================================================
// generateAccessKey — parent/admin only. Stores a SHA-256 hash, never the
// plaintext key, and returns the plaintext exactly once. (Sections 5, 34, 53)
// =============================================================================
exports.generateAccessKey = onCall(async (request) => {
  const uid = requireAuth(request);
  const requester = await requireAdminOrParent(uid);
  const { role, expiresInDays, maxUses, memberId } = request.data || {};

  if (!["parent", "child"].includes(role)) {
    throw new HttpsError("invalid-argument", "Role must be 'parent' or 'child'.");
  }
  const safeMaxUses = Math.min(Math.max(Number(maxUses) || 1, 1), 50);
  const safeExpiryDays = Math.min(Math.max(Number(expiresInDays) || 7, 1), 365);

  const plainKey = generateReadableKey();
  const hashed = hashKey(plainKey);
  const expiresAt = Timestamp.fromMillis(Date.now() + safeExpiryDays * 86400000);

  const familyId = requester.familyId;
  const keyRef = db.collection("families").doc(familyId).collection("accessKeys").doc();

  const batch = db.batch();

  // Server-only lookup document — firestore.rules deny ALL client access to
  // this top-level collection; only the Admin SDK (this function) reads it.
  batch.set(db.collection("accessKeyIndex").doc(hashed), {
    familyId,
    keyId: keyRef.id,
    role,
    memberId: memberId || null,
    maxUses: safeMaxUses,
    usageCount: 0,
    active: true,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  // Family-visible management record — masked key only, never the plaintext.
  batch.set(keyRef, {
    maskedKey: maskKey(plainKey),
    role,
    maxUses: safeMaxUses,
    usageCount: 0,
    active: true,
    expiresAt,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  await batch.commit();

  return { key: plainKey, keyId: keyRef.id };
});

// =============================================================================
// redeemAccessKey — any authenticated user. Validates + atomically consumes
// a key, then performs the ONLY client-triggered write of role/familyId.
// (Sections 5, 34, 52, 54, 60)
// =============================================================================
exports.redeemAccessKey = onCall(async (request) => {
  const uid = requireAuth(request);
  const { accessKey, name } = request.data || {};
  if (!accessKey || !accessKey.trim()) {
    throw new HttpsError("invalid-argument", "Please enter an access key.");
  }

  const existingUser = await db.collection("users").doc(uid).get();
  if (existingUser.exists) {
    throw new HttpsError("already-exists", "This account already belongs to a family.");
  }

  const hashed = hashKey(accessKey);
  const indexRef = db.collection("accessKeyIndex").doc(hashed);

  const result = await db.runTransaction(async (tx) => {
    const indexSnap = await tx.get(indexRef);
    if (!indexSnap.exists) {
      throw new HttpsError("not-found", "This access key could not be found.");
    }
    const data = indexSnap.data();

    if (!data.active) {
      throw new HttpsError("failed-precondition", "This access key has been revoked.");
    }
    if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", "This access key has expired.");
    }
    if (data.usageCount >= data.maxUses) {
      throw new HttpsError("failed-precondition", "This access key has already reached its usage limit.");
    }

    const newUsageCount = data.usageCount + 1;
    const stillActive = newUsageCount < data.maxUses;

    tx.update(indexRef, { usageCount: newUsageCount, active: stillActive });

    const familyKeyRef = db.collection("families").doc(data.familyId).collection("accessKeys").doc(data.keyId);
    tx.update(familyKeyRef, { usageCount: newUsageCount, active: stillActive });

    // Reuse a pending member profile if this key was generated for one,
    // otherwise create a fresh member record for the new joiner.
    let memberRef;
    if (data.memberId) {
      memberRef = db.collection("families").doc(data.familyId).collection("members").doc(data.memberId);
      tx.update(memberRef, {
        uid,
        accountType: "linked",
        active: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      memberRef = db.collection("families").doc(data.familyId).collection("members").doc();
      tx.set(memberRef, {
        name: (name || "New Member").trim(),
        role: data.role,
        uid,
        accountType: "linked",
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: uid,
      });
    }

    tx.set(db.collection("users").doc(uid), {
      role: data.role,
      familyId: data.familyId,
      memberId: memberRef.id,
      name: (name || "New Member").trim(),
      email: request.auth.token.email || null,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(db.collection("families").doc(data.familyId).collection("activityLogs").doc(), {
      familyId: data.familyId,
      userId: uid,
      userName: (name || "New Member").trim(),
      action: `Joined the family using an access key (${data.role})`,
      timestamp: FieldValue.serverTimestamp(),
    });

    return { familyId: data.familyId, memberId: memberRef.id, role: data.role };
  });

  return result;
});

// =============================================================================
// revokeAccessKey — parent/admin only. Deactivates both the lookup entry and
// the family-visible record so the key can never be redeemed again.
// =============================================================================
exports.revokeAccessKey = onCall(async (request) => {
  const uid = requireAuth(request);
  const requester = await requireAdminOrParent(uid);
  const { keyId } = request.data || {};
  if (!keyId) throw new HttpsError("invalid-argument", "Missing key id.");

  const familyKeyRef = db.collection("families").doc(requester.familyId).collection("accessKeys").doc(keyId);
  const keySnap = await familyKeyRef.get();
  if (!keySnap.exists) throw new HttpsError("not-found", "Access key not found.");

  await familyKeyRef.update({ active: false, revokedAt: FieldValue.serverTimestamp(), revokedBy: uid });

  // Best-effort: also deactivate the lookup entry by scanning for the
  // matching keyId (small collection per family; safe to query here since
  // this runs with Admin SDK privileges, not subject to firestore.rules).
  const indexQuery = await db
    .collection("accessKeyIndex")
    .where("familyId", "==", requester.familyId)
    .where("keyId", "==", keyId)
    .limit(1)
    .get();
  if (!indexQuery.empty) {
    await indexQuery.docs[0].ref.update({ active: false });
  }

  return { success: true };
});
