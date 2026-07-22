/**
 * 健康告警评估 — 纯函数 + 数据获取 callback。
 *
 * - 任一 provider successRate < 0.95 连续 5 分钟 → critical
 * - 任一 provider consecutiveFailures >= 3 → warning
 * - 最近 24h fallbackChain 平均长度 > N → degradation
 */

export type AlertLevel = "info" | "warn" | "critical";

export interface AlertResult {
  level: AlertLevel;
  message: string;
  meta?: Record<string, unknown>;
}

export interface UsageStats {
  total: number;
  fallbackCount: number;
  avgFallbackLen: number;
  maxFallbackLen: number;
}

// 复用 health-probe 的 HealthRecord（保持类型一致）
import type { HealthRecord as HealthSnapshot } from "./health-probe";
export type { HealthSnapshot };

export interface AlertHooks {
  loadHealthSnapshots(): Promise<HealthSnapshot[]>;
  load24hUsage(): Promise<UsageStats>;
  emit(alert: AlertResult): void; // 由调用方决定写 log / 推 IM
}

const HISTORY = new Map<string, { below95Since?: number }>();
const ALERT_DEDUP = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000;
const FAIL_THRESHOLD = 3;
const SUSTAINED_MS = 5 * 60 * 1000;
const AVG_FALLBACK_THRESHOLD = 1.5;
const MIN_CALLS = 50;

export async function evaluateHealthAlerts(hooks: AlertHooks): Promise<AlertResult[]> {
  const now = Date.now();
  const out: AlertResult[] = [];

  // 1. provider 维度
  const latest: HealthSnapshot[] = [];
  const seen = new Set<string>();
  for (const s of await hooks.loadHealthSnapshots()) {
    if (seen.has(s.providerId)) continue;
    seen.add(s.providerId);
    latest.push(s);
  }
  for (const h of latest) {
    const key = `provider:${h.providerId}`;
    if (h.consecutiveFailures >= FAIL_THRESHOLD) {
      out.push({
        level: "warn",
        message: `${h.providerId} 连续 ${h.consecutiveFailures} 次探测失败`,
        meta: { providerId: h.providerId },
      });
      ALERT_DEDUP.set(key, now);
    }
    if ((h.successRate ?? 1) < 0.95) {
      const hist = HISTORY.get(h.providerId) ?? {};
      if (!hist.below95Since) hist.below95Since = now;
      const minutes = (now - hist.below95Since) / 60_000;
      HISTORY.set(h.providerId, hist);
      if (
        minutes * 60_000 >= SUSTAINED_MS &&
        (!ALERT_DEDUP.has(`${key}:critical`) ||
          now - (ALERT_DEDUP.get(`${key}:critical`) ?? 0) > DEDUP_TTL_MS)
      ) {
        out.push({
          level: "critical",
          message: `${h.providerId} 成功率持续低于 95% 超过 ${minutes.toFixed(0)} 分钟（当前 ${(h.successRate * 100).toFixed(1)}%）`,
          meta: { providerId: h.providerId, successRate: h.successRate, p95Ms: h.p95Ms },
        });
        ALERT_DEDUP.set(`${key}:critical`, now);
      }
    } else {
      HISTORY.set(h.providerId, {}); // reset
    }
  }

  // 2. fallbackChain 平均长度
  const usage = await hooks.load24hUsage();
  if (usage.total >= MIN_CALLS && usage.avgFallbackLen > AVG_FALLBACK_THRESHOLD) {
    const k = "fallback:avg";
    if (now - (ALERT_DEDUP.get(k) ?? 0) > DEDUP_TTL_MS) {
      out.push({
        level: "warn",
        message: `24h 平均候选链长度 ${usage.avgFallbackLen.toFixed(2)}（最长 ${usage.maxFallbackLen}），超过 ${AVG_FALLBACK_THRESHOLD} 阈值`,
        meta: { ...usage },
      });
      ALERT_DEDUP.set(k, now);
    }
  }

  for (const a of out) hooks.emit(a);
  return out;
}
