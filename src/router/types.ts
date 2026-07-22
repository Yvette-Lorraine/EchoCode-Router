/**
 * 路由核心 — 公共类型。
 *
 * 不依赖任何后端 ORM（@prisma/client / mongoose / 等）。
 * 调用方自己把 DB 行 / ORM 模型映射成本文件中的接口。
 */

export type RoutingStrategy =
  | "DIRECT"
  | "PRICE"
  | "QUALITY"
  | "LATENCY"
  | "AVAILABILITY"
  | "REGION"
  | "CASCADE";

export type CascadeMode = "FAIL_FAST" | "SEQUENTIAL_FAILOVER";

/**
 * 路由层需要的上游"行"结构 — 调用方把数据库行映射为这个。
 */
export interface ProviderRow {
  id: string;
  region?: string; // e.g. "GLOBAL" | "CN-EAST" | "US-WEST"
}

export interface ModelRow {
  id: string;
  providerId: string;
  status: "ACTIVE" | "DEPRECATED" | "RETIRED" | string;
}

export interface RoutePolicyRow {
  id: string;
  alias: string;
  providerId: string;
  modelId: string;
  strategy: RoutingStrategy;
  cascadeMode: CascadeMode;
  maxAttempts: number;
  enabled: boolean;
  /** 灰度发布（0-100）。基于 hash(orgId + alias) % 100 < rolloutPercent 决定是否启用 */
  rolloutPercent: number;
  regionHint?: string | null;
}

export interface RouteCandidateRow {
  id: string;
  policyId: string;
  alias: string;
  providerId: string;
  modelId: string;
  weight: number;
  priority: number;
  enabled: boolean;
}

export interface ByokRow {
  id: string;
  orgId: string;
  providerId: string;
  weight: number;
  isHealthy: boolean;
  cooldownUntil: Date | null;
}

export interface HealthRow {
  providerId: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN" | string;
  successRate: number; // 0..1
  p95Ms: number;
  score: number; // 0..1
  consecutiveFailures: number;
}

export interface PriceBookRow {
  modelId: string;
  inputPer1MCents: number;
  outputPer1MCents: number;
}

export interface PoolKeyInfo {
  id: string;
  weight: number;
}

export interface RankedCandidate {
  providerId: string;
  modelId: string;
  /** 默认首选 byok（按 weight 加权随机抽取 1 个）。调用方一般从这里开始。 */
  byokId: string | null;
  /** 该候选下属的健康 BYOK 完整池（含被选取者）；故障切换与 Key 轮询使用。 */
  byokPool: PoolKeyInfo[];
  weight: number;
  priority: number;
  score: number; // 0-1 综合分
  factors: {
    latency: number;
    success: number;
    price: number;
    region: number;
    weight: number;
  };
  rawLatencyMs: number;
  rawSuccessRate: number;
  regionHint: string;
  tags: any;
  /** 候选是否被过滤器剔除（健康度/冷却） */
  blocked: boolean;
  blockReason?: string;
}

export interface RouteDecision {
  schemaVersion: number;
  requestedModel: string;
  alias: string | null;
  strategy: RoutingStrategy;
  cascadeMode: CascadeMode;
  maxAttempts: number;
  orgRegion: string | null;
  candidates: Array<{
    providerId: string;
    modelId: string;
    byokId: string | null;
    score: number;
    rank: number;
    latencyMs: number;
    successRate: number;
    region: string;
    blocked: boolean;
    blockReason?: string;
  }>;
  chosen: {
    providerId: string;
    modelId: string;
    byokId: string | null;
    score: number;
    rank: number;
    latencyMs: number;
    successRate: number;
    region: string;
  } | null;
  fallbackChain: string[];
  totalRouterMs: number;
  decisionReason: string;
}

export const ROUTE_DECISION_SCHEMA_VERSION = 1 as const;
