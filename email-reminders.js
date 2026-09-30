/**
 * email-reminders.js
 * -----------------------------------------------------------------------
 * Automatic email notifications for the family's schedule:
 *   - "New Task Scheduled"  — sent the moment a task is created
 *   - "Upcoming Reminder"   — sent once, shortly before a task starts
 *   - "Task Completed"      — sent the moment a task is marked done
 *   - "Task Overdue"        — sent once, if a task's end time passes
 *                             without it being completed
 *
 * Sent via EmailJS (see email-config.js), which can deliver through a
 * personal Gmail account you connect for free — no backend required.
 *
 * HONEST LIMIT, STATED PLAINLY: because this runs entirely in the browser
 * (matching the rest of this app's free, Cloud-Functions-free design — see
 * README section 14), these reminders only fire while a device actually
 * has the dashboard open (the installed PWA counts). There is no server
 * watching the clock while every device is asleep. "Task Added" and "Task
 * Completed" are still fully reliable, since they fire at the exact moment
 * the triggering action happens in an already-open app. "Upcoming" and
 * "Overdue" are checked about once a minute for as long as the app stays
 * open. If you need guaranteed delivery with nobody's app open, README
 * section 14 explains the optional Cloud Functions / Blaze-plan upgrade
 * path (a scheduled function), which this app does not require by default.
 * -----------------------------------------------------------------------
 */
import { EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID } from "./email-config.js";
import { formatTime, formatFriendlyDate } from "./utilities.js";

const CONFIGURED =
  EMAILJS_PUBLIC_KEY && !EMAILJS_PUBLIC_KEY.startsWith("YOUR_") &&
  EMAILJS_SERVICE_ID && !EMAILJS_SERVICE_ID.startsWith("YOUR_") &&
  EMAILJS_TEMPLATE_ID && !EMAILJS_TEMPLATE_ID.startsWith("YOUR_");

let initialized = false;
function ensureInit() {
  if (!CONFIGURED) return false; // EmailJS hasn't been set up yet — no-op, not an error
  if (typeof window === "undefined" || !window.emailjs) return false; // SDK script not loaded
  if (!initialized) {
    window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    initialized = true;
  }
  return true;
}

// A task is emailed to its assignee's own address if they have one on file
// (Section 9's optional member email), otherwise to the family's shared
// notification address from Settings.
function resolveRecipient(task, members, settings) {
  const assignee = members.find((m) => m.id === task.assignedTo);
  if (assignee?.email) return { email: assignee.email, name: assignee.name };
  if (settings?.notificationEmail) return { email: settings.notificationEmail, name: assignee?.name || "Family" };
  return null;
}

async function sendNotification({ eventType, eventMessage, task, recipient }) {
  if (!ensureInit()) return false;
  try {
    await window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: recipient.email,
      to_name: recipient.name,
      event_type: eventType,
      event_message: eventMessage,
      task_title: task.title,
      task_date: task.date ? formatFriendlyDate(task.date) : "",
      task_time: task.startTime && task.endTime ? `${formatTime(task.startTime)} - ${formatTime(task.endTime)}` : "",
      family_name: "Family Productivity Hub",
    });
    return true;
  } catch (err) {
    // Never let a failed email break the task flow that triggered it.
    console.warn("Email reminder failed to send:", err);
    return false;
  }
}

export async function notifyTaskAdded(task, members, settings) {
  if (!settings?.emailRemindersEnabled) return;
  const recipient = resolveRecipient(task, members, settings);
  if (!recipient) return;
  await sendNotification({
    eventType: "New Task Scheduled",
    eventMessage: `A new task has been scheduled: "${task.title}".`,
    task,
    recipient,
  });
}

export async function notifyTaskCompleted(task, members, settings) {
  if (!settings?.emailRemindersEnabled) return;
  const recipient = resolveRecipient(task, members, settings);
  if (!recipient) return;
  await sendNotification({
    eventType: "Task Completed",
    eventMessage: `"${task.title}" has been marked as completed. Great job!`,
    task,
    recipient,
  });
}

// ---- Periodic upcoming/overdue scan (client-side, app must be open) -------
const NOTIFIED_STORAGE_KEY = "fph-email-notified";

function getNotifiedLog() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}
function markNotified(key) {
  const log = getNotifiedLog();
  log[key] = Date.now();
  const cutoff = Date.now() - 3 * 86400000; // trim entries older than 3 days
  Object.keys(log).forEach((k) => {
    if (log[k] < cutoff) delete log[k];
  });
  try {
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify(log));
  } catch {
    /* localStorage unavailable/full - skip dedupe bookkeeping, not fatal */
  }
}
function alreadyNotified(key) {
  return !!getNotifiedLog()[key];
}

/**
 * Starts a periodic scan (roughly once a minute, plus immediately) that
 * emails an "Upcoming Reminder" shortly before each task starts and a
 * "Task Overdue" notice once if it's not completed by its end time.
 * `getState` is called fresh on every scan so it always sees current data.
 * Returns the interval ID (call clearInterval on it if you ever need to
 * stop the scan, e.g. on logout).
 */
export function startReminderScan(getState) {
  const scan = async () => {
    const { tasks, members, settings } = getState();
    if (!settings?.emailRemindersEnabled) return;
    const leadMinutes = Number(settings.reminderLeadMinutes) || 30;
    const now = Date.now();

    for (const task of tasks) {
      if (task.completed || task.archived || !task.date || !task.startTime || !task.endTime) continue;

      const start = new Date(`${task.date}T${task.startTime}`).getTime();
      const end = new Date(`${task.date}T${task.endTime}`).getTime();

      const reminderKey = `remind:${task.id}`;
      if (!alreadyNotified(reminderKey) && start > now && start - now <= leadMinutes * 60000) {
        const recipient = resolveRecipient(task, members, settings);
        if (recipient) {
          const sent = await sendNotification({
            eventType: "Upcoming Reminder",
            eventMessage: `"${task.title}" starts in about ${leadMinutes} minute${leadMinutes === 1 ? "" : "s"}.`,
            task,
            recipient,
          });
          if (sent) markNotified(reminderKey);
        }
      }

      const overdueKey = `overdue:${task.id}:${task.date}`;
      if (!alreadyNotified(overdueKey) && now > end) {
        const recipient = resolveRecipient(task, members, settings);
        if (recipient) {
          const sent = await sendNotification({
            eventType: "Task Overdue",
            eventMessage: `"${task.title}" was not completed by its scheduled end time.`,
            task,
            recipient,
          });
          if (sent) markNotified(overdueKey);
        }
      }
    }
  };

  scan(); // run once immediately so a freshly opened app catches up right away
  return setInterval(scan, 60000);
}
