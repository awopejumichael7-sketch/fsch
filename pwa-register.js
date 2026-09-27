/**
 * pwa-register.js
 * -----------------------------------------------------------------------
 * Adds installability on top of the existing app without touching any of
 * its existing markup, styles, or logic:
 *   1. Registers service-worker.js (app-shell caching + offline fallback).
 *   2. Captures Android/desktop Chrome & Edge's native install prompt and
 *      offers it through a small, dismissible, brand-styled button.
 *   3. Shows a one-time "Add to Home Screen" tip for iOS Safari, which has
 *      no install-prompt API and instead relies on the Share-sheet flow.
 *
 * This file injects its own scoped styles and DOM, so simply including
 *   <script defer src="pwa-register.js"></script>
 * on a page is the only integration point required.
 * -----------------------------------------------------------------------
 */
(function () {
  "use strict";

  // ---- 1. Service worker registration --------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    });
  }

  // ---- Helpers ----------------------------------------------------------------
  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      window.navigator.standalone === true // iOS Safari, already installed
    );
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  function injectStyles() {
    if (document.getElementById("fph-pwa-styles")) return;
    const style = document.createElement("style");
    style.id = "fph-pwa-styles";
    style.textContent = `
      .fph-pwa-banner {
        position: fixed;
        left: 50%;
        bottom: 1.1rem;
        transform: translate(-50%, 12px);
        z-index: 2000;
        display: flex;
        align-items: center;
        gap: 0.7rem;
        background: #101A2C;
        color: #EEF1F6;
        padding: 0.75rem 0.9rem 0.75rem 0.95rem;
        border-radius: 14px;
        box-shadow: 0 14px 34px rgba(16, 26, 44, 0.35);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
        font-size: 0.86rem;
        max-width: min(92vw, 380px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      .fph-pwa-banner--visible { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
      .fph-pwa-banner__icon {
        width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
        background: #2F6FED; display: flex; align-items: center; justify-content: center;
        font-weight: 700; color: #fff; font-size: 0.8rem;
      }
      .fph-pwa-banner__text { flex: 1; line-height: 1.35; }
      .fph-pwa-banner__actions { display: flex; align-items: center; gap: 0.4rem; }
      .fph-pwa-banner__btn {
        background: #2F6FED; color: #fff; border: none; border-radius: 8px;
        padding: 0.45rem 0.75rem; font-weight: 600; font-size: 0.8rem; cursor: pointer;
        white-space: nowrap;
      }
      .fph-pwa-banner__btn:hover { background: #2660d4; }
      .fph-pwa-banner__dismiss {
        background: transparent; border: none; color: #9AA6BC; cursor: pointer;
        font-size: 1.05rem; line-height: 1; padding: 0.2rem 0.35rem;
      }
      .fph-pwa-banner__dismiss:hover { color: #fff; }
      @media (max-width: 480px) {
        .fph-pwa-banner { bottom: 4.6rem; } /* clears the app's mobile bottom nav / FAB */
      }
    `;
    document.head.appendChild(style);
  }

  function buildBanner({ message, actionLabel, onAction }) {
    injectStyles();
    const existing = document.getElementById("fph-pwa-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "fph-pwa-banner";
    banner.className = "fph-pwa-banner";
    banner.setAttribute("role", "status");

    banner.innerHTML = `
      <div class="fph-pwa-banner__icon">FPH</div>
      <div class="fph-pwa-banner__text">${message}</div>
      <div class="fph-pwa-banner__actions">
        ${actionLabel ? `<button type="button" class="fph-pwa-banner__btn">${actionLabel}</button>` : ""}
        <button type="button" class="fph-pwa-banner__dismiss" aria-label="Dismiss">✕</button>
      </div>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("fph-pwa-banner--visible"));

    if (actionLabel) {
      banner.querySelector(".fph-pwa-banner__btn").addEventListener("click", () => {
        onAction && onAction();
        hideBanner(banner);
      });
    }
    banner.querySelector(".fph-pwa-banner__dismiss").addEventListener("click", () => hideBanner(banner));
    return banner;
  }

  function hideBanner(banner) {
    banner.classList.remove("fph-pwa-banner--visible");
    setTimeout(() => banner.remove(), 260);
  }

  if (isStandalone()) {
    // Already installed and running as an app — nothing to prompt.
    return;
  }

  // ---- 2. Android / desktop Chrome & Edge native install prompt -------------
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;

    if (localStorage.getItem("fph-install-dismissed") === "1") return;

    buildBanner({
      message: "Install Family Productivity Hub for quick, full-screen access on this device.",
      actionLabel: "Install",
      onAction: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
      },
    }).querySelector(".fph-pwa-banner__dismiss").addEventListener("click", () => {
      localStorage.setItem("fph-install-dismissed", "1");
    });
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    const banner = document.getElementById("fph-pwa-banner");
    if (banner) hideBanner(banner);
  });

  // ---- 3. iOS Safari — no install-prompt API, so show a one-time tip -------
  if (isIOS() && localStorage.getItem("fph-ios-install-tip-seen") !== "1") {
    window.addEventListener("load", () => {
      setTimeout(() => {
        const banner = buildBanner({
          message: "Install this app: tap the Share icon, then \u201cAdd to Home Screen.\u201d",
          actionLabel: "Got it",
          onAction: () => localStorage.setItem("fph-ios-install-tip-seen", "1"),
        });
        banner.querySelector(".fph-pwa-banner__dismiss").addEventListener("click", () => {
          localStorage.setItem("fph-ios-install-tip-seen", "1");
        });
      }, 1500);
    });
  }
})();
