/**
 * family.js
 * -----------------------------------------------------------------------
 * Family member CRUD (Section 9) + Access Key management UI (Sections 5,
 * 34, 53).
 *
 * ACCESS KEYS — Spark (free) plan security model, no Cloud Functions:
 * Keys live in a single top-level `accessKeys/{hashedKey}` collection,
 * where the document ID is the SHA-256 hash of the plaintext key (computed
 * client-side via the Web Crypto API in utilities.js). The plaintext is
 * never written to Firestore — only ever returned once, at the moment of
 * generation, for the parent to copy and share.
 * firestore.rules enforces everything a Cloud Function used to:
 *   - Only a parent/admin of the matching family may CREATE a key.
 *   - Redemption may only ever increment usageCount by exactly 1, and only
 *     while the key is active, unexpired, and under its max-use limit —
 *     enforced field-by-field in the rules, not trusted from the client.
 *   - Only a parent/admin of the matching family may revoke a key
 *     (flip `active` to false); no other field may change on that write.
 * See README §14 for the full explanation and its trade-offs.
 * -----------------------------------------------------------------------
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { el, generateReadableKey, sha256Hex, maskKeyDisplay } from "./utilities.js";
import { logActivity } from "./reports.js";

// ---- Firestore paths --------------------------------------------------
const membersCol = (familyId) => collection(db, "families", familyId, "members");
const accessKeysCol = () => collection(db, "accessKeys");

// ---- Members CRUD -------------------------------------------------------
export function watchMembers(familyId, callback) {
  const q = query(membersCol(familyId), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => {
    const members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(members);
  });
}

export async function createMember(familyId, session, { name, role, age, email }) {
  if (!name || !name.trim()) throw new Error("Please enter a name.");
  await addDoc(membersCol(familyId), {
    name: name.trim(),
    role: role || "child", // 'parent' | 'child'
    age: age || null,
    email: email || null,
    accountType: "pending", // becomes "linked" once the member redeems an access key
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: session.uid,
  });
  await logActivity(familyId, session, `Added family member "${name.trim()}"`);
}

export async function updateMember(familyId, session, memberId, updates) {
  await updateDoc(doc(db, "families", familyId, "members", memberId), {
    ...updates,
    updatedAt: serverTimestamp(),
    updatedBy: session.uid,
  });
  await logActivity(familyId, session, `Edited family member profile`);
}

// Soft-delete only (Section 9 / 44): historical tasks stay intact.
export async function deactivateMember(familyId, session, memberId, memberName) {
  const ok = await confirmAction({
    title: "Deactivate family member?",
    message: `${memberName}'s historical tasks and records will be preserved, but they will no longer appear as an active member.`,
    confirmLabel: "Deactivate",
  });
  if (!ok) return false;
  await updateDoc(doc(db, "families", familyId, "members", memberId), {
    active: false,
    updatedAt: serverTimestamp(),
    updatedBy: session.uid,
  });
  await logActivity(familyId, session, `Deactivated family member "${memberName}"`);
  return true;
}

// ---- Access Keys (Firestore-rules-secured, Spark/free plan) -------------
export function watchAccessKeys(familyId, callback) {
  const q = query(accessKeysCol(), where("familyId", "==", familyId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Generates a key, hashes it, and writes only the hash to Firestore.
// firestore.rules independently re-checks that the caller is a parent/admin
// of `familyId` and that the new document's usageCount/active/maxUses are
// all sane starting values — the client's honesty is never assumed.
export async function generateAccessKey(session, { role, expiresInDays, maxUses }) {
  // Math.round guarantees a true integer is sent to Firestore — the
  // security rule requires maxUses to satisfy `is int`, and a stray
  // decimal (e.g. unusual browser number-input behavior) would otherwise
  // be stored as a Firestore double and silently fail that check.
  const safeMaxUses = Math.round(Math.min(Math.max(Number(maxUses) || 1, 1), 50));
  const safeExpiryDays = Math.round(Math.min(Math.max(Number(expiresInDays) || 7, 1), 365));

  const plainKey = generateReadableKey();
  const hashed = await sha256Hex(plainKey);
  const expiresAt = Timestamp.fromMillis(Date.now() + safeExpiryDays * 86400000);
  const keyRef = doc(db, "accessKeys", hashed);

  await setDoc(keyRef, {
    familyId: session.familyId,
    role,
    maxUses: safeMaxUses,
    usageCount: 0,
    active: true,
    expiresAt,
    maskedKey: maskKeyDisplay(plainKey),
    createdAt: serverTimestamp(),
    createdBy: session.uid,
  });

  await logActivity(session.familyId, session, `Generated a new ${role === "parent" ? "Parent" : "Child"} access key`);

  // The plaintext is returned exactly once — the UI copies it to the
  // clipboard immediately and never stores it anywhere itself.
  return { key: plainKey, keyId: hashed };
}

// Revoking only ever flips `active` to false — firestore.rules rejects any
// update that touches usageCount, maxUses, role, or familyId here.
export async function revokeAccessKey(session, keyId) {
  await updateDoc(doc(db, "accessKeys", keyId), {
    active: false,
    revokedAt: serverTimestamp(),
    revokedBy: session.uid,
  });
  await logActivity(session.familyId, session, "Revoked an access key");
}

// ---- Rendering: Family Members list (used by dashboard.html) -----------
export function renderMembersList(container, members, { session, onEdit }) {
  container.innerHTML = "";
  if (!members.length) {
    container.appendChild(el("p", { class: "empty-state" }, "No family members yet. Add your first one to get started."));
    return;
  }
  members
    .filter((m) => m.active !== false)
    .forEach((member) => {
      const card = el("div", { class: "member-card" }, [
        el("div", { class: "member-card__avatar" }, member.name.slice(0, 1).toUpperCase()),
        el("div", { class: "member-card__info" }, [
          el("strong", {}, member.name),
          el("span", { class: "member-card__meta" }, `${member.role === "parent" ? "Parent" : "Child"} · ${
            member.accountType === "linked" ? "Account linked" : "Invitation pending"
          }`),
        ]),
        session.role === "admin" || session.role === "parent"
          ? el("button", {
              class: "btn btn--ghost btn--sm",
              onClick: () => onEdit(member),
            }, "Manage")
          : null,
      ]);
      container.appendChild(card);
    });
}

// ---- Rendering: Access Key management table (Section 53) ---------------
export function renderAccessKeysTable(container, keys, { onCopy, onRevoke }) {
  container.innerHTML = "";
  const table = el("table", { class: "data-table" });
  table.appendChild(
    el("thead", {}, el("tr", {}, [
      el("th", {}, "Key"),
      el("th", {}, "Role"),
      el("th", {}, "Created"),
      el("th", {}, "Expires"),
      el("th", {}, "Uses"),
      el("th", {}, "Status"),
      el("th", {}, "Action"),
    ]))
  );
  const tbody = el("tbody");
  keys.forEach((k) => {
    const created = k.createdAt?.toDate ? k.createdAt.toDate().toLocaleDateString() : "—";
    const expires = k.expiresAt?.toDate ? k.expiresAt.toDate().toLocaleDateString() : "Never";
    const status = k.active ? (k.usageCount >= k.maxUses ? "Used up" : "Active") : "Revoked";
    tbody.appendChild(
      el("tr", {}, [
        // Only the masked form is shown after creation (Section 53).
        el("td", {}, el("code", {}, k.maskedKey || "••••-••••-••••")),
        el("td", {}, k.role === "parent" ? "Parent" : "Child"),
        el("td", {}, created),
        el("td", {}, expires),
        el("td", {}, `${k.usageCount || 0} / ${k.maxUses}`),
        el("td", {}, el("span", { class: `pill pill--${status === "Active" ? "green" : status === "Used up" ? "amber" : "red"}` }, status)),
        el("td", {}, [
          k.plainKeyOnceOnly
            ? el("button", { class: "btn btn--ghost btn--sm", onClick: () => onCopy(k.plainKeyOnceOnly) }, "Copy")
            : null,
          k.active
            ? el("button", { class: "btn btn--ghost btn--sm btn--danger-text", onClick: () => onRevoke(k) }, "Revoke")
            : null,
        ]),
      ])
    );
  });
  table.appendChild(tbody);
  container.appendChild(table);
}
