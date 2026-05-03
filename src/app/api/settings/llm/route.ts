/**
 * GET    /api/settings/llm — read the user's saved BYO-LLM prefs (the
 *                            api key is NEVER returned; only a boolean
 *                            "set"/"unset" indicator). Returns the
 *                            preset catalog inline so the UI can
 *                            render the picker without a second call.
 * PUT    /api/settings/llm — upsert. Body: { presetId, model, baseUrl?, apiKey? }
 *                            apiKey is encrypted with the SESSION_SECRET-derived
 *                            key before insert. If apiKey is omitted on update,
 *                            the existing ciphertext is kept.
 * DELETE /api/settings/llm — drop the row, restoring env-default.
 *
 * Auth: cookie userId required; returns 401 otherwise.
 */
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { warnIfShaky } from "@/lib/ai/model-registry";
import { findPreset, isValidPresetId, PRESETS } from "@/lib/ai/presets";
import { db } from "@/lib/db/client";
import { userLlmPrefs } from "@/lib/db/schema";
import {
  SESSION_COOKIE_NAME,
  verifyCookie,
} from "@/lib/session/cookie";
import { encryptSecret } from "@/lib/util/crypto";
import { log } from "@/lib/util/log";

async function requireUser(req: NextRequest): Promise<string | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const v = await verifyCookie(cookie);
  return v?.userId ?? null;
}

export async function GET(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const rows = await db
    .select({
      presetId: userLlmPrefs.presetId,
      providerKind: userLlmPrefs.providerKind,
      baseUrl: userLlmPrefs.baseUrl,
      model: userLlmPrefs.model,
      classifierModel: userLlmPrefs.classifierModel,
      toneModel: userLlmPrefs.toneModel,
      useLlmClassifier: userLlmPrefs.useLlmClassifier,
      useLlmTone: userLlmPrefs.useLlmTone,
      hasKey: userLlmPrefs.apiKeyEnc,
      updatedAt: userLlmPrefs.updatedAt,
    })
    .from(userLlmPrefs)
    .where(eq(userLlmPrefs.userId, userId))
    .limit(1);
  const r = rows[0];
  return NextResponse.json({
    presets: PRESETS,
    prefs: r
      ? {
          presetId: r.presetId,
          providerKind: r.providerKind,
          baseUrl: r.baseUrl,
          model: r.model,
          classifierModel: r.classifierModel,
          toneModel: r.toneModel,
          useLlmClassifier: r.useLlmClassifier === "true",
          useLlmTone: r.useLlmTone === "true",
          hasKey: !!r.hasKey,
          updatedAt: r.updatedAt,
        }
      : null,
  });
}

export async function PUT(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  let body: {
    presetId?: string;
    model?: string;
    classifierModel?: string;
    toneModel?: string;
    useLlmClassifier?: boolean;
    useLlmTone?: boolean;
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
      { error: "invalid presetId" },
      { status: 400 },
    );
  }
  const preset = findPreset(presetId)!;
  const model = (body.model ?? "").trim() || preset.defaultModel;
  if (!model) {
    return NextResponse.json(
      { error: "model required" },
      { status: 400 },
    );
  }
  const baseUrlRaw = (body.baseUrl ?? "").trim();
  const baseUrl =
    preset.kind === "anthropic"
      ? null
      : baseUrlRaw || preset.baseUrl || null;
  if (preset.kind === "openai-compatible" && !baseUrl) {
    return NextResponse.json(
      { error: "baseUrl required for this preset" },
      { status: 400 },
    );
  }

  const apiKeyRaw = (body.apiKey ?? "").trim();
  let apiKeyEnc: string | null | undefined = undefined;
  if (apiKeyRaw) {
    apiKeyEnc = encryptSecret(apiKeyRaw);
  } else if (!preset.needsApiKey) {
    apiKeyEnc = null; // explicit clear for ollama-local
  }
  // If apiKeyRaw is empty AND preset needs a key, we keep the existing
  // ciphertext (undefined → not in update set). On INSERT we require a key.

  const existing = await db
    .select({ apiKeyEnc: userLlmPrefs.apiKeyEnc })
    .from(userLlmPrefs)
    .where(eq(userLlmPrefs.userId, userId))
    .limit(1);
  const isInsert = existing.length === 0;

  if (isInsert && preset.needsApiKey && !apiKeyRaw) {
    return NextResponse.json(
      { error: "apiKey required for this preset" },
      { status: 400 },
    );
  }

  const classifierModel = (body.classifierModel ?? "").trim() || null;
  const toneModel = (body.toneModel ?? "").trim() || null;
  const useLlmClassifier = body.useLlmClassifier ? "true" : "false";
  const useLlmTone = body.useLlmTone ? "true" : "false";

  const now = new Date();
  if (isInsert) {
    await db.insert(userLlmPrefs).values({
      userId,
      presetId,
      providerKind: preset.kind,
      baseUrl,
      model,
      classifierModel,
      toneModel,
      useLlmClassifier,
      useLlmTone,
      apiKeyEnc: apiKeyEnc ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await db
      .update(userLlmPrefs)
      .set({
        presetId,
        providerKind: preset.kind,
        baseUrl,
        model,
        classifierModel,
        toneModel,
        useLlmClassifier,
        useLlmTone,
        ...(apiKeyEnc !== undefined ? { apiKeyEnc } : {}),
        updatedAt: now,
      })
      .where(eq(userLlmPrefs.userId, userId));
  }
  log.info("settings.llm.saved", { userId, presetId, model });
  return NextResponse.json({
    ok: true,
    prefs: {
      presetId,
      providerKind: preset.kind,
      baseUrl,
      model,
      classifierModel,
      toneModel,
      useLlmClassifier: body.useLlmClassifier ?? false,
      useLlmTone: body.useLlmTone ?? false,
      hasKey:
        apiKeyEnc !== undefined
          ? !!apiKeyEnc
          : !!existing[0]?.apiKeyEnc,
      updatedAt: now,
    },
    warnings: [
      warnIfShaky(presetId, model),
      classifierModel ? warnIfShaky(presetId, classifierModel) : null,
      toneModel ? warnIfShaky(presetId, toneModel) : null,
    ].filter((s): s is string => Boolean(s)),
  });
}

export async function DELETE(req: NextRequest) {
  const userId = await requireUser(req);
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  await db.delete(userLlmPrefs).where(eq(userLlmPrefs.userId, userId));
  log.info("settings.llm.cleared", { userId });
  return NextResponse.json({ ok: true });
}
