/**
 * POST /api/settings/llm/test
 *
 * Validates a candidate LLM config WITHOUT saving it. The body matches
 * the PUT /api/settings/llm shape:
 *   { presetId, model?, baseUrl?, apiKey? }
 *
 * Special-cases for trust:
 *   - If apiKey is omitted AND the user already has a row, we read the
 *     stored ciphertext and decrypt it. This lets a user click "Test"
 *     after changing only the model without re-typing their key.
 *
 * Returns: { ok: true, latencyMs, sample } on success, or
 *          { ok: false, error } on failure.
 *
 * Side effects: none. We do not write the candidate config to
 * user_llm_prefs and we do not record an ai_calls row (this isn't a
 * gameplay turn).
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { findPreset, isValidPresetId } from "@/lib/ai/presets";
import { AnthropicProvider } from "@/lib/ai/providers/anthropic";
import { OpenAICompatibleProvider } from "@/lib/ai/providers/openai-compatible";
import { db } from "@/lib/db/client";
import { userLlmPrefs } from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { decryptSecret } from "@/lib/util/crypto";
import { log } from "@/lib/util/log";

async function requireUser(req: NextRequest): Promise<string | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const v = await verifyCookie(cookie);
  return v?.userId ?? null;
}

export async function POST(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: {
    presetId?: string;
    model?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const presetId = (body.presetId ?? "").trim();
  if (!presetId || !isValidPresetId(presetId)) {
    return NextResponse.json(
      { ok: false, error: "invalid presetId" },
      { status: 400 },
    );
  }
  const preset = findPreset(presetId)!;
  const model = (body.model ?? "").trim() || preset.defaultModel;
  if (!model) {
    return NextResponse.json(
      { ok: false, error: "model required" },
      { status: 400 },
    );
  }
  const baseUrl =
    preset.kind === "anthropic"
      ? null
      : (body.baseUrl ?? "").trim() || preset.baseUrl || "";
  if (preset.kind === "openai-compatible" && !baseUrl) {
    return NextResponse.json(
      { ok: false, error: "baseUrl required for this preset" },
      { status: 400 },
    );
  }

  // Resolve api key: explicit > stored.
  let apiKey = (body.apiKey ?? "").trim();
  if (!apiKey && preset.needsApiKey) {
    const rows = await db
      .select({ apiKeyEnc: userLlmPrefs.apiKeyEnc })
      .from(userLlmPrefs)
      .where(eq(userLlmPrefs.userId, userId))
      .limit(1);
    const enc = rows[0]?.apiKeyEnc;
    if (enc) {
      try {
        apiKey = decryptSecret(enc);
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error:
              "stored key could not be decrypted. paste a fresh key to retry.",
          },
          { status: 400 },
        );
      }
    }
  }
  if (preset.needsApiKey && !apiKey) {
    return NextResponse.json(
      { ok: false, error: "apiKey required for this preset" },
      { status: 400 },
    );
  }

  // Build a single-shot provider for this request only.
  let provider;
  try {
    if (preset.kind === "anthropic") {
      provider = new AnthropicProvider({ apiKey });
    } else {
      provider = new OpenAICompatibleProvider(
        baseUrl ?? "",
        apiKey || "ollama",
      );
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `provider init failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 400 },
    );
  }

  // Minimal probe: ask the model for one word back. We're testing reach,
  // auth, and "the model id is real" — not generation quality.
  const t0 = Date.now();
  try {
    const r = await provider.complete({
      model,
      maxTokens: 16,
      messages: [
        {
          role: "user",
          content:
            'Reply with just the single word "ok" (lowercase, no punctuation).',
        },
      ],
    });
    const latencyMs = Date.now() - t0;
    log.info("settings.llm.test_ok", {
      userId,
      presetId,
      model,
      latencyMs,
      sample: r.text.slice(0, 40),
    });
    return NextResponse.json({
      ok: true,
      latencyMs,
      sample: r.text.slice(0, 80),
      model,
    });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("settings.llm.test_failed", {
      userId,
      presetId,
      model,
      latencyMs,
      err: msg,
    });
    return NextResponse.json(
      {
        ok: false,
        error: msg.slice(0, 500),
        latencyMs,
      },
      { status: 200 }, // 200 OK + ok:false; the request itself succeeded
    );
  }
}
