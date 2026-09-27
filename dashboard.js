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
import {
  $,
  $$,
  el,
  showToast,
  friendlyError,
  debounce,
  todayKey,
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
  wireSearch();
  wireOfflineIndicator();
  wireSettingsForm();
  wireLogout();

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
        onToggle: (task) => toggleTaskCompletion(state.session.familyId, state.session, task).catch((e) => showToast(friendlyError(e), "error")),
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
  state.currentDay = addDays(state.currentDay, delta).toISOString().slice(0, 10);
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
          onToggle: (task) => toggleTaskCompletion(state.session.familyId, state.session, task),
          onEdit: openTaskModal,
          onDelete: (task) => deleteTask(state.session.familyId, state.session, task),
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
    const dateKey = new Date(year, month, day).toISOString().slice(0, 10);
    const dayTasks = map[dateKey] || [];
    const cell = el("div", {
      class: `monthly-cell ${dateKey === todayKey() ? "monthly-cell--today" : ""}`,
      onClick: () => { state.currentDay = dateKey; state.currentView = "daily"; $$('.nav-link').forEach(l => l.classList.toggle('nav-link--active', l.dataset.view === 'daily')); render(); },
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

  $("#export-csv-btn")?.addEventListener("click", () => exportTasksToCSV(report.tasks, state.members), { once: true });
  $("#print-report-btn")?.addEventListener("click", printReport, { once: true });
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
        await revokeAccessKey(key.id);
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
    const result = await generateAccessKey({
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
  $("#quick-add-goal-btn")?.addEventListener("click", () => openGoalModal());
  $("#quick-add-habit-btn")?.addEventListener("click", () => openHabitModal());
  $("#quick-add-member-btn")?.addEventListener("click", () => openMemberModal());
  $("#fab-add-task")?.addEventListener("click", () => openTaskModal());

  $("#task-modal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const editingId = form.dataset.editingId;
    const input = {
      assignedTo: form.assignedTo.value,
      title: form.title.value,
      description: form.description.value,
      date: form.date.value,
      startTime: form.startTime.value,
      endTime: form.endTime.value,
      category: form.category.value,
      priority: form.priority.value,
      recurring: form.recurring.value,
      notes: form.notes.value,
    };
    try {
      if (editingId) {
        await updateTask(state.session.familyId, state.session, editingId, input);
        showToast("Task updated.", "success");
      } else {
        await createTask(state.session.familyId, state.session, input);
        showToast("Task created successfully.", "success");
      }
      closeModal("#task-modal");
      form.reset();
      delete form.dataset.editingId;
    } catch (err) {
      showToast(friendlyError(err), "error");
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
    try {
      await createMember(state.session.familyId, state.session, {
        name: form.name.value,
        role: form.role.value,
        age: form.age.value,
        email: form.email.value,
      });
      showToast("Family member added.", "success");
      closeModal("#member-modal");
      form.reset();
    } catch (err) {
      showToast(friendlyError(err), "error");
    }
  });

  $$("[data-close-modal]").forEach((btn) =>
    btn.addEventListener("click", () => closeModal(`#${btn.dataset.closeModal}`))
  );
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
  } else {
    form.reset();
    delete form.dataset.editingId;
    form.date.value = state.currentDay || todayKey();
  }
  modal.classList.add("modal-overlay--visible");
}
function openGoalModal() { $("#goal-modal").classList.add("modal-overlay--visible"); }
function openHabitModal() { $("#habit-modal").classList.add("modal-overlay--visible"); }
function openMemberModal(member = null) {
  const modal = $("#member-modal");
  const form = $("#member-modal-form");
  form.reset();
  if (member) {
    form.name.value = member.name;
    form.role.value = member.role;
    form.age.value = member.age || "";
    form.email.value = member.email || "";
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
