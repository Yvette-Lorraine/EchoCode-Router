/**
 * 极简结构化 logger。
 * - 默认 console.log + JSON.stringify 一行
 * - 路由层 / 网关层 / 探测层统一用它打点
 * - 真实生产可替换为 pino / winston / 阿里云日志
 * - 自动脱敏：任何值含 "secret"/"apikey"/"password"/"authorization" key 的会被掩盖
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [k: string]: unknown;
}

const SENSITIVE_KEY_RE = /(secret|apikey|password|authorization|token|byokpay|encrypted|envelopekey)/i;

function redact(obj: any, seen = new WeakSet<object>()): any {
  if (obj == null || typeof obj !== "object") return obj;
  if (seen.has(obj)) return obj;
  seen.add(obj);
  if (Array.isArray(obj)) return obj.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = "***REDACTED***";
    } else {
      out[k] = redact(obj[k], seen);
    }
  }
  return out;
}

function emit(level: LogLevel, fields: LogFields, msg?: string) {
  const payload = {
    t: new Date().toISOString(),
    level,
    msg: msg ?? "",
    ...redact(fields),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  debug: (msgOrFields: string | LogFields, fields?: LogFields) => {
    if (typeof msgOrFields === "string") emit("debug", fields ?? {}, msgOrFields);
    else emit("debug", msgOrFields);
  },
  info: (msgOrFields: string | LogFields, fields?: LogFields) => {
    if (typeof msgOrFields === "string") emit("info", fields ?? {}, msgOrFields);
    else emit("info", msgOrFields);
  },
  warn: (msgOrFields: string | LogFields, fields?: LogFields) => {
    if (typeof msgOrFields === "string") emit("warn", fields ?? {}, msgOrFields);
    else emit("warn", msgOrFields);
  },
  error: (msgOrFields: string | LogFields, fields?: LogFields) => {
    if (typeof msgOrFields === "string") emit("error", fields ?? {}, msgOrFields);
    else emit("error", msgOrFields);
  },
};

// 路由层专用快捷记录
export function logRouteDecision(opts: {
  orgId: string;
  requestId: string;
  requestedModel: string;
  strategy: string;
  chosen?: { providerId: string; modelId: string; byokIdMasked?: string } | null;
  fallbackChain: string[];
  totalRouterMs: number;
  status: "success" | "fallback-success" | "all-failed";
}) {
  emit("info", {
    event: "route.decision",
    orgId: opts.orgId,
    requestId: opts.requestId,
    requestedModel: opts.requestedModel,
    strategy: opts.strategy,
    chosen: opts.chosen,
    fallbackChainLen: opts.fallbackChain.length,
    fallbackChain: opts.fallbackChain,
    totalRouterMs: opts.totalRouterMs,
    status: opts.status,
  });
}
