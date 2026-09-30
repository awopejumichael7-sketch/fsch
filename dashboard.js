/**
 * dashboard.js
 * -----------------------------------------------------------------------
 * Orchestrates dashboard.html: protects the route, resolves the session,
 * wires navigation, and renders every view (dashboard, planners, goals,
 * habits, reports, family, access keys, settings).
 * -----------------------------------------------------------------------
 */
import { protectPage, logout } from "./auth.js";
import {
  watchMembers,
  createMember,
  updateMember,
  deactivateMember,
  deleteMemberPermanently,
  watchAccessKeys,
  generateAccessKey,
  revokeAccessKey,
  renderMembersList,
  renderAccessKeysTable,
} from "./family.js";
import {
  watchTasks,
  createTask,
  updateTask,
  toggleTaskCompletion,
  deleteTask,
  filterTasks,
  tasksForDay,
  tasksForWeek,
  tasksForMonth,
  renderTaskCard,
} from "./tasks.js";
import { watchGoals, createGoal, updateGoalProgress, deleteGoal, renderGoalCard } from "./goals.js";
import { watchHabits, createHabit, toggleHabitToday, deleteHabit, renderHabitCard } from "./habits.js";
import {
  watchActivityLog,
  dailyReport,
  weeklyReport,
  monthlyReport,
  calculatePoints,
  exportTasksToCSV,
  printReport,
} from "./reports.js";
import { watchFamilySettings, updateFamilySettings, initTheme, setStoredTheme, getStoredTheme, applyPalette } from "./settings.js";
import { notifyTaskAdded, notifyTaskCompleted, startReminderScan } from "./email-reminders.js";
import {
  $,
  $$,
  el,
  showToast,
  friendlyError,
  debounce,
  todayKey,
  dateKey,
  formatFriendlyDate,
  startOfWeek,
  addDays,
  DEFAULT_CATEGORIES,
  computeStatus,
} from "./utilities.js";

initTheme();

let state = {
  session: null,
  members: [],
  tasks: [],
  goals: [],
  habits: [],
  settings: { categories: DEFAULT_CATEGORIES, pointsEnabled: true },
  currentView: "dashboard",
  currentDay: todayKey(),
  currentWeekStart: startOfWeek(),
  currentMonth: new Date(),
  filters: { memberId: "all", category: "all", priority: "all", status: "all", searchTerm: "" },
};

protectPage({
  onReady: (session) => {
    if (session.pending) {
      showToast("Finishing account setup…", "info");
      return;
    }
    state.session = session;
    bootstrap(session);
  },
});

function bootstrap(session) {
  $("#user-name").textContent = session.name || session.email;
  $("#user-role-badge").textContent = session.role === "admin" || session.role === "parent" ? "Parent" : "Child";
  document.body.classList.toggle("role-child", session.role === "child");

  watchMembers(session.familyId, (members) => {
    state.members = members;
    populateMemberSelectors(members);
    render();
  });

  watchTasks(session.familyId, session, (tasks) => {
    state.tasks = tasks;
    render();
  });

  watchGoals(session.familyId, session, (goals) => {
    state.goals = goals;
    render();
  });

  watchHabits(session.familyId, session, (habits) => {
    state.habits = habits;
    render();
  });

  watchFamilySettings(session.familyId, (settings) => {
    state.settings = settings;
    if (settings.palette) applyPalette(settings.palette);
    render();
  });

  if (session.role === "admin" || session.role === "parent") {
    watchAccessKeys(session.familyId, (keys) => {
      state.accessKeys = keys;
      if (state.currentView === "access-keys") renderAccessKeysView();
    });
    watchActivityLog(session.familyId, (logs) => {
      state.activityLog = logs;
      if (state.currentView === "reports") renderReportsView();
    });
  }

  wireNavigation();
  wireQuickAdd();
  wireBulkAddTasks();
  wireSearch();
  wireOfflineIndicator();
  wireSettingsForm();
  wireReportsActions();
  wireLogout();

  // Email reminders (Sections 31/32 extension): checks upcoming/overdue
  // tasks roughly once a minute while this dashboard is open. See
  // email-reminders.js and README for what this can and can't guarantee.
  startReminderScan(() => ({
    tasks: state.tasks,
    members: state.members,
    settings: state.settings,
  }));

  render();
}

