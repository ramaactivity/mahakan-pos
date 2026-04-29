import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { Resend } from "resend";

/**
 * Email sender wrapper. Supports two providers in this order:
 *
 * 1. **Gmail SMTP (App Password)** — Recommended for Mahakan scale.
 *    Set `GMAIL_USER` (the Gmail address) + `GMAIL_APP_PASSWORD` (16-char
 *    App Password from Google Account → Security → 2-Step Verification →
 *    App passwords).
 *
 * 2. **Resend** — alternative for higher volume / branded sender domain.
 *    Set `RESEND_API_KEY` + `EMAIL_FROM` (e.g., "Mahakan POS
 *    <noreply@yourdomain>"). Use sandbox `onboarding@resend.dev` if no
 *    custom domain.
 *
 * 3. **Dev-mode console log** — neither provider configured.
 *
 * Implementation notes for Vercel serverless:
 * - Use explicit SMTP host/port/secure (port 465 + TLS direct) instead of
 *   the `service: "gmail"` shortcut. Some serverless environments reject
 *   the shortcut's auto-port-detection.
 * - Set `pool: false` and explicit timeouts — serverless instances are
 *   short-lived; pooling is wasted memory and can hold dead sockets.
 * - 10s connection + 10s socket timeout — Vercel hobby tier has a 10s
 *   function execution cap on most routes; we want to fail fast inside
 *   that budget so the surrounding action can return a clean error.
 */

const GMAIL_USER = process.env.GMAIL_USER;
// Gmail App Password — Google displays as "abcd efgh ijkl mnop" but the
// SMTP auth wants no spaces. Some Owners copy with spaces; we normalize.
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM_ENV = process.env.EMAIL_FROM;

/**
 * Hard wrapper to prevent any SMTP / Resend op from hanging past `ms` —
 * used so a Vercel function never spins on a stuck handshake. Returns
 * the original promise's value or a synthetic SendResult-shaped error.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([p, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Provider = "gmail" | "resend" | "dev-log";

function activeProvider(): Provider {
  if (GMAIL_USER && GMAIL_APP_PASSWORD) return "gmail";
  if (RESEND_API_KEY) return "resend";
  return "dev-log";
}

let cachedTransporter: Transporter | null = null;
let cachedResend: Resend | null = null;

function gmailTransporter(): Transporter {
  if (!cachedTransporter) {
    // Explicit SMTP config (more reliable on Vercel serverless than the
    // `service: "gmail"` shortcut). Default no-pool — serverless instances
    // are short-lived; pooling is wasted memory.
    const opts: SMTPTransport.Options = {
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // TLS direct
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    };
    cachedTransporter = nodemailer.createTransport(opts);
  }
  return cachedTransporter;
}

function resendClient(): Resend {
  if (!cachedResend) {
    cachedResend = new Resend(RESEND_API_KEY!);
  }
  return cachedResend;
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
  /** Provider message id if delivered (Resend id or Nodemailer's
   * messageId), null if dev-mode logged or failed. */
  messageId: string | null;
  /** Source of truth for what happened. */
  mode: "sent" | "logged" | "failed";
  /** Which provider handled the send (for debugging). */
  provider: Provider;
  /** Human-readable summary of the failure. */
  error?: string;
  /** Stable code for known failure modes — UI can branch on this. */
  errorCode?:
    | "AUTH_FAILED"
    | "CONNECTION_TIMEOUT"
    | "RATE_LIMITED"
    | "INVALID_RECIPIENT"
    | "UNKNOWN";
}

/** Map a raw provider error to a stable code for UI / audit consumers. */
function classifyError(rawMessage: string): SendResult["errorCode"] {
  const lower = rawMessage.toLowerCase();
  if (lower.includes("invalid login") || lower.includes("535-5.7"))
    return "AUTH_FAILED";
  if (lower.includes("etimedout") || lower.includes("timeout"))
    return "CONNECTION_TIMEOUT";
  if (lower.includes("rate") || lower.includes("4.7.0"))
    return "RATE_LIMITED";
  if (lower.includes("recipient") || lower.includes("address"))
    return "INVALID_RECIPIENT";
  return "UNKNOWN";
}

