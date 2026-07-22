/**
 * In-memory data + RouterStorage / DecisionStore / KeyStore / HealthStorage 实现
 * 给 examples/standalone-server.ts 用。
 *
 * 生产环境你会换成 Prisma / Drizzle / 内存缓存 / Mongo / 任意 DB。
 */

import type {
  ByokRow,
  HealthRow,
  ModelRow,
  PriceBookRow,
  ProviderRow,
  RouteCandidateRow,
  RoutePolicyRow,
  RouterStorage,
} from "echocode-router";

export interface DemoData {
  providers: ProviderRow[];
  models: ModelRow[];
  policies: RoutePolicyRow[];
  candidates: RouteCandidateRow[];
  byok: ByokRow[];
  health: HealthRow[];
  prices: PriceBookRow[];
}

/** Mock 数据 — 4 provider / 6 model / 2 alias / 4 candidate / 1 health record */
export const demoData: DemoData = {
  providers: [
    { id: "openai", region: "GLOBAL" },
    { id: "deepseek", region: "CN-EAST" },
    { id: "anthropic", region: "GLOBAL" },
    { id: "mock", region: "GLOBAL" },
  ],
  models: [
    { id: "gpt-4o", providerId: "openai", status: "ACTIVE" },
    { id: "gpt-4o-mini", providerId: "openai", status: "ACTIVE" },
    { id: "o4-mini", providerId: "openai", status: "ACTIVE" },
    { id: "deepseek-chat", providerId: "deepseek", status: "ACTIVE" },
    { id: "deepseek-reasoner", providerId: "deepseek", status: "ACTIVE" },
    { id: "claude-3-5-sonnet", providerId: "anthropic", status: "ACTIVE" },
  ],
  policies: [
    {
      id: "p-fast",
      alias: "fast",
      providerId: "openai",
      modelId: "gpt-4o-mini",
      strategy: "PRICE",
      cascadeMode: "SEQUENTIAL_FAILOVER",
      maxAttempts: 3,
      enabled: true,
      rolloutPercent: 100,
    },
    {
      id: "p-smart",
      alias: "smart",
      providerId: "openai",
      modelId: "gpt-4o",
      strategy: "QUALITY",
      cascadeMode: "SEQUENTIAL_FAILOVER",
      maxAttempts: 3,
      enabled: true,
      rolloutPercent: 100,
    },
  ],
  candidates: [
    { id: "c-1", policyId: "p-fast", alias: "fast", providerId: "openai", modelId: "gpt-4o-mini", weight: 1.5, priority: 10, enabled: true },
    { id: "c-2", policyId: "p-fast", alias: "fast", providerId: "deepseek", modelId: "deepseek-chat", weight: 1, priority: 20, enabled: true },
    { id: "c-3", policyId: "p-smart", alias: "smart", providerId: "openai", modelId: "gpt-4o", weight: 2, priority: 10, enabled: true },
    { id: "c-4", policyId: "p-smart", alias: "smart", providerId: "deepseek", modelId: "deepseek-chat", weight: 1, priority: 20, enabled: true },
  ],
  byok: [
    { id: "byok-1", orgId: "org-demo", providerId: "openai", weight: 1, isHealthy: true, cooldownUntil: null },
  ],
  health: [
    { providerId: "openai", status: "HEALTHY", successRate: 0.99, p95Ms: 320, score: 0.85, consecutiveFailures: 0 },
    { providerId: "deepseek", status: "HEALTHY", successRate: 0.98, p95Ms: 220, score: 0.92, consecutiveFailures: 0 },
    { providerId: "anthropic", status: "DEGRADED", successRate: 0.88, p95Ms: 480, score: 0.6, consecutiveFailures: 1 },
    { providerId: "mock", status: "HEALTHY", successRate: 1, p95Ms: 5, score: 1, consecutiveFailures: 0 },
  ],
  prices: [
    { modelId: "gpt-4o-mini", inputPer1MCents: 15, outputPer1MCents: 60 },
    { modelId: "gpt-4o", inputPer1MCents: 250, outputPer1MCents: 1000 },
    { modelId: "o4-mini", inputPer1MCents: 110, outputPer1MCents: 440 },
    { modelId: "deepseek-chat", inputPer1MCents: 14, outputPer1MCents: 28 },
    { modelId: "deepseek-reasoner", inputPer1MCents: 55, outputPer1MCents: 220 },
    { modelId: "claude-3-5-sonnet", inputPer1MCents: 300, outputPer1MCents: 1500 },
  ],
};

/** In-memory RouterStorage — 适合 demo / 单元测试 / 单进程 */
export function inMemoryStorage(data: DemoData) {
  const findPolicy = (alias: string) => data.policies.find((p) => p.alias === alias && p.enabled) ?? null;
  return {
    async loadPolicyByAlias(alias: string) {
      return findPolicy(alias);
    },
    async loadActiveModels() {
      return data.models.filter((m) => m.status === "ACTIVE");
    },
    async loadProviders() {
      return data.providers;
    },
    async loadCandidatesByPolicy(policyId: string) {
      return data.candidates
        .filter((c) => c.policyId === policyId && c.enabled)
        .sort((a, b) => a.priority - b.priority);
    },
    async loadByokPool(orgId: string) {
      return data.byok.filter((b) => b.orgId === orgId);
    },
    async loadLatestHealthByProvider() {
      // 每 provider 只取最新（demo 数据就是最新的）
      const seen = new Set<string>();
      return data.health.filter((h) => {
        if (seen.has(h.providerId)) return false;
        seen.add(h.providerId);
        return true;
      });
    },
    async loadPriceBook() {
      return data.prices;
    },
    async loadProviderById(providerId: string) {
      return data.providers.find((p) => p.id === providerId) ?? null;
    },
  } satisfies RouterStorage;
}