// ---- Navigation -------------------------------------------------------------
function wireNavigation() {
  $$(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      state.currentView = link.dataset.view;
      $$(".nav-link").forEach((l) => l.classList.toggle("nav-link--active", l === link));
      render();
      $("#sidebar")?.classList.remove("sidebar--open");
    });
  });
  $("#mobile-menu-btn")?.addEventListener("click", () => $("#sidebar").classList.toggle("sidebar--open"));
}

function wireLogout() {
  $("#logout-btn")?.addEventListener("click", logout);
}

// ---- Master render dispatcher ------------------------------------------------
function render() {
  $$(".view").forEach((v) => v.classList.add("view--hidden"));
  const activeView = $(`#view-${state.currentView}`);
  if (activeView) activeView.classList.remove("view--hidden");

  switch (state.currentView) {
    case "dashboard": return renderDashboardView();
    case "daily": return renderDailyView();
    case "weekly": return renderWeeklyView();
    case "monthly": return renderMonthlyView();
    case "goals": return renderGoalsView();
    case "habits": return renderHabitsView();
    case "reports": return renderReportsView();
    case "family": return renderFamilyView();
    case "access-keys": return renderAccessKeysView();
    case "settings": return renderSettingsView();
    default: return;
  }
}

// ---- Dashboard view (Section 21) --------------------------------------------
function renderDashboardView() {
  const filtered = getVisibleTasks();
  const today = todayKey();
  const todays = filtered.filter((t) => t.date === today);
  const upcoming = filtered.filter((t) => t.date > today && !t.completed).slice(0, 6);
  const overdue = filtered.filter((t) => computeStatus(t) === "overdue");
  const completed = filtered.filter((t) => t.completed);
  const rate = filtered.length ? Math.round((completed.length / filtered.length) * 100) : 0;

  $("#greeting-name").textContent = state.session.name || "there";
  $("#kpi-total").textContent = filtered.length;
  $("#kpi-completed").textContent = completed.length;
  $("#kpi-pending").textContent = filtered.length - completed.length - overdue.length;
  $("#kpi-overdue").textContent = overdue.length;
  $("#kpi-rate").textContent = `${rate}%`;

  renderTaskList($("#dashboard-today-list"), todays);
  renderTaskList($("#dashboard-upcoming-list"), upcoming);
  renderTaskList($("#dashboard-overdue-list"), overdue);

  if (state.session.role !== "child") {
    renderMembersList($("#family-progress-grid"), state.members, { session: state.session, onEdit: openMemberModal });
  }
}

// Shared by every task-list rendering site so the "task completed" email
// hook (and error handling) only has to be written once.
async function handleToggleTask(task) {
  try {
    const wasIncomplete = !task.completed;
    await toggleTaskCompletion(state.session.familyId, state.session, task);
    if (wasIncomplete) {
      notifyTaskCompleted(task, state.members, state.settings).catch(() => {});
    }
  } catch (e) {
    showToast(friendlyError(e), "error");
  }
}

function renderTaskList(container, tasks) {
  if (!container) return;
  container.innerHTML = "";
  if (!tasks.length) {
    container.appendChild(el("p", { class: "empty-state" }, "Nothing here right now."));
    return;
  }
  tasks.forEach((t) =>
    container.appendChild(
      renderTaskCard(t, state.members, {
        session: state.session,
        onToggle: handleToggleTask,
        onEdit: openTaskModal,
        onDelete: (task) => deleteTask(state.session.familyId, state.session, task).catch((e) => showToast(friendlyError(e), "error")),
      })
    )
  );
}

function getVisibleTasks() {
  return filterTasks(state.tasks, state.filters);
}

