/**
 * Failover wrapper — Phase 7 Day 40-41.
 *
 * Wraps the existing AIProvider list and tries each in chain
 * order. On every call: write success/failure into provider_health
 * (the 3-strikes-and-degrade rule lives in lib/ai/health.ts).
 * 'down' / 'manual_down' providers are skipped before we even
 * attempt them.
 *
 * Tail of the chain is the sentinel string 'template' — when the
 * wrapper falls all the way through, it throws a sentinel error
 * the orchestrator catches and routes to the TemplateNarrator.
 */
import type { Db } from "../db/client";

import {
  failoverChain,
  getAllHealth,
  recordFailure,
  recordSuccess,
} from "./health";
import type {
  AIProvider,
  CompleteArgs,
  CompleteResponse,
  CompleteStreamEvents,
} from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { BedrockProvider } from "./providers/bedrock";
import { VertexProvider } from "./providers/vertex";

export class AllProvidersDownError extends Error {
  constructor(public attempted: string[]) {
    super(
      `all_providers_down: tried ${attempted.join(",")}; falling through to TemplateNarrator`,
    );
    this.name = "AllProvidersDownError";
  }
}

const REGISTRY: Record<string, () => AIProvider> = {
  anthropic: () => new AnthropicProvider(),
  bedrock: () => new BedrockProvider(),
  vertex: () => new VertexProvider(),
};

export class FailoverProvider implements AIProvider {
  readonly providerName = "failover";
  private db: Db;
  private preferredId: string;

  constructor(args: { db: Db; preferredId?: string }) {
    this.db = args.db;
    this.preferredId =
      args.preferredId ??
      ((process.env.AI_PROVIDER ?? "anthropic").toLowerCase());
  }

  private async resolveChain(): Promise<string[]> {
    const states = await getAllHealth(this.db);
    return failoverChain(this.preferredId, states);
  }

  async complete(args: CompleteArgs): Promise<CompleteResponse> {
    const chain = await this.resolveChain();
    const tried: string[] = [];
    for (const id of chain) {
      if (id === "template") break;
      const factory = REGISTRY[id];
      if (!factory) continue;
      const provider = factory();
      tried.push(id);
      try {
        const r = await provider.complete(args);
        await recordSuccess(this.db, id);
        return r;
      } catch (err) {
        await recordFailure(this.db, id);
        // Continue to next provider in chain. We don't surface
        // the underlying error unless every provider fails.
        void err;
      }
    }
    throw new AllProvidersDownError(tried);
  }

  async completeStream(
    args: CompleteArgs,
    events: CompleteStreamEvents,
  ): Promise<CompleteResponse> {
    const chain = await this.resolveChain();
    const tried: string[] = [];
    for (const id of chain) {
      if (id === "template") break;
      const factory = REGISTRY[id];
      if (!factory) continue;
      const provider = factory();
      tried.push(id);
      if (!provider.completeStream) continue;
      try {
        const r = await provider.completeStream(args, events);
        await recordSuccess(this.db, id);
        return r;
      } catch (err) {
        await recordFailure(this.db, id);
        void err;
      }
    }
    throw new AllProvidersDownError(tried);
  }
}
