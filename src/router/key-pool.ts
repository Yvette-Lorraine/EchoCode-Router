/**
 * Key 池化与熔断 — 纯算法 + storage 抽象。
 *
 * - pickOneWeighted: 在一组健康的 BYOK 里按 weight 加权随机选一个
 * - markSuccess: 重置 failureCount / cooldown
 * - markFailure: failureCount++，超过阈值（5 次/5 分钟）则 cooldownUntil = +5m
 * - markInvalid: 401/403 时调用；isHealthy = false，立即不健康
 * - clearCooldown: 24 小时后自动清除 cooldown（failureCount = 0 不变 / cooldown null）
 */
import { shouldImmediateInvalidate } from "./errors";

export interface PoolKey {
  id: string;
  weight: number;
}

export interface KeyStore {
  /** 失败次数 +1（transient）；超过阈值时设 cooldownUntil */
  markFailure(byokId: string, status?: number): Promise<void>;
  /** 重置 failureCount / cooldown；成功调用时使用 */
  markSuccess(byokId: string): Promise<void>;
  /** 401/403 立即标记 isHealthy=false（不再返回成功） */
  markInvalid(byokId: string): Promise<void>;
}

export function pickOneWeighted(
  pool: PoolKey[],
  exclude: Set<string> = new Set()
): PoolKey | null {
  const filtered = pool
    .filter((k) => !exclude.has(k.id))
    .filter((k) => k.weight > 0);
  if (filtered.length === 0) return null;
  const total = filtered.reduce((s, k) => s + k.weight, 0);
  let r = Math.random() * total;
  for (const k of filtered) {
    r -= k.weight;
    if (r <= 0) return k;
  }
  return filtered[filtered.length - 1];
}

export async function markByokSuccess(store: KeyStore, byokId: string) {
  await store.markSuccess(byokId);
}

export async function markByokFailure(
  store: KeyStore,
  byokId: string,
  status?: number
) {
  if (shouldImmediateInvalidate(status)) {
    await store.markInvalid(byokId);
    return { invalidated: true };
  }
  // transient: store 决定是否 cooldown
  await store.markFailure(byokId, status);
  return { invalidated: false };
}

export async function reEnableByok(store: KeyStore, byokId: string) {
  await store.markSuccess(byokId);
  await store.markInvalid(byokId); // 让调用方根据 isHealthy 当前值决定
}