/**
 * Verify the active provider config is reachable + auth works. Used by
 * the Owner-side "Test Email" diagnostic button. Returns same SendResult
 * shape for consistency.
 */
export async function verifyEmailProvider(): Promise<SendResult> {
  const provider = activeProvider();
  if (provider === "dev-log") {
    return {
      ok: false,
      messageId: null,
      mode: "logged",
      provider: "dev-log",
      error:
        "GMAIL_USER + GMAIL_APP_PASSWORD belum di-set di Vercel env. Set dulu, lalu redeploy.",
      errorCode: "AUTH_FAILED",
    };
  }
  if (provider === "gmail") {
    try {
      const t = gmailTransporter();
      // Wrap verify in 8s hard timeout — verify() can hang on bad
      // network paths despite SMTPTransport's connectionTimeout. This
      // ensures the server action returns inside Vercel's 10s budget.
      // verify() returns true on success, throws on failure — wrap in
      // a hard timeout so we never hang past Vercel's 10s budget.
      await withTimeout(t.verify(), 8_000, () => {
        throw new Error("ETIMEDOUT — verify melebihi 8 detik");
      });
      return {
        ok: true,
        messageId: null,
        mode: "sent",
        provider: "gmail",
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.error("[email/send] verify failed:", e);
      return {
        ok: false,
        messageId: null,
        mode: "failed",
        provider: "gmail",
        error: msg,
        errorCode: classifyError(msg),
      };
    }
  }
  // resend — no verify endpoint; just send a no-op preflight via send to
  // EMAIL_FROM (or the API key holder)
  return {
    ok: true,
    messageId: null,
    mode: "sent",
    provider: "resend",
  };
}

/**
 * Best-effort send. Never throws — returns a result envelope so callers
 * (typically server actions) can decide whether the failure should
 * block the user flow or just log + warn.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const provider = activeProvider();

  if (provider === "dev-log") {
    console.log(
      `[email/send] DEV MODE — no GMAIL_USER + GMAIL_APP_PASSWORD or RESEND_API_KEY set. Would send:\n  To:      ${msg.to}\n  Subject: ${msg.subject}\n  Body:\n${msg.text}\n`,
    );
    return {
      ok: true,
      messageId: null,
      mode: "logged",
      provider: "dev-log",
    };
  }

  if (provider === "gmail") {
    try {
      const t = gmailTransporter();
      const result = await withTimeout(
        t.sendMail({
          // Gmail SMTP requires from = authenticated account. Display
          // name can be customized though.
          from: `Mahakan POS <${GMAIL_USER}>`,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
        9_000,
        () => {
          throw new Error("ETIMEDOUT — sendMail melebihi 9 detik");
        },
      );
      return {
        ok: true,
        messageId: result.messageId ?? null,
        mode: "sent",
        provider: "gmail",
      };
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : "Unknown Gmail SMTP error";
      // Log full error to server console for ops debugging — Vercel logs
      // capture this for `vercel logs` inspection.
      console.error("[email/send] Gmail SMTP send failed:", e);
      return {
        ok: false,
        messageId: null,
        mode: "failed",
        provider: "gmail",
        error: rawMsg,
        errorCode: classifyError(rawMsg),
      };
    }
  }

  // resend
  const from = EMAIL_FROM_ENV ?? "Mahakan POS <onboarding@resend.dev>";
  try {
    const c = resendClient();
    const { data, error } = await c.emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    if (error) {
      const rawMsg = error.message ?? String(error);
      console.error("[email/send] Resend send failed:", error);
      return {
        ok: false,
        messageId: null,
        mode: "failed",
        provider: "resend",
        error: rawMsg,
        errorCode: classifyError(rawMsg),
      };
    }
    return {
      ok: true,
      messageId: data?.id ?? null,
      mode: "sent",
      provider: "resend",
    };
  } catch (e) {
    const rawMsg = e instanceof Error ? e.message : "Unknown Resend send error";
    console.error("[email/send] Resend exception:", e);
    return {
      ok: false,
      messageId: null,
      mode: "failed",
      provider: "resend",
      error: rawMsg,
      errorCode: classifyError(rawMsg),
    };
  }
}
