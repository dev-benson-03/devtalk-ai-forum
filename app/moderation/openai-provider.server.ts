/**
 * OpenAI Moderation API provider (openai SDK 6.x, `moderations.create`).
 * Uses the same server-only OPENAI_API_KEY as the analysis route. The
 * Moderation API itself is free of charge.
 */
import OpenAI from "openai";
import type { ModerationProvider } from "./moderation.server";
import { MODERATION_MODEL } from "./policy.server";

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 1;

/** Returns null when no API key is configured, so moderation fails closed. */
export function openAIModerationProvider(apiKey = process.env.OPENAI_API_KEY): ModerationProvider | null {
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES });
  return (inputs) => client.moderations.create({ model: MODERATION_MODEL, input: inputs });
}
