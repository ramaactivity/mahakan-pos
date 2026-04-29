import "server-only";

import nodemailer, { type Transporter } from "nodemailer";
import { Resend } from "resend";

/**
 * Email sender wrapper. Supports two providers in this order:
 *
 * 1. **Gmail SMTP (App Password)** — Recommended for Mahakan scale.
 *    Set `GMAIL_USER` (the Gmail address) + `GMAIL_APP_PASSWORD` (16-char
 *    App Password from Google Account → Security → 2-Step Verification →
 *    App passwords). The `from` field is forced to the GMAIL_USER value
 *    because Google enforces SMTP-sender = authenticated user.
 *
 * 2. **Resend** — alternative for higher volume / branded sender domain.
 *    Set `RESEND_API_KEY` + `EMAIL_FROM` (e.g., "Mahakan POS
 *    <noreply@yourdomain>"). Use sandbox `onboarding@resend.dev` if no
 *    custom domain.
 *
 * 3. **Dev-mode console log** — neither provider configured. Logs the
 *    intended message so devs can copy codes from server console without
 *    setting up real email infra.
 *
 * The wrapper auto-picks based on env presence — no code change needed
 * when switching providers. Gmail wins if both are set (cheaper,
 * simpler).
 */

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM_ENV = process.env.EMAIL_FROM;

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
    cachedTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: GMAIL_USER,
        pass: GMAIL_APP_PASSWORD,
      },
    });
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
  error?: string;
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
      const result = await t.sendMail({
        // Gmail SMTP requires from = authenticated account. We can prefix a
        // friendly display name though.
        from: `Mahakan POS <${GMAIL_USER}>`,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      return {
        ok: true,
        messageId: result.messageId ?? null,
        mode: "sent",
        provider: "gmail",
      };
    } catch (e) {
      return {
        ok: false,
        messageId: null,
        mode: "failed",
        provider: "gmail",
        error: e instanceof Error ? e.message : "Unknown Gmail SMTP error",
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
      return {
        ok: false,
        messageId: null,
        mode: "failed",
        provider: "resend",
        error: error.message ?? String(error),
      };
    }
    return {
      ok: true,
      messageId: data?.id ?? null,
      mode: "sent",
      provider: "resend",
    };
  } catch (e) {
    return {
      ok: false,
      messageId: null,
      mode: "failed",
      provider: "resend",
      error: e instanceof Error ? e.message : "Unknown Resend send error",
    };
  }
}
