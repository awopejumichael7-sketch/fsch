/**
 * reports.js
 * -----------------------------------------------------------------------
 * Activity log writer (Section 32), report aggregation (Section 27),
 * productivity points (Section 26), and CSV/printable export (Section 59).
 * -----------------------------------------------------------------------
 */
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { computeStatus, todayKey, dateKey, startOfWeek, addDays } from "./utilities.js";

const logsCol = (familyId) => collection(db, "families", familyId, "activityLogs");

// Only non-sensitive fields are stored (Section 32: "Do not store
// unnecessary sensitive information").
export async function logActivity(familyId, session, action) {
  try {
    await addDoc(logsCol(familyId), {
      familyId,
      userId: session.uid,
      userName: session.name || session.email || "Unknown",
      action,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    // Logging should never block the primary action.
    console.warn("Could not write activity log:", err);
  }
}

export function watchActivityLog(familyId, callback, max = 50) {
  const q = query(logsCol(familyId), orderBy("timestamp", "desc"), limit(max));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// ---- Report aggregation (Section 27) --------------------------------------
export function buildReport(tasks, { dateFrom, dateTo, memberId, category, priority }) {
  const filtered = tasks.filter((t) => {
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    if (memberId && memberId !== "all" && t.assignedTo !== memberId) return false;
    if (category && category !== "all" && t.category !== category) return false;
    if (priority && priority !== "all" && t.priority !== priority) return false;
    return true;
  });

  const total = filtered.length;
  const completed = filtered.filter((t) => t.completed).length;
  const overdue = filtered.filter((t) => computeStatus(t) === "overdue").length;
  const pending = total - completed - overdue;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;

  const byCategory = {};
  filtered.forEach((t) => {
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  });

  return { total, completed, pending, overdue, completionRate, byCategory, tasks: filtered };
}

export function dailyReport(tasks, dateKey = todayKey()) {
  return buildReport(tasks, { dateFrom: dateKey, dateTo: dateKey });
}

export function weeklyReport(tasks, weekStart = startOfWeek()) {
  const from = dateKey(weekStart);
  const to = dateKey(addDays(weekStart, 6));
  return buildReport(tasks, { dateFrom: from, dateTo: to });
}

export function monthlyReport(tasks, year, month) {
  const from = dateKey(new Date(year, month, 1));
  const to = dateKey(new Date(year, month + 1, 0));
  return buildReport(tasks, { dateFrom: from, dateTo: to });
}

// ---- Productivity points (Section 26) --------------------------------------
export function calculatePoints(tasks, { bonusEnabled = true } = {}) {
  const byDay = {};
  tasks
    .filter((t) => t.completed)
    .forEach((t) => {
      const pts = t.priority === "High" ? 2 : 1;
      byDay[t.date] = (byDay[t.date] || 0) + pts;
    });
  if (bonusEnabled) {
    // Simple daily-completion bonus: +2 for any day with 3+ completed tasks.
    Object.keys(byDay).forEach((day) => {
      const dayTasks = tasks.filter((t) => t.date === day && t.completed);
      if (dayTasks.length >= 3) byDay[day] += 2;
    });
  }
  const total = Object.values(byDay).reduce((a, b) => a + b, 0);
  return { total, byDay };
}

// ---- CSV export (Section 59) ------------------------------------------------
export function exportTasksToCSV(tasks, members, filename = "family-productivity-report.csv") {
  const memberName = (id) => members.find((m) => m.id === id)?.name || "Unassigned";
  const header = ["Title", "Assigned To", "Category", "Priority", "Date", "Start", "End", "Status", "Completed"];
  const rows = tasks.map((t) => [
    t.title,
    memberName(t.assignedTo),
    t.category,
    t.priority,
    t.date,
    t.startTime,
    t.endTime,
    computeStatus(t),
    t.completed ? "Yes" : "No",
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function printReport() {
  window.print();
}
