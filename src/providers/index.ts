import type { ProviderAdapter } from "./types";
import { makeOpenAIAdapter } from "./openai";
import { mockAdapter } from "./mock";

/**
 * Provider registry: id -> adapter. 进程内缓存，避免重复构造。
 * Real upstream keys come from caller (BYOK rows or platform secrets) — see Adapter contract.
 */
const cache = new Map<string, ProviderAdapter>();

export function getAdapter(providerId: string): ProviderAdapter {
  const hit = cache.get(providerId);
  if (hit) return hit;
  let adapter: ProviderAdapter;
  if (providerId === "mock") {
    adapter = mockAdapter;
  } else {
    // Default to OpenAI-compatible. Caller may pass a different baseUrl via constructor.
    adapter = makeOpenAIAdapter(undefined, providerId);
  }
  cache.set(providerId, adapter);
  return adapter;
}

export function resetAdapterCache() {
  cache.clear();
}
