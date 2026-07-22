/**
 * resolveRoute — 路由核心入口（纯算法）。
 *
 * 调用方负责：
 *  1. 准备好 RouterData（候选 / 健康 / 价格 / BYOK 池），用 RouterStorage 接口实现
 *  2. 调 resolveRoute(orgId, modelId, ctx, storage)
 *  3. 拿 ranked + decision → 通过 cascade.ts 做实际调用
 *
 * 这样 router-core 0 业务依赖。Prisma / Mongo / 内存 都能用。
 */
import crypto from "node:crypto";
import type {
  RankedCandidate,
  RouteDecision,
  RoutePolicyRow,
  RouteCandidateRow,
  ByokRow,
  HealthRow,
  ModelRow,
  PriceBookRow,
  ProviderRow,
  RoutingStrategy,
  CascadeMode,
  PoolKeyInfo,
} from "../router/types";
import { ROUTE_DECISION_SCHEMA_VERSION } from "../router/types";
import { computeScoreFactors, weightedTotal } from "../router/score";
import { pickOneWeighted as pickPoolWeighted } from "../router/key-pool";
import { getCachedRoute, setCachedRoute } from "../router/cache";
import type { ProviderAdapter } from "../providers/types";

/** 兼容的旧 API：仅返回 picked 候选（不写库）。RouterStorage 场景请直接用 resolveRoute() */
export interface ResolvedModel {
  adapter: ProviderAdapter;
  providerId: string;
  providerName: string;
  modelId: string;
  region: string;
  byokId?: string;
}

/** 把字符串映射到稳定 0-99 的整数 bucket（用于灰度 rolloutPercent） */
export function hashBucket100(s: string): number {
  const h = crypto.createHash("sha256").update(s, "utf8").digest();
  return h[0] % 100;
}

export interface ResolveRouteCtx {
  ip?: string;
  /** 用户工作区偏好区域 */
  orgRegion?: string | null;
  /** dev: 允许 mock fallback */
  allowMockFallback?: boolean;
}

/**
 * 路由数据来源 — 用户实现。
 * 一次 resolve 调用前取数。生产实现可以是 Prisma / Drizzle / 内存缓存。
 */
export interface RouterStorage {
  /** 查 alias = requestedModel 的所有启用 RoutePolicy */
  loadPolicyByAlias(alias: string): Promise<RoutePolicyRow | null>;
  /** 查所有 ACTIVE Model — 用于直接 model.id 匹配 */
  loadActiveModels(): Promise<ModelRow[]>;
  /** 查所有 Provider 基础信息 */
  loadProviders(): Promise<ProviderRow[]>;
  /** 查 orgId 下该 policyId 的所有启用 RouteCandidate（按 priority 升序） */
  loadCandidatesByPolicy(policyId: string): Promise<RouteCandidateRow[]>;
  /** 查 orgId 下所有 active 健康 BYOK（isHealthy=true, cooldownUntil 已过期） */
  loadByokPool(orgId: string): Promise<ByokRow[]>;
  /** 查每家 provider 最新一条 Health */
  loadLatestHealthByProvider(): Promise<HealthRow[]>;
  /** 查每 model 当前 PriceBook */
  loadPriceBook(): Promise<PriceBookRow[]>;
  /** 仅 dev 用的 mock provider */
  loadProviderById(providerId: string): Promise<ProviderRow | null>;
}

const DEFAULT_BASELINE = { maxLatencyMs: 5000, maxPriceUsd: 0.5 };

