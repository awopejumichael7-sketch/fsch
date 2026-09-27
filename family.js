/**
 * family.js
 * -----------------------------------------------------------------------
 * Family member CRUD (Section 9) + Access Key management UI (Sections 5,
 * 34, 53). Key generation/revocation and redemption are executed through
 * Cloud Functions (functions-index.js) — this file never trusts a raw
 * client-side "is this key valid?" check.
 * -----------------------------------------------------------------------
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import { db, functionsInstance, FN } from "./firebase-config.js";
import { el, showToast, friendlyError, confirmAction, generateId } from "./utilities.js";
import { logActivity } from "./reports.js";

// ---- Firestore paths --------------------------------------------------
const membersCol = (familyId) => collection(db, "families", familyId, "members");
const keysCol = (familyId) => collection(db, "families", familyId, "accessKeys");

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

// ---- Access Keys (generation/revocation go through Cloud Functions) -----
export function watchAccessKeys(familyId, callback) {
  const q = query(keysCol(familyId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function generateAccessKey({ role, expiresInDays, maxUses, memberId }) {
  const fn = httpsCallable(functionsInstance, FN.GENERATE_ACCESS_KEY);
  const res = await fn({ role, expiresInDays, maxUses, memberId });
  return res.data; // { key, keyId }
}

export async function revokeAccessKey(keyId) {
  const fn = httpsCallable(functionsInstance, FN.REVOKE_ACCESS_KEY);
  await fn({ keyId });
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