// ---- Daily planner (Section 12) ---------------------------------------------
function renderDailyView() {
  $("#daily-date-label").textContent = formatFriendlyDate(state.currentDay);
  const dayTasks = tasksForDay(getVisibleTasks(), state.currentDay);
  renderTaskList($("#daily-task-list"), dayTasks);
}
$("#daily-prev")?.addEventListener("click", () => shiftDay(-1));
$("#daily-next")?.addEventListener("click", () => shiftDay(1));
$("#daily-today")?.addEventListener("click", () => { state.currentDay = todayKey(); renderDailyView(); });
function shiftDay(delta) {
  state.currentDay = dateKey(addDays(state.currentDay, delta));
  renderDailyView();
}

// ---- Weekly planner (Section 13) --------------------------------------------
function renderWeeklyView() {
  const days = tasksForWeek(getVisibleTasks(), state.currentWeekStart);
  const container = $("#weekly-grid");
  if (!container) return;
  container.innerHTML = "";
  $("#weekly-range-label").textContent = `${formatFriendlyDate(days[0].dateKey)} – ${formatFriendlyDate(days[6].dateKey)}`;
  days.forEach(({ dateKey, tasks }) => {
    const col = el("div", { class: "weekly-day-col" }, [
      el("h4", {}, new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })),
    ]);
    tasks.forEach((t) =>
      col.appendChild(
        renderTaskCard(t, state.members, {
          session: state.session,
          onToggle: handleToggleTask,
          onEdit: openTaskModal,
          onDelete: (task) => deleteTask(state.session.familyId, state.session, task).catch((e) => showToast(friendlyError(e), "error")),
        })
      )
    );
    if (!tasks.length) col.appendChild(el("p", { class: "empty-state empty-state--sm" }, "No tasks"));
    container.appendChild(col);
  });
}
$("#weekly-prev")?.addEventListener("click", () => { state.currentWeekStart = addDays(state.currentWeekStart, -7); renderWeeklyView(); });
$("#weekly-next")?.addEventListener("click", () => { state.currentWeekStart = addDays(state.currentWeekStart, 7); renderWeeklyView(); });
$("#weekly-current")?.addEventListener("click", () => { state.currentWeekStart = startOfWeek(); renderWeeklyView(); });

// ---- Monthly planner (Section 14) -------------------------------------------
function renderMonthlyView() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const map = tasksForMonth(getVisibleTasks(), year, month);
  $("#monthly-label").textContent = state.currentMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const grid = $("#monthly-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startOffset; i += 1) grid.appendChild(el("div", { class: "monthly-cell monthly-cell--empty" }));

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellKey = dateKey(new Date(year, month, day));
    const dayTasks = map[cellKey] || [];
    const cell = el("div", {
      class: `monthly-cell ${cellKey === todayKey() ? "monthly-cell--today" : ""}`,
      onClick: () => { state.currentDay = cellKey; state.currentView = "daily"; $$('.nav-link').forEach(l => l.classList.toggle('nav-link--active', l.dataset.view === 'daily')); render(); },
    }, [
      el("span", { class: "monthly-cell__num" }, String(day)),
      dayTasks.length ? el("span", { class: "monthly-cell__count" }, String(dayTasks.length)) : null,
    ]);
    grid.appendChild(cell);
  }
}
$("#monthly-prev")?.addEventListener("click", () => { state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1); renderMonthlyView(); });
$("#monthly-next")?.addEventListener("click", () => { state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1); renderMonthlyView(); });

// ---- Goals view (Section 24) -------------------------------------------------
function renderGoalsView() {
  const container = $("#goals-list");
  if (!container) return;
  container.innerHTML = "";
  if (!state.goals.length) {
    container.appendChild(el("p", { class: "empty-state" }, "No goals yet. Add one to start tracking progress."));
    return;
  }
  state.goals.forEach((g) =>
    container.appendChild(
      renderGoalCard(g, state.members, {
        onUpdateProgress: (goal, val) => updateGoalProgress(state.session.familyId, state.session, goal, val),
        onDelete: (goal) => deleteGoal(state.session.familyId, state.session, goal).then((ok) => ok && renderGoalsView()),
      })
    )
  );
}