export async function resolveRoute(
  orgId: string,
  requestedModel: string,
  ctx: ResolveRouteCtx,
  storage: RouterStorage
): Promise<{ ranked: RankedCandidate[]; decision: RouteDecision }> {
  // 3.5：50ms 路由缓存
  const cached = getCachedRoute<{ ranked: RankedCandidate[]; decision: RouteDecision }>(
    orgId,
    requestedModel,
    ctx
  );
  if (cached) return cached;

  const t0 = Date.now();
  const decision: RouteDecision = {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSION,
    requestedModel,
    alias: null,
    strategy: "DIRECT",
    cascadeMode: "SEQUENTIAL_FAILOVER",
    maxAttempts: 3,
    orgRegion: ctx.orgRegion ?? null,
    candidates: [],
    chosen: null,
    fallbackChain: [],
    totalRouterMs: 0,
    decisionReason: "",
  };

  // 1) alias 命中
  let policy = await storage.loadPolicyByAlias(requestedModel);

  // 1b) 灰度发布：rolloutPercent < 100 时按 hash(orgId+alias) bucket 决定
  if (policy && (policy.rolloutPercent ?? 100) < 100) {
    const bucket = hashBucket100(orgId + ":" + policy.alias);
    if (bucket >= (policy.rolloutPercent ?? 100)) {
      policy = null;
      decision.decisionReason = "rollout-bucket-miss";
    }
  }

  let strategy: RoutingStrategy = "DIRECT";
  let cascadeMode: CascadeMode = "SEQUENTIAL_FAILOVER";
  let maxAttempts = 3;
  let candidatesInput: RouteCandidateRow[] = [];

  if (policy) {
    decision.alias = policy.alias;
    decision.strategy = policy.strategy;
    decision.cascadeMode = policy.cascadeMode;
    decision.maxAttempts = policy.maxAttempts;
    strategy = policy.strategy;
    cascadeMode = policy.cascadeMode;
    maxAttempts = policy.maxAttempts;
    candidatesInput = await storage.loadCandidatesByPolicy(policy.id);
  } else if (decision.decisionReason !== "rollout-bucket-miss") {
    // 2) Model 直连
    const [activeModels, providers, prices] = await Promise.all([
      storage.loadActiveModels(),
      storage.loadProviders(),
      storage.loadPriceBook(),
    ]);
    const m = activeModels.find((x) => x.id === requestedModel);
    if (m) {
      candidatesInput = [
        // 隐式 1 个候选
        {
          id: "implicit",
          policyId: "",
          alias: m.id,
          providerId: m.providerId,
          modelId: m.id,
          weight: 1,
          priority: 100,
          enabled: true,
        },
      ];
    } else if (ctx.allowMockFallback) {
      const mock = await storage.loadProviderById("mock");
      if (mock) {
        candidatesInput = [
          {
            id: "implicit-mock",
            policyId: "",
            alias: requestedModel,
            providerId: "mock",
            modelId: requestedModel,
            weight: 1,
            priority: 100,
            enabled: true,
          },
        ];
        decision.decisionReason = "mock-fallback";
      }
    }
  }

  void cascadeMode;
  void maxAttempts;

  if (candidatesInput.length === 0) {
    throw new Error(`UNKNOWN_MODEL:${requestedModel}`);
  }

  // 3) 数据准备
  const [byokList, healthList, prices, providers] = await Promise.all([
    storage.loadByokPool(orgId),
    storage.loadLatestHealthByProvider(),
    storage.loadPriceBook(),
    storage.loadProviders(),
  ]);
  const byokByProvider = new Map<string, ByokRow[]>();
  for (const b of byokList) {
    const arr = byokByProvider.get(b.providerId) ?? [];
    arr.push(b);
    byokByProvider.set(b.providerId, arr);
  }
  const healthByProvider = new Map<string, HealthRow>();
  for (const h of healthList) healthByProvider.set(h.providerId, h);
  const priceByModel = new Map<string, PriceBookRow>();
  for (const p of prices) priceByModel.set(p.modelId, p);
  const providerById = new Map<string, ProviderRow>();
  for (const p of providers) providerById.set(p.id, p);

  // 4) 计算每个候选的 score + blocked
  const ranked: RankedCandidate[] = candidatesInput.map((c) => {
    const allByok = byokByProvider.get(c.providerId) ?? [];
    const usableByok = allByok.filter(
      (b) => b.isHealthy && (!b.cooldownUntil || b.cooldownUntil.getTime() <= Date.now())
    );
    const byokAvailable = usableByok.length > 0;
    const blocked = healthByProvider.get(c.providerId)?.status === "DOWN" || !byokAvailable;
    const blockReason = !byokAvailable
      ? "no-byok"
      : healthByProvider.get(c.providerId)?.status === "DOWN"
      ? "provider-down"
      : undefined;
    const degraded = healthByProvider.get(c.providerId)?.status === "DEGRADED";
    const regionMatch =
      !!ctx.orgRegion &&
      (providerById.get(c.providerId)?.region === ctx.orgRegion ||
        providerById.get(c.providerId)?.region === "GLOBAL" ||
        ctx.orgRegion === "GLOBAL");
    const price = priceByModel.get(c.modelId);
    const priceUsd = price ? (price.inputPer1MCents + price.outputPer1MCents) / 100 / 1000 : 0.01;
    const factors = computeScoreFactors(
      {
        latencyMs: healthByProvider.get(c.providerId)?.p95Ms ?? 1000,
        successRate: healthByProvider.get(c.providerId)?.successRate ?? 1,
        priceUsd,
        regionMatch,
        weight: usableByok[0]?.weight ?? 1,
      },
      DEFAULT_BASELINE
    );
    const score = weightedTotal(strategy, factors) * (degraded ? 0.5 : 1);
    const defaultKey = pickPoolWeighted(
      usableByok.map((b) => ({ id: b.id, weight: b.weight }))
    );
    return {
      providerId: c.providerId,
      modelId: c.modelId,
      byokId: defaultKey?.id ?? null,
      byokPool: usableByok.map((b) => ({ id: b.id, weight: b.weight })) as PoolKeyInfo[],
      weight: defaultKey?.weight ?? 1,
      priority: 0,
      score,
      factors,
      rawLatencyMs: healthByProvider.get(c.providerId)?.p95Ms ?? 1000,
      rawSuccessRate: healthByProvider.get(c.providerId)?.successRate ?? 1,
      regionHint: providerById.get(c.providerId)?.region ?? "GLOBAL",
      tags: null,
      blocked,
      blockReason,
    } satisfies RankedCandidate;
  });

  // 5) 排序
  ranked.sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => (r.priority = i));

  // 6) decision snapshot
  decision.candidates = ranked.map((r, i) => ({
    providerId: r.providerId,
    modelId: r.modelId,
    byokId: r.byokId,
    score: r.score,
    rank: i + 1,
    latencyMs: r.rawLatencyMs,
    successRate: r.rawSuccessRate,
    region: r.regionHint,
    blocked: r.blocked,
    blockReason: r.blockReason,
  }));
  decision.chosen = ranked.length
    ? {
        providerId: ranked[0].providerId,
        modelId: ranked[0].modelId,
        byokId: ranked[0].byokId,
        score: ranked[0].score,
        rank: 1,
        latencyMs: ranked[0].rawLatencyMs,
        successRate: ranked[0].rawSuccessRate,
        region: ranked[0].regionHint,
      }
    : null;
  decision.decisionReason = decision.decisionReason || (ranked[0]?.blocked ? "best-of-healthy" : "best-score");
  decision.totalRouterMs = Date.now() - t0;

  const out = { ranked, decision };
  setCachedRoute(orgId, requestedModel, ctx, out);
  return out;
}
