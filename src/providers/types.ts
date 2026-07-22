// Provider Adapter contract — every upstream integration implements this.
// The gateway calls adapter.streamChat / embed / listModels with no other dependencies.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool" | "developer";
  content: string | ChatContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters: any };
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string | string[];
  stream?: boolean;
  tools?: ChatTool[];
  tool_choice?: any;
  response_format?: { type: "json_object" | "json_schema"; json_schema?: any };
  user?: string;
  // Echo Code metadata
  metadata?: Record<string, any>;
}

export interface ChatChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: ChatToolCall[];
  };
  finish_reason: string | null;
}

export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export interface ChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: { index: number; delta: Partial<ChatMessage & { tool_calls?: ChatToolCall[] }>; finish_reason: string | null }[];
  usage?: ChatResponse["usage"];
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  user?: string;
}

export interface EmbeddingItem {
  index: number;
  embedding: number[];
  object: "embedding";
}

export interface EmbeddingResponse {
  object: "list";
  model: string;
  data: EmbeddingItem[];
  usage: { prompt_tokens: number; total_tokens: number };
}

export interface ProviderError extends Error {
  status?: number;
  code?: string;
  upstream?: any;
}

export interface ProviderContext {
  // Either a BYOK plaintext key or a platform account key from the secret manager.
  apiKey: string;
  baseUrl?: string;
  orgId?: string;
  keyId?: string;
}

export interface ProviderAdapter {
  id: string;
  streamChat(req: ChatRequest, ctx: ProviderContext): AsyncIterable<ChatChunk> | Promise<AsyncIterable<ChatChunk>>;
  completeChat(req: ChatRequest, ctx: ProviderContext): Promise<ChatResponse>;
  embed(req: EmbeddingRequest, ctx: ProviderContext): Promise<EmbeddingResponse>;
}

export function providerError(status: number, message: string, code?: string): ProviderError {
  const e = new Error(message) as ProviderError;
  e.status = status;
  if (code) e.code = code;
  return e;
}
