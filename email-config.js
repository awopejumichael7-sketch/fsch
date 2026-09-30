/**
 * email-config.js
 * -----------------------------------------------------------------------
 * Configuration for automatic email reminders (task added / upcoming /
 * completed / overdue), sent via EmailJS — a free, client-side-only email
 * service with a generous free tier (200 emails/month, no credit card,
 * no backend). It can send through a personal Gmail account you connect
 * once in the EmailJS dashboard.
 *
 * These three values are NOT secret in the way a password is — EmailJS's
 * own docs note the public key is safe to ship in browser code, the same
 * way firebase-config.js's values are safe to ship. The actual sending
 * permission lives in your EmailJS account, tied to the Gmail you connect
 * there.
 *
 * One-time setup (free, ~10 minutes): see README §15 for the full
 * step-by-step, including the exact email template to paste in.
 * -----------------------------------------------------------------------
 */
export const EMAILJS_PUBLIC_KEY = "YOUR_EMAILJS_PUBLIC_KEY";
export const EMAILJS_SERVICE_ID = "YOUR_EMAILJS_SERVICE_ID";
export const EMAILJS_TEMPLATE_ID = "YOUR_EMAILJS_TEMPLATE_ID";
