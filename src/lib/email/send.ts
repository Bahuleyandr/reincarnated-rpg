/**
 * Email send — Phase 8 Day 68.
 *
 * Provider-agnostic interface. Default impl uses Resend when
 * RESEND_API_KEY is set; otherwise logs the email to stdout
 * (dev mode) so the rest of the system can be exercised without
 * a real provider.
 *
 * Templates live in src/lib/email/templates.ts as pure
 * functions — they take whatever the caller has (username,
 * chapter title, etc.) and return { subject, text, html }.
 */
import { env } from "../util/env";
import { log } from "../util/log";

export interface EmailRequest {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Optional unsubscribe link header. Resend honors this; the
   *  log-stdout fallback prints it for QA. */
  unsubscribeUrl?: string;
}

export interface EmailResult {
  ok: boolean;
  /** Provider message id when known. */
  id?: string;
  /** Error code surface ("not_configured", "rate_limited", etc.). */
  error?: string;
}

export async function sendEmail(req: EmailRequest): Promise<EmailResult> {
  const e = env();
  // The env module may not export RESEND_API_KEY yet — read directly
  // from process.env to keep this independent.
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "no-reply@reincarnated.local";

  if (!key) {
    // Dev / staging mode: log + claim success.
    log.info("email.dev_log", {
      to: req.to,
      from,
      subject: req.subject,
      preview: req.text.slice(0, 200),
      unsubscribeUrl: req.unsubscribeUrl,
    });
    return { ok: true, id: "dev-log" };
  }

  try {
    // Lazy + opaque import — keeps the resend SDK out of bundles
    // when it's not installed AND prevents TS from trying to
    // resolve the module at compile time. (The dependency is
    // optional; install resend + RESEND_API_KEY=... to activate.)
    const dynImport = new Function("p", "return import(p)") as (
      p: string,
    ) => Promise<unknown>;
    const mod = (await dynImport("resend")) as {
      Resend: new (k: string) => {
        emails: {
          send(args: {
            from: string;
            to: string;
            subject: string;
            text: string;
            html?: string;
            headers?: Record<string, string>;
          }): Promise<{ data?: { id: string }; error?: { message: string } }>;
        };
      };
    };
    const { Resend } = mod;
    const resend = new Resend(key);
    const headers: Record<string, string> = {};
    if (req.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${req.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const r = await resend.emails.send({
      from,
      to: req.to,
      subject: req.subject,
      text: req.text,
      ...(req.html ? { html: req.html } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    });
    if (r.error) {
      log.warn("email.send_failed", {
        to: req.to,
        error: r.error.message,
      });
      return { ok: false, error: r.error.message };
    }
    return { ok: true, id: r.data?.id };
  } catch (err) {
    log.warn("email.send_threw", {
      to: req.to,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "send_threw" };
  }
  void e;
}