// ---- Habits view (Section 25) ------------------------------------------------
function renderHabitsView() {
  const container = $("#habits-list");
  if (!container) return;
  container.innerHTML = "";
  if (!state.habits.length) {
    container.appendChild(el("p", { class: "empty-state" }, "No habits yet. Add one to start building streaks."));
    return;
  }
  state.habits.forEach((h) =>
    container.appendChild(
      renderHabitCard(h, state.members, {
        onToggleToday: (habit) => toggleHabitToday(state.session.familyId, state.session, habit),
        onDelete: (habit) => deleteHabit(state.session.familyId, state.session, habit).then((ok) => ok && renderHabitsView()),
      })
    )
  );

  if (state.settings.pointsEnabled) {
    const points = calculatePoints(state.tasks);
    $("#points-total") && ($("#points-total").textContent = points.total);
  }
}

// ---- Reports view (Sections 27-28, 32, 59) -----------------------------------
function renderReportsView() {
  const report = weeklyReport(getVisibleTasks());
  $("#report-total") && ($("#report-total").textContent = report.total);
  $("#report-completed") && ($("#report-completed").textContent = report.completed);
  $("#report-pending") && ($("#report-pending").textContent = report.pending);
  $("#report-rate") && ($("#report-rate").textContent = `${report.completionRate}%`);

  const catList = $("#report-category-breakdown");
  if (catList) {
    catList.innerHTML = "";
    Object.entries(report.byCategory).forEach(([cat, count]) => {
      catList.appendChild(el("li", {}, `${cat}: ${count}`));
    });
  }

  const logList = $("#activity-log-list");
  if (logList && state.activityLog) {
    logList.innerHTML = "";
    state.activityLog.forEach((log) => {
      const time = log.timestamp?.toDate ? log.timestamp.toDate().toLocaleString() : "";
      logList.appendChild(el("li", {}, `${log.userName}: ${log.action} — ${time}`));
    });
  }
}

// Wired ONCE (see bootstrap()) rather than inside renderReportsView(), which
// runs on almost every state change — attaching a fresh listener on every
// render used to stack duplicate handlers on the same button.
function wireReportsActions() {
  $("#export-csv-btn")?.addEventListener("click", () => {
    const report = weeklyReport(getVisibleTasks());
    exportTasksToCSV(report.tasks, state.members);
  });
  $("#print-report-btn")?.addEventListener("click", printReport);
}

// ---- Family / members view (Section 9) ---------------------------------------
function renderFamilyView() {
  renderMembersList($("#members-full-list"), state.members, { session: state.session, onEdit: openMemberModal });
}

// ---- Access Keys view (Section 53) --------------------------------------------
function renderAccessKeysView() {
  if (!state.accessKeys) return;
  renderAccessKeysTable($("#access-keys-table"), state.accessKeys, {
    onCopy: (key) => { navigator.clipboard.writeText(key); showToast("Access key copied to clipboard.", "success"); },
    onRevoke: async (key) => {
      try {
        await revokeAccessKey(state.session, key.id);
        showToast("Access key revoked.", "success");
      } catch (err) {
        showToast(friendlyError(err), "error");
      }
    },
  });
}

$("#generate-key-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const result = await generateAccessKey(state.session, {
      role: form.role.value,
      expiresInDays: Number(form.expiresInDays.value) || 7,
      maxUses: Number(form.maxUses.value) || 1,
    });
    showToast(`Access key generated: ${result.key}`, "success", 8000);
    navigator.clipboard?.writeText(result.key);
  } catch (err) {
    showToast(friendlyError(err), "error");
  }
});

