/**
 * settings.js — Section 40 (customizable palette), 41 (theme), 26 (points toggle),
 * 18 (custom categories). Settings live at families/{familyId}/settings/app
 * so the whole family shares one configuration; theme preference itself is
 * personal and stored in localStorage per device.
 */
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { DEFAULT_CATEGORIES } from "./utilities.js";

const settingsDoc = (familyId) => doc(db, "families", familyId, "settings", "app");
const THEME_KEY = "fph-theme-preference";

// ---- Theme (light / dark / system) -----------------------------------------
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || "system";
}

export function setStoredTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}

export function initTheme() {
  applyTheme(getStoredTheme());
}

// ---- Family-wide settings ---------------------------------------------------
export function watchFamilySettings(familyId, callback) {
  return onSnapshot(settingsDoc(familyId), (snap) => {
    callback(
      snap.exists()
        ? snap.data()
        : { categories: DEFAULT_CATEGORIES, pointsEnabled: true, showLeaderboard: false, palette: defaultPalette() }
    );
  });
}

export async function updateFamilySettings(familyId, session, updates) {
  await setDoc(
    settingsDoc(familyId),
    { ...updates, updatedAt: serverTimestamp(), updatedBy: session.uid },
    { merge: true }
  );
}

export function defaultPalette() {
  return {
    navy: "#101A2C",
    blue: "#2F6FED",
    green: "#1FA97C",
    red: "#E4574C",
    amber: "#E8A33D",
  };
}

export function applyPalette(palette) {
  const root = document.documentElement;
  Object.entries(palette || defaultPalette()).forEach(([key, value]) => {
    root.style.setProperty(`--color-${key}`, value);
  });
}
