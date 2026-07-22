import type { ChatRequest, ChatResponse, ChatChunk, ProviderAdapter, ProviderContext, EmbeddingRequest, EmbeddingResponse } from "./types";
import { providerError } from "./types";

// Mock provider for development. Returns deterministic outputs, no network.

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function approxTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function lastUserText(req: ChatRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m.role === "user") return typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  }
  return "";
}

function mockDebugFail(): { status: number; body: string } | null {
  const s = process.env.ECHO_DEBUG_FAIL;
  if (!s) return null;
  const [statusStr] = s.split(":");
  const status = parseInt(statusStr ?? "500", 10);
  if (Number.isNaN(status)) return null;
  return { status, body: `${s}` };
}

export const mockAdapter: ProviderAdapter = {
  id: "mock",
  async completeChat(req: ChatRequest, ctx: ProviderContext): Promise<ChatResponse> {
    const fail = mockDebugFail();
    if (fail) throw providerError(fail.status, `mock-debug-fail status=${fail.status}`, "MOCK_DEBUG_FAIL");
    const prompt = lastUserText(req);
    const completion = `[mock:${req.model}] ${prompt.slice(0, 120)}`;
    const pt = approxTokens(prompt);
    const ct = approxTokens(completion);
    return {
      id: `mock-${Math.random().toString(36).slice(2)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: completion },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct },
    };
  },
  async *streamChat(req: ChatRequest, ctx: ProviderContext): AsyncIterable<ChatChunk> {
    const fail = mockDebugFail();
    if (fail) {
      // 流失败：抛一次 ProviderError 让外层接住
      throw providerError(fail.status, `mock-debug-fail status=${fail.status}`, "MOCK_DEBUG_FAIL");
    }
    const base = {
      id: `mock-${Math.random().toString(36).slice(2)}`,
      object: "chat.completion.chunk" as const,
      created: Math.floor(Date.now() / 1000),
      model: req.model,
    };
    const prompt = lastUserText(req);
    const pt = approxTokens(prompt);
    const completion = `[mock:${req.model}] ${prompt.slice(0, 120)}`;
    const tokens = completion.split(/(\s+)/).filter(Boolean);
    yield { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] };
    for (const t of tokens) {
      await sleep(40);
      yield { ...base, choices: [{ index: 0, delta: { content: t }, finish_reason: null }] };
    }
    yield { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    yield {
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      usage: { prompt_tokens: pt, completion_tokens: approxTokens(completion), total_tokens: pt + approxTokens(completion) },
    };
  },
  async embed(req: EmbeddingRequest, _ctx: ProviderContext): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(req.input) ? req.input : [req.input];
    const data = inputs.map((s, i) => ({
      object: "embedding" as const,
      index: i,
      embedding: Array.from({ length: 64 }, (_, k) => Math.sin(s.length + k) * 0.001),
    }));
    return {
      object: "list",
      model: req.model,
      data,
      usage: { prompt_tokens: inputs.reduce((a, s) => a + approxTokens(s), 0), total_tokens: 0 },
    };
  },
};

class ProviderError extends Error {
  status: number;
  code: string;
  upstream: any;
  constructor(message: string, status: number, code: string, upstream: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.upstream = upstream;
  }
}
// unused — 用 types.ts 的 providerError
void ProviderError;