// ---- Settings view (Sections 18, 26, 40-41) -----------------------------------
function renderSettingsView() {
  const themeSelect = $("#theme-select");
  if (themeSelect) themeSelect.value = getStoredTheme();

  const pointsToggle = $("#points-toggle");
  if (pointsToggle) pointsToggle.checked = !!state.settings.pointsEnabled;

  const catList = $("#categories-list");
  if (catList) {
    catList.innerHTML = "";
    (state.settings.categories || DEFAULT_CATEGORIES).forEach((c) => catList.appendChild(el("span", { class: "chip" }, c)));
  }

  const emailToggle = $("#email-reminders-toggle");
  if (emailToggle) emailToggle.checked = !!state.settings.emailRemindersEnabled;
  const emailAddress = $("#notification-email-input");
  if (emailAddress && document.activeElement !== emailAddress) emailAddress.value = state.settings.notificationEmail || "";
  const leadMinutes = $("#reminder-lead-minutes-input");
  if (leadMinutes && document.activeElement !== leadMinutes) leadMinutes.value = state.settings.reminderLeadMinutes || 30;
}

function wireSettingsForm() {
  $("#theme-select")?.addEventListener("change", (e) => setStoredTheme(e.target.value));

  $("#points-toggle")?.addEventListener("change", (e) =>
    updateFamilySettings(state.session.familyId, state.session, { pointsEnabled: e.target.checked })
  );

  $("#add-category-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = e.target.newCategory;
    const value = input.value.trim();
    if (!value) return;
    const categories = Array.from(new Set([...(state.settings.categories || DEFAULT_CATEGORIES), value]));
    updateFamilySettings(state.session.familyId, state.session, { categories });
    input.value = "";
  });

  $("#palette-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const palette = {
      navy: form.navy.value,
      blue: form.blue.value,
      green: form.green.value,
      red: form.red.value,
      amber: form.amber.value,
    };
    updateFamilySettings(state.session.familyId, state.session, { palette });
  });

  $("#email-reminders-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const leadMinutes = Math.min(Math.max(Number(form.reminderLeadMinutes.value) || 30, 5), 1440);
    updateFamilySettings(state.session.familyId, state.session, {
      emailRemindersEnabled: form.emailRemindersEnabled.checked,
      notificationEmail: form.notificationEmail.value.trim(),
      reminderLeadMinutes: leadMinutes,
    });
    showToast("Email reminder settings saved.", "success");
  });
}

// ---- Member selectors (used by Quick Add + filters) --------------------------
function populateMemberSelectors(members) {
  $$(".member-select").forEach((select) => {
    const current = select.value;
    select.innerHTML = "";
    if (select.classList.contains("member-select--with-all")) {
      select.appendChild(el("option", { value: "all" }, "All Family"));
    }
    members
      .filter((m) => m.active !== false)
      .forEach((m) => select.appendChild(el("option", { value: m.id }, m.name)));
    if (current) select.value = current;
  });
}

// ---- Family filter (Section 22) -----------------------------------------------
$("#family-filter-select")?.addEventListener("change", (e) => {
  state.filters.memberId = e.target.value;
  render();
});
$("#category-filter-select")?.addEventListener("change", (e) => { state.filters.category = e.target.value; render(); });
$("#priority-filter-select")?.addEventListener("change", (e) => { state.filters.priority = e.target.value; render(); });
$("#status-filter-select")?.addEventListener("change", (e) => { state.filters.status = e.target.value; render(); });

// ---- Search (Section 29) -------------------------------------------------------
function wireSearch() {
  const input = $("#global-search-input");
  if (!input) return;
  input.addEventListener(
    "input",
    debounce((e) => {
      state.filters.searchTerm = e.target.value;
      render();
    }, 300)
  );
}

