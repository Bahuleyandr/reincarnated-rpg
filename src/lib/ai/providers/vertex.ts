/**
 * Google Vertex AI provider stub — Phase 7 Day 40-41.
 *
 * Anthropic Claude on Vertex uses the same tool-use shape as the
 * direct Anthropic API. This stub stays not-configured until the
 * @google-cloud/aiplatform dep is added and PROJECT_ID + REGION
 * env vars are set. Behind a feature flag in the factory so the
 * failover chain can include it without breaking when GCP isn't
 * connected.
 */
import type {
  AIProvider,
  CompleteArgs,
  CompleteResponse,
  CompleteStreamEvents,
} from "../provider";

class NotConfiguredError extends Error {
  constructor(provider: string) {
    super(`provider_not_configured:${provider}`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class VertexProvider implements AIProvider {
  readonly providerName = "vertex";

  async complete(_args: CompleteArgs): Promise<CompleteResponse> {
    void _args;
    throw new NotConfiguredError("vertex");
  }

  async completeStream(
    _args: CompleteArgs,
    _events: CompleteStreamEvents,
  ): Promise<CompleteResponse> {
    void _args;
    void _events;
    throw new NotConfiguredError("vertex");
  }
}
