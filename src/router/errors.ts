/**
 * 上游失败分类器 — 决定是否切换下一候选。
 *
 * TRANSIENT      — 可重试：5xx、超时、TLS、连接重置、429 rate-limit
 * NON_TRANSIENT  — 立即返回：401/403（凭据错/封禁）、404（model 不存在）、400/422（用户参数错）
 * BALANCE        — 余额/额度类错误；可换账户但不能换 prompt → 切下一候选（拿不同 Key 试）
 */

export enum ErrorClass {
  TRANSIENT = "TRANSIENT",
  NON_TRANSIENT = "NON_TRANSIENT",
  BALANCE = "BALANCE",
}

export interface ClassifyOpts {
  status?: number;
  bodyText?: string;
  /** 上游抛出的 Error 对象 */
  error?: unknown;
}

/** HTTP 状态码分类。先看代码，再看文本兜底。 */
export function classifyUpstreamError(opts: ClassifyOpts): ErrorClass {
  const { status, bodyText, error } = opts;
  if (status !== undefined) {
    // 401/403 是凭据错误；归 TRANSIENT 让 cascade 切下一 BYOK/provider，但仍在 markByokFailure 中立即 invalidate 该 Key
    if (status === 401 || status === 403) return ErrorClass.TRANSIENT;
    // 404 / 400 / 422 是用户参数/资源错误，不能用切其它候选掩盖
    if (status === 404 || status === 400 || status === 422) return ErrorClass.NON_TRANSIENT;
    if (status === 402) return ErrorClass.BALANCE;
    if (status === 408) return ErrorClass.TRANSIENT;
    if (status === 429 || status === 503 || (status >= 500 && status < 600)) {
      return ErrorClass.TRANSIENT;
    }
    // 1xx 视为 transient（continue）
    if (status >= 100 && status < 200) return ErrorClass.TRANSIENT;
  }
  const lower = (bodyText ?? "").toLowerCase();
  if (lower) {
    if (lower.includes("insufficient") || lower.includes("quota") || lower.includes("balance")) {
      return ErrorClass.BALANCE;
    }
    if (lower.includes("invalid_api_key") || lower.includes("invalid request") || lower.includes("not found") || lower.includes("does not exist") || lower.includes("unauthorized") || lower.includes("forbidden")) {
      return ErrorClass.NON_TRANSIENT;
    }
    if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("temporarily unavailable") || lower.includes("overloaded") || lower.includes("timeout") || lower.includes("server error")) {
      return ErrorClass.TRANSIENT;
    }
  }
  const msg = ((error as any)?.message ?? "").toString().toLowerCase();
  if (msg) {
    if (msg.includes("abort") || msg.includes("timeout")) return ErrorClass.TRANSIENT;
    if (msg.includes("econnreset") || msg.includes("enotfound") || msg.includes("tls") || msg.includes("network"))
      return ErrorClass.TRANSIENT;
  }
  // 未知：默认按 transient 试一次（下一候选）
  return ErrorClass.TRANSIENT;
}

/** 是否应该立即熔断指定的 BYOK Key（401/403 类） */
export function shouldImmediateInvalidate(status?: number): boolean {
  if (status === undefined) return false;
  return status === 401 || status === 403;
}