// ---- Quick Add modal (Sections 55-56) ------------------------------------------
function wireQuickAdd() {
  $("#quick-add-task-btn")?.addEventListener("click", () => openTaskModal());
  $("#quick-add-bulk-tasks-btn")?.addEventListener("click", () => openBulkTaskModal());
  $("#quick-add-goal-btn")?.addEventListener("click", () => openGoalModal());
  $("#quick-add-habit-btn")?.addEventListener("click", () => openHabitModal());
  $("#quick-add-member-btn")?.addEventListener("click", () => openMemberModal());
  $("#fab-add-task")?.addEventListener("click", () => openTaskModal());

  $("#task-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const editingId = form.dataset.editingId;
    const baseInput = {
      assignedTo: form.assignedTo.value,
      title: form.title.value,
      description: form.description.value,
      date: form.date.value,
      startTime: form.startTime.value,
      endTime: form.endTime.value,
      category: form.category.value,
      priority: form.priority.value,
      notes: form.notes.value,
    };
    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      if (editingId) {
        // Recurrence is a create-time-only concept here (a whole series is
        // generated at once) — editing a single instance never sends
        // `recurring`, so it can no longer be silently reset to "none".
        await updateTask(state.session.familyId, state.session, editingId, baseInput);
        showToast("Task updated.", "success");
        closeModal("#task-modal");
        form.reset();
        delete form.dataset.editingId;
      } else {
        const createdId = await createTask(state.session.familyId, state.session, {
          ...baseInput,
          recurring: form.recurring.value,
        });
        if (createdId) {
          showToast("Task created successfully.", "success");
          closeModal("#task-modal");
          form.reset();
          notifyTaskAdded(baseInput, state.members, state.settings).catch(() => {});
        } else {
          // createTask returns null when the parent declined to proceed
          // past a schedule-conflict warning — nothing was saved, so say so
          // instead of falsely reporting success.
          showToast("Task not saved.", "info");
        }
      }
    } catch (err) {
      showToast(friendlyError(err), "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  $("#goal-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await createGoal(state.session.familyId, state.session, {
        assignedTo: form.assignedTo.value,
        title: form.title.value,
        description: form.description.value,
        category: form.category.value,
        targetDate: form.targetDate.value,
      });
      showToast("Goal created.", "success");
      closeModal("#goal-modal");
      form.reset();
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });

  $("#habit-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await createHabit(state.session.familyId, state.session, {
        assignedTo: form.assignedTo.value,
        name: form.name.value,
        frequency: form.frequency.value,
      });
      showToast("Habit created.", "success");
      closeModal("#habit-modal");
      form.reset();
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });

  $("#member-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const editingId = form.dataset.editingId;
    const fields = {
      name: form.name.value,
      role: form.role.value,
      age: form.age.value,
      email: form.email.value,
    };
    try {
      if (editingId) {
        await updateMember(state.session.familyId, state.session, editingId, fields);
        showToast("Family member updated.", "success");
      } else {
        await createMember(state.session.familyId, state.session, fields);
        showToast("Family member added.", "success");
      }
      closeModal("#member-modal");
      form.reset();
      delete form.dataset.editingId;
      editingMember = null;
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });

  $("#member-deactivate-btn")?.addEventListener("click", async () => {
    if (!editingMember) return;
    try {
      const ok = await deactivateMember(state.session.familyId, state.session, editingMember.id, editingMember.name);
      if (ok) {
        showToast("Family member deactivated.", "success");
        closeModal("#member-modal");
        editingMember = null;
      }
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });

  $("#member-delete-btn")?.addEventListener("click", async () => {
    if (!editingMember) return;
    try {
      const ok = await deleteMemberPermanently(state.session.familyId, state.session, editingMember);
      if (ok) {
        showToast("Family member permanently deleted.", "success");
        closeModal("#member-modal");
        editingMember = null;
      }
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });

  $$("[data-close-modal]").forEach((btn) =>
    btn.addEventListener("click", () => closeModal(`#${btn.dataset.closeModal}`))
  );
}

// ---- Add Multiple Tasks (bulk add) -----------------------------------------
// Each row is created through the same createTask() used everywhere else in
// the app, one at a time in sequence, so per-task validation, schedule
// conflict warnings, and activity logging all behave identically to adding
// a single task — this feature adds a way to fill in several at once, it
// does not introduce a second, different way of creating a task.
function buildBulkMemberSelect() {
  const select = el("select", { class: "member-select", "data-field": "assignedTo", required: "required" });
  state.members
    .filter((m) => m.active !== false)
    .forEach((m) => select.appendChild(el("option", { value: m.id }, m.name)));
  return select;
}

function buildBulkCategorySelect() {
  const select = el("select", { "data-field": "category" });
  (state.settings.categories || DEFAULT_CATEGORIES).forEach((c) => select.appendChild(el("option", { value: c }, c)));
  return select;
}

function buildBulkPrioritySelect() {
  const select = el("select", { "data-field": "priority" });
  ["High", "Medium", "Low"].forEach((p) =>
    select.appendChild(el("option", { value: p, selected: p === "Medium" ? "selected" : undefined }, p))
  );
  return select;
}

function buildBulkTaskRow(index) {
  const row = el("div", { class: "bulk-task-row" }, [
    el("div", { class: "bulk-task-row__header" }, [
      el("span", { class: "bulk-task-row__label" }, `Task ${index}`),
      el("button", {
        type: "button",
        class: "icon-btn",
        title: "Remove this task",
        onClick: () => removeBulkTaskRow(row),
      }, "✕"),
    ]),
    el("div", { class: "form-row" }, [
      el("label", {}, ["Assign To", buildBulkMemberSelect()]),
      el("label", {}, ["Task", el("input", { type: "text", "data-field": "title", required: "required", placeholder: "e.g. Mathematics Revision" })]),
    ]),
    el("div", { class: "form-row" }, [
      el("label", {}, ["Date", el("input", { type: "date", "data-field": "date", required: "required", value: state.currentDay || todayKey() })]),
      el("label", {}, ["Start Time", el("input", { type: "time", "data-field": "startTime", required: "required" })]),
      el("label", {}, ["End Time", el("input", { type: "time", "data-field": "endTime", required: "required" })]),
    ]),
    el("div", { class: "form-row" }, [
      el("label", {}, ["Category", buildBulkCategorySelect()]),
      el("label", {}, ["Priority", buildBulkPrioritySelect()]),
    ]),
  ]);
  return row;
}

function renumberBulkRows() {
  const container = $("#bulk-task-rows");
  if (!container) return;
  $$(".bulk-task-row", container).forEach((row, idx) => {
    const label = row.querySelector(".bulk-task-row__label");
    if (label) label.textContent = `Task ${idx + 1}`;
  });
}

function removeBulkTaskRow(row) {
  const container = $("#bulk-task-rows");
  if (!container) return;
  if (container.children.length <= 1) {
    showToast("At least one task is required.", "info");
    return;
  }
  row.remove();
  renumberBulkRows();
}

function resetBulkTaskModal() {
  const container = $("#bulk-task-rows");
  if (!container) return;
  container.innerHTML = "";
  container.appendChild(buildBulkTaskRow(1));
  container.appendChild(buildBulkTaskRow(2));
}

function openBulkTaskModal() {
  resetBulkTaskModal();
  $("#bulk-task-modal")?.classList.add("modal-overlay--visible");
}

function wireBulkAddTasks() {
  $("#bulk-add-row-btn")?.addEventListener("click", () => {
    const container = $("#bulk-task-rows");
    if (!container) return;
    container.appendChild(buildBulkTaskRow(container.children.length + 1));
  });

  $("#bulk-task-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const container = $("#bulk-task-rows");
    const rows = $$(".bulk-task-row", container);
    if (!rows.length) return;

    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;

    let successCount = 0;
    const errors = [];
    const rowsToRemove = [];

    // Sequential on purpose: a schedule conflict opens its own confirm
    // dialog (see tasks.js/createTask + utilities.js/confirmAction), and
    // those need to be resolved one at a time, not stacked simultaneously.
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const getField = (name) => row.querySelector(`[data-field="${name}"]`)?.value || "";
      const input = {
        assignedTo: getField("assignedTo"),
        title: getField("title"),
        date: getField("date"),
        startTime: getField("startTime"),
        endTime: getField("endTime"),
        category: getField("category") || "Other",
        priority: getField("priority") || "Medium",
        description: "",
        notes: "",
      };
      const rowLabel = `Task ${i + 1}${input.title ? ` ("${input.title}")` : ""}`;
      try {
        const createdId = await createTask(state.session.familyId, state.session, input);
        if (createdId) {
          successCount += 1;
          rowsToRemove.push(row);
          notifyTaskAdded(input, state.members, state.settings).catch(() => {});
        } else {
          errors.push(`${rowLabel}: not saved.`);
        }
      } catch (err) {
        errors.push(`${rowLabel}: ${friendlyError(err)}`);
      }
    }

    // Only remove rows that actually saved, so a partial failure never
    // risks re-submitting (and duplicating) tasks that already succeeded.
    rowsToRemove.forEach((row) => row.remove());
    renumberBulkRows();
    submitBtn.disabled = false;

    if (successCount) {
      showToast(`${successCount} task${successCount === 1 ? "" : "s"} created successfully.`, "success");
    }
    if (errors.length) {
      showToast(errors.join(" "), "error", 9000);
    } else {
      closeModal("#bulk-task-modal");
      resetBulkTaskModal();
    }
  });
}

