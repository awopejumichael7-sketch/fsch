/**
 * goals.js — Goals CRUD (Section 24)
 * Each goal is assignedTo one member. Different children can have
 * completely independent goals, exactly like tasks.
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { el, confirmAction } from "./utilities.js";
import { logActivity } from "./reports.js";

const goalsCol = (familyId) => collection(db, "families", familyId, "goals");

export function watchGoals(familyId, session, callback) {
  const base = goalsCol(familyId);
  const q =
    session.role === "child"
      ? query(base, where("assignedTo", "==", session.memberId), where("archived", "==", false))
      : query(base, where("archived", "==", false), orderBy("targetDate", "asc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function createGoal(familyId, session, input) {
  if (!input.title?.trim()) throw new Error("Please enter a goal title.");
  if (!input.assignedTo) throw new Error("Please assign this goal to a family member.");
  await addDoc(goalsCol(familyId), {
    familyId,
    assignedTo: input.assignedTo,
    title: input.title.trim(),
    description: input.description?.trim() || "",
    category: input.category || "Personal Development",
    startDate: input.startDate || new Date().toISOString().slice(0, 10),
    targetDate: input.targetDate || null,
    progress: 0,
    status: "not-started", // not-started | in-progress | completed | cancelled
    archived: false,
    createdBy: session.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(familyId, session, `Created goal "${input.title.trim()}"`);
}

export async function updateGoalProgress(familyId, session, goal, progress) {
  const clamped = Math.max(0, Math.min(100, progress));
  await updateDoc(doc(db, "families", familyId, "goals", goal.id), {
    progress: clamped,
    status: clamped >= 100 ? "completed" : clamped > 0 ? "in-progress" : "not-started",
    updatedAt: serverTimestamp(),
  });
}

export async function updateGoal(familyId, session, goalId, updates) {
  await updateDoc(doc(db, "families", familyId, "goals", goalId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteGoal(familyId, session, goal) {
  const ok = await confirmAction({ title: "Delete goal?", message: `"${goal.title}" will be archived.` });
  if (!ok) return false;
  await updateDoc(doc(db, "families", familyId, "goals", goal.id), { archived: true, updatedAt: serverTimestamp() });
  return true;
}

export function renderGoalCard(goal, members, { onUpdateProgress, onDelete }) {
  const assignee = members.find((m) => m.id === goal.assignedTo);
  return el("div", { class: "goal-card" }, [
    el("div", { class: "goal-card__header" }, [
      el("strong", {}, goal.title),
      assignee ? el("span", { class: "chip" }, assignee.name) : null,
    ]),
    goal.description ? el("p", { class: "goal-card__desc" }, goal.description) : null,
    el("div", { class: "progress-bar" }, el("div", { class: "progress-bar__fill", style: `width:${goal.progress}%` })),
    el("div", { class: "goal-card__footer" }, [
      el("input", {
        type: "range",
        min: "0",
        max: "100",
        value: String(goal.progress),
        "aria-label": `Progress for ${goal.title}`,
        onChange: (e) => onUpdateProgress(goal, Number(e.target.value)),
      }),
      el("span", {}, `${goal.progress}%`),
      el("button", { class: "icon-btn", title: "Delete goal", onClick: () => onDelete(goal) }, "🗑"),
    ]),
  ]);
}
