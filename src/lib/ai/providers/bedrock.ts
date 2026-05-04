/**
 * AWS Bedrock provider stub — Phase 7 Day 40-41.
 *
 * The wire-shape for Anthropic Claude on Bedrock matches the
 * Anthropic Messages API closely; tool_use blocks are identical.
 * This stub returns a `not_configured` rejection until real
 * credentials + the @aws-sdk/client-bedrock-runtime dependency are
 * added. Slot exists so the failover chain has a place to route
 * to without code changes when AWS is wired up.
 *
 * To enable: install @aws-sdk/client-bedrock-runtime, set
 * AWS_REGION + AWS credentials in env, replace the stub body
 * with a real BedrockRuntimeClient call.
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

export class BedrockProvider implements AIProvider {
  readonly providerName = "bedrock";

  async complete(_args: CompleteArgs): Promise<CompleteResponse> {
    void _args;
    throw new NotConfiguredError("bedrock");
  }

  async completeStream(
    _args: CompleteArgs,
    _events: CompleteStreamEvents,
  ): Promise<CompleteResponse> {
    void _args;
    void _events;
    throw new NotConfiguredError("bedrock");
  }
}