function openTaskModal(task = null) {
  const modal = $("#task-modal");
  const form = $("#task-modal-form");
  if (task) {
    form.dataset.editingId = task.id;
    form.assignedTo.value = task.assignedTo;
    form.title.value = task.title;
    form.description.value = task.description;
    form.date.value = task.date;
    form.startTime.value = task.startTime;
    form.endTime.value = task.endTime;
    form.category.value = task.category;
    form.priority.value = task.priority;
    form.notes.value = task.notes;
    form.recurring.value = task.recurring || "none";
    form.recurring.disabled = true;
  } else {
    form.reset();
    delete form.dataset.editingId;
    form.date.value = state.currentDay || todayKey();
    form.recurring.disabled = false;
  }
  modal.classList.add("modal-overlay--visible");
}
function openGoalModal() { $("#goal-modal").classList.add("modal-overlay--visible"); }
function openHabitModal() { $("#habit-modal").classList.add("modal-overlay--visible"); }
let editingMember = null;

function openMemberModal(member = null) {
  const modal = $("#member-modal");
  const form = $("#member-modal-form");
  form.reset();
  editingMember = member;
  const deactivateBtn = $("#member-deactivate-btn");
  const deleteBtn = $("#member-delete-btn");
  if (member) {
    form.dataset.editingId = member.id;
    form.name.value = member.name;
    form.role.value = member.role;
    form.age.value = member.age || "";
    form.email.value = member.email || "";
    // A parent editing their OWN record can't deactivate/delete themselves
    // here — that would risk leaving the family with no admin.
    const isSelf = member.uid === state.session.uid;
    if (deactivateBtn) deactivateBtn.style.display = isSelf ? "none" : "";
    if (deleteBtn) deleteBtn.style.display = isSelf ? "none" : "";
  } else {
    delete form.dataset.editingId;
    if (deactivateBtn) deactivateBtn.style.display = "none";
    if (deleteBtn) deleteBtn.style.display = "none";
  }
  modal.classList.add("modal-overlay--visible");
}
function closeModal(selector) {
  $(selector)?.classList.remove("modal-overlay--visible");
}

// ---- Offline indicator (Section 38) --------------------------------------------
function wireOfflineIndicator() {
  const indicator = $("#connection-indicator");
  if (!indicator) return;
  const update = () => {
    indicator.textContent = navigator.onLine ? "" : "Offline — changes will sync when you're back online";
    indicator.classList.toggle("connection-indicator--visible", !navigator.onLine);
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

// ---- Notifications (Section 31: ask only after opt-in) --------------------------
$("#enable-reminders-btn")?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("This browser does not support notifications.", "info");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    showToast("Reminders enabled.", "success");
    scheduleUpcomingReminders();
  } else {
    showToast("Notifications were not enabled.", "info");
  }
});

function scheduleUpcomingReminders() {
  const upcoming = state.tasks.filter((t) => !t.completed && t.date === todayKey());
  upcoming.forEach((t) => {
    const [h, m] = t.startTime.split(":").map(Number);
    const fireAt = new Date();
    fireAt.setHours(h, m, 0, 0);
    const msUntil = fireAt.getTime() - Date.now();
    if (msUntil > 0 && msUntil < 12 * 60 * 60 * 1000) {
      setTimeout(() => new Notification("Family Productivity Hub", { body: `${t.title} starts now.` }), msUntil);
    }
  });
}
