/**
 * habits.js — Habits CRUD with streak tracking (Section 25)
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
import { el, todayKey, confirmAction } from "./utilities.js";
import { logActivity } from "./reports.js";

const habitsCol = (familyId) => collection(db, "families", familyId, "habits");

export function watchHabits(familyId, session, callback) {
  const base = habitsCol(familyId);
  const q =
    session.role === "child"
      ? query(base, where("assignedTo", "==", session.memberId), where("archived", "==", false))
      : query(base, where("archived", "==", false), orderBy("name", "asc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function createHabit(familyId, session, input) {
  if (!input.name?.trim()) throw new Error("Please name the habit.");
  if (!input.assignedTo) throw new Error("Please assign this habit to a family member.");
  await addDoc(habitsCol(familyId), {
    familyId,
    assignedTo: input.assignedTo,
    name: input.name.trim(),
    frequency: input.frequency || "daily", // daily | weekly | custom
    startDate: input.startDate || todayKey(),
    targetDate: input.targetDate || null,
    currentStreak: 0,
    longestStreak: 0,
    completedDates: [],
    archived: false,
    createdBy: session.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await logActivity(familyId, session, `Created habit "${input.name.trim()}"`);
}

// Toggles today's checkbox and recalculates streaks from completedDates.
export async function toggleHabitToday(familyId, session, habit) {
  const key = todayKey();
  const set = new Set(habit.completedDates || []);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  const sortedDates = Array.from(set).sort();
  const { currentStreak, longestStreak } = computeStreaks(sortedDates);
  await updateDoc(doc(db, "families", familyId, "habits", habit.id), {
    completedDates: sortedDates,
    currentStreak,
    longestStreak,
    updatedAt: serverTimestamp(),
  });
}

function computeStreaks(sortedDates) {
  if (!sortedDates.length) return { currentStreak: 0, longestStreak: 0 };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i += 1) {
    const prev = new Date(sortedDates[i - 1]);
    const cur = new Date(sortedDates[i]);
    const diffDays = Math.round((cur - prev) / 86400000);
    run = diffDays === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  // current streak = consecutive days ending today or yesterday
  const last = new Date(sortedDates[sortedDates.length - 1]);
  const today = new Date(todayKey());
  const gap = Math.round((today - last) / 86400000);
  const current = gap <= 1 ? run : 0;
  return { currentStreak: current, longestStreak: longest };
}

export async function deleteHabit(familyId, session, habit) {
  const ok = await confirmAction({ title: "Delete habit?", message: `"${habit.name}" will be archived.` });
  if (!ok) return false;
  await updateDoc(doc(db, "families", familyId, "habits", habit.id), { archived: true, updatedAt: serverTimestamp() });
  return true;
}

export function renderHabitCard(habit, members, { onToggleToday, onDelete }) {
  const assignee = members.find((m) => m.id === habit.assignedTo);
  const doneToday = (habit.completedDates || []).includes(todayKey());
  return el("div", { class: "habit-card" }, [
    el("label", { class: "checkbox checkbox--lg" }, [
      el("input", { type: "checkbox", checked: doneToday ? "checked" : undefined, onChange: () => onToggleToday(habit) }),
      el("span", {}, habit.name),
    ]),
    el("div", { class: "habit-card__meta" }, [
      assignee ? el("span", { class: "chip" }, assignee.name) : null,
      el("span", { class: "chip chip--muted" }, habit.frequency),
    ]),
    el("div", { class: "habit-card__streaks" }, [
      el("span", {}, `🔥 Current streak: ${habit.currentStreak || 0}`),
      el("span", {}, `🏆 Longest: ${habit.longestStreak || 0}`),
    ]),
    el("button", { class: "icon-btn", title: "Delete habit", onClick: () => onDelete(habit) }, "🗑"),
  ]);
}
