/**
 * utilities.js
 * -----------------------------------------------------------------------
 * Small, dependency-free helper functions shared by every page.
 * Nothing in this file talks to Firebase — it is pure UI/date logic so it
 * stays easy to unit test and reuse.
 * -----------------------------------------------------------------------
 */

// ---- DOM shortcuts --------------------------------------------------------
export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) =>
  Array.from(scope.querySelectorAll(selector));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

// ---- Toast / user-friendly errors (Section 37) ----------------------------
let toastHost = null;
function ensureToastHost() {
  if (!toastHost) {
    toastHost = el("div", { class: "toast-host", "aria-live": "polite" });
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

export function showToast(message, type = "info", timeout = 4200) {
  const host = ensureToastHost();
  const toast = el("div", { class: `toast toast--${type}` }, message);
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast--visible"));
  setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), 250);
  }, timeout);
}

// Maps raw Firebase error codes to plain-language messages. Never show a
// raw "FirebaseError: ..." string to a family member.
export function friendlyError(err) {
  const code = err && err.code ? err.code : "";
  const map = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "We couldn't find an account with that email.",
    "auth/wrong-password": "That password is incorrect.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Please choose a password with at least 6 characters.",
    "auth/network-request-failed": "Unable to save changes. Please check your internet connection.",
    "permission-denied": "You do not have permission to perform this action.",
    "functions/not-found": "This access key could not be found.",
    "functions/failed-precondition": "This access key has already reached its usage limit or expired.",
    "functions/permission-denied": "You do not have permission to perform this action.",
    "functions/resource-exhausted": "Too many attempts. Please wait a moment and try again.",
  };
  return map[code] || err.message || "Something went wrong. Please try again.";
}

// ---- Debounce (Section 29) -------------------------------------------------
export function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// ---- Date / time helpers ---------------------------------------------------
export function todayKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function formatFriendlyDate(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

export function minutesBetween(startHHMM, endHHMM) {
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

export function formatDuration(mins) {
  if (mins == null || isNaN(mins) || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // treat Monday as start of week
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function isOverdue(task) {
  if (task.completed) return false;
  if (!task.date) return false;
  const now = new Date();
  const deadline = new Date(`${task.date}T${task.endTime || "23:59"}`);
  return deadline.getTime() < now.getTime();
}

export function computeStatus(task) {
  if (task.status === "cancelled") return "cancelled";
  if (task.completed) return "completed";
  if (task.status === "in-progress") return "in-progress";
  if (isOverdue(task)) return "overdue";
  return "not-started";
}

export const STATUS_LABELS = {
  "not-started": "Not Started",
  "in-progress": "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const DEFAULT_CATEGORIES = [
  "Spiritual",
  "Education",
  "Homework",
  "Reading",
  "Work",
  "Household",
  "Chores",
  "Health/Fitness",
  "Personal Development",
  "Family",
  "Finance",
  "Appointment",
  "Rest",
  "Other",
];

export function generateId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Simple confirm dialog (Section 44) -----------------------------------
export function confirmAction({ title, message, confirmLabel = "Delete", cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const box = el("div", { class: "modal modal--confirm", role: "alertdialog", "aria-modal": "true" }, [
      el("h3", {}, title),
      el("p", {}, message),
      el("div", { class: "modal__actions" }, [
        el("button", {
          class: "btn btn--ghost",
          onClick: () => {
            overlay.remove();
            resolve(false);
          },
        }, cancelLabel),
        el("button", {
          class: "btn btn--danger",
          onClick: () => {
            overlay.remove();
            resolve(true);
          },
        }, confirmLabel),
      ]),
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

export function escapeHTML(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
