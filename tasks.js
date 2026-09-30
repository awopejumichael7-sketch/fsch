/**
 * tasks.js
 * -----------------------------------------------------------------------
 * The heart of the application. Implements:
 *   - Task CRUD (Section 10)
 *   - Mandatory individual assignment (Section 11)
 *   - Daily / Weekly / Monthly planners (Sections 12-14)
 *   - Completion + automatic status (Sections 15-16)
 *   - Recurring tasks without duplication (Section 19)
 *   - Same-person-only conflict detection (Section 20)
 *   - Global search (Section 29) and combinable filters (Section 30)
 * -----------------------------------------------------------------------
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import {
  el,
  showToast,
  confirmAction,
  formatTime,
  formatDuration,
  minutesBetween,
  computeStatus,
  STATUS_LABELS,
  todayKey,
  dateKey,
  addDays,
  startOfWeek,
  escapeHTML,
} from "./utilities.js";
import { logActivity } from "./reports.js";

const tasksCol = (familyId) => collection(db, "families", familyId, "tasks");

// ---- Live task feed -------------------------------------------------------
// Parents see the whole family; children only ever query their own tasks —
// enforced again server-side by firestore.rules, this is defense in depth.
export function watchTasks(familyId, session, callback) {
  const base = tasksCol(familyId);
  const q =
    session.role === "child"
      ? query(base, where("assignedTo", "==", session.memberId), where("archived", "==", false))
      : query(base, where("archived", "==", false), orderBy("date", "asc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ---- CREATE ---------------------------------------------------------------
export async function createTask(familyId, session, input) {
  validateTaskInput(input);
  const duration = minutesBetween(input.startTime, input.endTime);

  const baseTask = {
    familyId,
    assignedTo: input.assignedTo, // REQUIRED — Section 11: always a specific member
    createdBy: session.uid,
    title: input.title.trim(),
    description: input.description?.trim() || "",
    category: input.category || "Other",
    priority: input.priority || "Medium",
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    duration,
    status: "not-started",
    completed: false,
    completedAt: null,
    recurring: input.recurring || "none", // none | daily | weekdays | weekly | monthly | custom
    recurrenceRule: input.recurring && input.recurring !== "none" ? {
      frequency: input.recurring,
      until: input.recurUntil || null,
      daysOfWeek: input.recurDaysOfWeek || null,
    } : null,
    notes: input.notes?.trim() || "",
    archived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Conflict check happens BEFORE saving so the parent can decide to proceed.
  const conflict = await findConflict(familyId, baseTask);
  if (conflict && !input.ignoreConflict) {
    const proceed = await confirmAction({
      title: "Schedule conflict detected",
      message: `This overlaps with "${conflict.title}" (${formatTime(conflict.startTime)}–${formatTime(conflict.endTime)}) already assigned to the same person. Save anyway?`,
      confirmLabel: "Save Anyway",
    });
    if (!proceed) return null;
  }

  if (baseTask.recurring !== "none") {
    return createRecurringSeries(familyId, session, baseTask);
  }

  const ref = await addDoc(tasksCol(familyId), baseTask);
  await logActivity(familyId, session, `Assigned "${baseTask.title}" to a family member`);
  return ref.id;
}

// Generates concrete task instances for a recurring rule, tagged with a
// shared seriesId so we never regenerate duplicates for the same series.
async function createRecurringSeries(familyId, session, baseTask) {
  const batch = writeBatch(db);
  const seriesId = `series_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const start = new Date(`${baseTask.date}T00:00:00`);
  const until = baseTask.recurrenceRule.until
    ? new Date(`${baseTask.recurrenceRule.until}T00:00:00`)
    : addDays(start, 90); // sensible 90-day horizon if no end date given

  let cursor = new Date(start);
  let count = 0;
  const MAX_INSTANCES = 366; // hard safety ceiling

  while (cursor <= until && count < MAX_INSTANCES) {
    const dow = cursor.getDay();
    const include =
      baseTask.recurrenceRule.frequency === "daily" ||
      (baseTask.recurrenceRule.frequency === "weekdays" && dow !== 0 && dow !== 6) ||
      (baseTask.recurrenceRule.frequency === "weekly" && cursor.getDay() === start.getDay()) ||
      (baseTask.recurrenceRule.frequency === "monthly" && cursor.getDate() === start.getDate()) ||
      (baseTask.recurrenceRule.frequency === "custom" &&
        (baseTask.recurrenceRule.daysOfWeek || []).includes(dow));

    if (include) {
      const ref = doc(tasksCol(familyId));
      batch.set(ref, {
        ...baseTask,
        date: dateKey(cursor),
        seriesId,
        completed: false,
        status: "not-started",
        completedAt: null,
      });
      count += 1;
    }
    cursor = addDays(cursor, 1);
  }

  await batch.commit();
  await logActivity(familyId, session, `Created recurring task "${baseTask.title}" (${count} instances)`);
  return seriesId;
}

// ---- UPDATE / COMPLETE ------------------------------------------------------
// Called only from the "edit task" modal, which always submits the full set
// of editable fields, so it's safe to validate and recompute derived fields
// the same way creation does (Section 43: don't allow a saved edit to leave
// invalid or stale data behind).
export async function updateTask(familyId, session, taskId, updates) {
  const payload = { ...updates };
  if (payload.title !== undefined && payload.startTime && payload.endTime) {
    validateTaskInput(payload);
    // BUG FIX: editing a task's start/end time never recomputed `duration`,
    // so the daily/weekly cards and reports kept showing the ORIGINAL
    // duration forever after an edit.
    payload.duration = minutesBetween(payload.startTime, payload.endTime);
  }
  await updateDoc(doc(db, "families", familyId, "tasks", taskId), {
    ...payload,
    updatedAt: serverTimestamp(),
    updatedBy: session.uid,
  });
}

// Toggling completion is scoped to ONE document ID, so it structurally
// cannot affect any other family member's task (Section 15).
export async function toggleTaskCompletion(familyId, session, task) {
  const completed = !task.completed;
  await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
    completed,
    status: completed ? "completed" : "not-started",
    completedAt: completed ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
  await logActivity(
    familyId,
    session,
    completed ? `Completed "${task.title}"` : `Marked "${task.title}" as not completed`
  );
}

export async function setTaskStatus(familyId, session, task, status) {
  await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
    status,
    completed: status === "completed",
    completedAt: status === "completed" ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

// ---- DELETE (soft-delete for historical integrity, Section 10) -----------
export async function deleteTask(familyId, session, task) {
  const ok = await confirmAction({
    title: "Delete this task?",
    message: `"${task.title}" will be removed from active views. This cannot be undone from the interface.`,
  });
  if (!ok) return false;
  await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
    archived: true,
    updatedAt: serverTimestamp(),
  });
  await logActivity(familyId, session, `Deleted task "${task.title}"`);
  return true;
}

// ---- Validation (Section 43) ----------------------------------------------
function validateTaskInput(input) {
  if (!input.title || !input.title.trim()) throw new Error("Task title is required.");
  if (!input.assignedTo) throw new Error("Please assign this task to a family member.");
  if (!input.date) throw new Error("Please choose a date.");
  if (!input.startTime || !input.endTime) throw new Error("Please set a start and end time.");
  if (minutesBetween(input.startTime, input.endTime) <= 0) {
    throw new Error("End time must be after start time.");
  }
}

// ---- Conflict detection (Section 20: SAME assignee only) -----------------
// Client-side check for instant UX feedback; the authoritative guard lives
// in Cloud Functions if you extend this app with server-side validation.
async function findConflict(familyId, task) {
  const q = query(
    tasksCol(familyId),
    where("assignedTo", "==", task.assignedTo),
    where("date", "==", task.date),
    where("archived", "==", false)
  );
  const snap = await getDocs(q);
  const newStart = timeToMinutes(task.startTime);
  const newEnd = timeToMinutes(task.endTime);
  const hit = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .find((existing) => {
      const s = timeToMinutes(existing.startTime);
      const e = timeToMinutes(existing.endTime);
      return newStart < e && s < newEnd;
    });
  return hit || null;
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// ---- Filtering + search (Sections 29-30) -----------------------------------
export function filterTasks(tasks, { memberId, category, priority, status, dateFrom, dateTo, searchTerm } = {}) {
  return tasks.filter((t) => {
    if (memberId && memberId !== "all" && t.assignedTo !== memberId) return false;
    if (category && category !== "all" && t.category !== category) return false;
    if (priority && priority !== "all" && t.priority !== priority) return false;
    if (status && status !== "all" && computeStatus(t) !== status) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    if (searchTerm) {
      const haystack = `${t.title} ${t.description} ${t.category}`.toLowerCase();
      if (!haystack.includes(searchTerm.toLowerCase())) return false;
    }
    return true;
  });
}

// ---- Planners --------------------------------------------------------------
export function tasksForDay(tasks, dateKey) {
  return tasks
    .filter((t) => t.date === dateKey)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function tasksForWeek(tasks, weekStartDate) {
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(weekStartDate, i);
    const key = dateKey(day);
    days.push({ dateKey: key, date: day, tasks: tasksForDay(tasks, key) });
  }
  return days;
}

export function tasksForMonth(tasks, year, month /* 0-indexed */) {
  const map = {};
  tasks.forEach((t) => {
    const d = new Date(`${t.date}T00:00:00`);
    if (d.getFullYear() === year && d.getMonth() === month) {
      map[t.date] = map[t.date] || [];
      map[t.date].push(t);
    }
  });
  return map;
}

