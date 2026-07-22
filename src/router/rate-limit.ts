/**
 * Per-orgId QPS 限流（in-memory token bucket）。
 * - 每 orgId 一个 1 分钟填充窗口
 * - 默认允许 600 req/min（约 10 req/s），可被环境变量覆盖
 * - 拒绝时返回 false（不抛错，让调用方决定 429 响应）
 *
 * 注意：单实例内存限流。多实例需要 Redis / Token Server。阶段 5 仅做最小可行。
 */

export interface RateLimitOpts {
  limitPerMin: number;
}

const BUCKET = new Map<string, { tokens: number; lastRefillMs: number }>();
const SWEEP_MS = 30_000;

function ensureSweep() {
  if ((BUCKET as any).__sweep) return;
  (BUCKET as any).__sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of BUCKET) {
      // 5 分钟没用的桶清空
      if (now - v.lastRefillMs > 5 * 60_000) BUCKET.delete(k);
    }
  }, SWEEP_MS);
  // unref 不阻塞进程退出
  if (typeof (BUCKET as any).__sweep?.unref === "function") (BUCKET as any).__sweep.unref();
}

export function consume(orgId: string, opts?: Partial<RateLimitOpts>): { allowed: boolean; remaining: number; limit: number } {
  ensureSweep();
  const limit = opts?.limitPerMin ?? parseInt(process.env.ECHO_RATE_LIMIT_PER_MIN ?? "600", 10);
  // dev log
  if (process.env.NODE_ENV !== "production") {
    (globalThis as any).__rl_last = { limit, envVal: process.env.ECHO_RATE_LIMIT_PER_MIN };
  }
  const now = Date.now();
  let bucket = BUCKET.get(orgId);
  if (!bucket) {
    bucket = { tokens: limit, lastRefillMs: now };
    BUCKET.set(orgId, bucket);
  }
  const elapsed = now - bucket.lastRefillMs;
  if (elapsed > 0) {
    const refill = (elapsed / 60_000) * limit;
    bucket.tokens = Math.min(limit, bucket.tokens + refill);
    bucket.lastRefillMs = now;
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), limit };
  }
  return { allowed: false, remaining: 0, limit };
}

export function rateLimitStats() {
  const orgs = Array.from(BUCKET.keys());
  return {
    buckets: BUCKET.size,
    orgs: orgs.length,
    sample: orgs.slice(0, 5).map((k) => ({ orgId: k, tokens: BUCKET.get(k)?.tokens })),
  };
}
