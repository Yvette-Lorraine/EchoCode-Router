import type { ChatRequest, ChatResponse, ChatChunk, ProviderAdapter, ProviderContext, EmbeddingRequest, EmbeddingResponse } from "./types";
import { providerError } from "./types";

// Adapter for any OpenAI-compatible API (OpenAI, DeepSeek, Moonshot, Zhipu, Qwen, etc.)
// Auth: Authorization: Bearer <key>. Body/response format is OpenAI-compatible.

async function fetchUpstream(url: string, init: RequestInit, timeoutMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function getBaseUrl(providerBase: string | undefined, fallback = "https://api.openai.com"): string {
  const raw = (providerBase ?? fallback).replace(/\/+$/, "");
  return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}

export function makeOpenAIAdapter(providerBaseUrl?: string, providerId = "openai"): ProviderAdapter {
  const base = getBaseUrl(providerBaseUrl);

  return {
    id: providerId,

    async completeChat(req: ChatRequest, ctx: ProviderContext) {
      const res = await fetchUpstream(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.apiKey}`,
            "User-Agent": "echo-code/0.1 (+gateway)",
          },
          body: JSON.stringify({ ...req, stream: false }),
        },
        90_000
      );
      const text = await res.text();
      if (!res.ok) throw providerError(res.status, text || res.statusText, "UPSTREAM_ERROR");
      try {
        const json = JSON.parse(text) as ChatResponse;
        return json;
      } catch (e) {
        throw providerError(502, "Invalid JSON from upstream", "UPSTREAM_INVALID");
      }
    },

    async *streamChat(req: ChatRequest, ctx: ProviderContext): AsyncIterable<ChatChunk> {
      const res = await fetchUpstream(
        `${base}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.apiKey}`,
            "User-Agent": "echo-code/0.1 (+gateway)",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ ...req, stream: true }),
        },
        90_000
      );
      if (!res.ok || !res.body) {
        const t = await res.text().catch(() => "");
        throw providerError(res.status, t || res.statusText, "UPSTREAM_ERROR");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trimEnd();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          try {
            yield JSON.parse(data) as ChatChunk;
          } catch {
            // skip malformed chunks
          }
        }
      }
    },

    async embed(req: EmbeddingRequest, ctx: ProviderContext): Promise<EmbeddingResponse> {
      const res = await fetchUpstream(
        `${base}/embeddings`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ctx.apiKey}`,
            "User-Agent": "echo-code/0.1 (+gateway)",
          },
          body: JSON.stringify(req),
        },
        60_000
      );
      const text = await res.text();
      if (!res.ok) throw providerError(res.status, text || res.statusText, "UPSTREAM_ERROR");
      return JSON.parse(text);
    },
  };
}
