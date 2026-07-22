/**
 * 路由层缓存：
 * - resolveRoute 50ms 内同 (orgId, modelId, ctxHash) 复用结果
 * - ProviderHealth 5s 内同 provider 复用，绕过请求路径 DB 抖动
 *
 * 用 Map 模拟 LRU（简单场景足够；规模上来可换成 lru-cache）。
 */

const routeCache = new Map<string, { at: number; value: any }>();
const ROUTE_TTL_MS = 50;

const healthCache = new Map<string, { at: number; value: any }>();
const HEALTH_TTL_MS = 5_000;

let hits = 0;
let misses = 0;
let healthHits = 0;
let healthMisses = 0;

function routeKey(orgId: string, modelId: string, ctx: { ip?: string; orgRegion?: string | null }) {
  return `${orgId}|${modelId}|${ctx.orgRegion ?? ""}|${ctx.ip ?? ""}`;
}

export function getCachedRoute<T>(orgId: string, modelId: string, ctx: { ip?: string; orgRegion?: string | null }): T | null {
  const key = routeKey(orgId, modelId, ctx);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_TTL_MS) {
    hits++;
    return hit.value as T;
  }
  misses++;
  return null;
}

export function setCachedRoute<T>(orgId: string, modelId: string, ctx: { ip?: string; orgRegion?: string | null }, value: T): void {
  routeCache.set(routeKey(orgId, modelId, ctx), { at: Date.now(), value });
  // 简单 LRU：超过 1k 条目清理一半
  if (routeCache.size > 1024) {
    const half = Array.from(routeCache.keys()).slice(0, 512);
    for (const k of half) routeCache.delete(k);
  }
}

export function getCachedHealth<T>(providerId: string): T | null {
  const hit = healthCache.get(providerId);
  if (hit && Date.now() - hit.at < HEALTH_TTL_MS) {
    healthHits++;
    return hit.value as T;
  }
  healthMisses++;
  return null;
}

export function setCachedHealth<T>(providerId: string, value: T): void {
  healthCache.set(providerId, { at: Date.now(), value });
}

export function invalidateHealth(providerId: string) {
  healthCache.delete(providerId);
}

export function routerCacheStats() {
  return { routeHits: hits, routeMisses: misses, healthHits, healthMisses };
}
