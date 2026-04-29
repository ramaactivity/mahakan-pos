import "server-only";

import { Resend } from "resend";

/**
 * Email sender wrapper. Uses Resend in production; falls back to console
 * logging in dev when RESEND_API_KEY is unset so feature work doesn't
 * require an API key locally.
 *
 * Env required for prod:
 *   RESEND_API_KEY — from resend.com dashboard, starts "re_..."
 *   EMAIL_FROM     — verified sender, e.g. "Mahakan POS <noreply@yourdomain>"
 *                    For early dev with no custom domain: use Resend's
 *                    "onboarding@resend.dev" sandbox sender.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Mahakan POS <onboarding@resend.dev>";

let cachedClient: Resend | null = null;

function client(): Resend | null {
  if (!RESEND_API_KEY) return null;
  if (!cachedClient) {
    cachedClient = new Resend(RESEND_API_KEY);
  }
  return cachedClient;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body — same content with formatting, both sent so
   * clients without HTML still see plain. */
  html?: string;
}

export interface SendResult {
  ok: boolean;
  /** Resend message id if delivered; null if dev-mode logged or failed. */
  messageId: string | null;
  /** "sent" | "logged" | "failed" — caller decides whether to surface. */
  mode: "sent" | "logged" | "failed";
  error?: string;
}

/**
 * Best-effort send. Never throws — returns a result envelope so callers
 * (typically server actions) can decide whether the failure should
 * block the user flow or just log + warn.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const c = client();
  if (!c) {
    // Dev mode: log so devs can copy the code from console without setting up Resend.
    console.log(
      `[email/send] DEV MODE — RESEND_API_KEY unset. Would send:\n  To:      ${msg.to}\n  Subject: ${msg.subject}\n  Body:\n${msg.text}\n`,
    );
    return { ok: true, messageId: null, mode: "logged" };
  }
  try {
    const { data, error } = await c.emails.send({
      from: EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    if (error) {
      return {
        ok: false,
        messageId: null,
        mode: "failed",
        error: error.message ?? String(error),
      };
    }
    return { ok: true, messageId: data?.id ?? null, mode: "sent" };
  } catch (e) {
    return {
      ok: false,
      messageId: null,
      mode: "failed",
      error: e instanceof Error ? e.message : "Unknown send error",
    };
  }
}