// ---- Rendering: Task Card (Section 58) -------------------------------------
export function renderTaskCard(task, members, { session, onToggle, onEdit, onDelete }) {
  const assignee = members.find((m) => m.id === task.assignedTo);
  const status = computeStatus(task);
  const canEdit = session.role !== "child" || task.assignedTo === session.memberId;

  const card = el("div", { class: `task-card task-card--${task.priority?.toLowerCase() || "medium"} ${task.completed ? "task-card--done" : ""}` }, [
    el("div", { class: "task-card__time" }, `${formatTime(task.startTime)} – ${formatTime(task.endTime)}`),
    el("div", { class: "task-card__body" }, [
      el("div", { class: "task-card__title" }, task.title),
      el("div", { class: "task-card__meta" }, [
        assignee ? el("span", { class: "chip" }, assignee.name) : null,
        el("span", { class: "chip chip--muted" }, task.category),
        el("span", { class: `pill pill--${priorityColor(task.priority)}` }, task.priority),
        el("span", { class: `pill pill--${statusColor(status)}` }, STATUS_LABELS[status]),
      ]),
      task.completed
        ? el("div", { class: "task-card__completed-at" }, `✓ Completed${task.completedAt?.toDate ? " at " + task.completedAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`)
        : null,
    ]),
    el("div", { class: "task-card__actions" }, [
      el("label", { class: "checkbox" }, [
        el("input", {
          type: "checkbox",
          checked: task.completed ? "checked" : undefined,
          "aria-label": `Mark ${task.title} as completed`,
          onChange: () => onToggle(task),
        }),
        el("span", {}, "Mark as completed"),
      ]),
      canEdit && (session.role === "admin" || session.role === "parent")
        ? el("div", { class: "task-card__icon-btns" }, [
            el("button", { class: "icon-btn", title: "Edit task", onClick: () => onEdit(task) }, "✎"),
            el("button", { class: "icon-btn", title: "Delete task", onClick: () => onDelete(task) }, "🗑"),
          ])
        : null,
    ]),
  ]);
  return card;
}

function priorityColor(priority) {
  return { High: "red", Medium: "amber", Low: "grey" }[priority] || "grey";
}
function statusColor(status) {
  return { completed: "green", overdue: "red", "in-progress": "blue", cancelled: "grey", "not-started": "grey" }[status];
}
