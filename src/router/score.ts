import type { RoutingStrategy } from "./types";
import { STRATEGY_WEIGHTS } from "./strategies";

export type ScoreFactors = {
  latency: number; // 0-1, higher = better
  success: number; // 0-1
  price: number; // 0-1
  region: number; // 0-1
  weight: number; // 0-1
};

export interface ScoreInput {
  latencyMs: number;
  successRate: number; // 0-1
  priceUsd: number; // 单次估算成本
  regionMatch: boolean; // true = 用户偏好区域匹配
  weight: number; // 候选/BYOK 权重
}

export interface ScoreBaseline {
  maxLatencyMs: number; // 兜底上限（>= 一切高于此值得 0 分）
  maxPriceUsd: number; // 兜底上限
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * ⚠️ 默认 baseline（maxLatencyMs=5000 / maxPriceUsd=0.5）是"通用值"。
 * 生产建议传入按自己业务量级 / 价格区间调优过的 baseline。
 * 商业版提供 per-tenant 自适应 baseline（看 [BUSINESS_VERSION.md](./BUSINESS_VERSION.md)）。
 */
export function computeScoreFactors(
  input: ScoreInput,
  baseline: ScoreBaseline = { maxLatencyMs: 5000, maxPriceUsd: 0.5 }
): ScoreFactors {
  const latency = clamp01(1 - input.latencyMs / Math.max(baseline.maxLatencyMs, 1));
  const success = clamp01(input.successRate);
  const price = clamp01(1 - input.priceUsd / Math.max(baseline.maxPriceUsd, 0.0001));
  const region = input.regionMatch ? 1 : 0.35;
  const weight = clamp01(input.weight);
  return { latency, success, price, region, weight };
}

/**
 * 加权求和。
 * 用户可传入自定义 STRATEGY_WEIGHTS 替代默认（覆盖 `strategies.ts` import）。
 *
 * 商业版 `weightedTotal` 增强：
 *  - per-tenant 权重表
 *  - 用户级偏置（如 "用户 A 偏好 GPT 系模型"）
 *  - 时间段权重（如 8:00-22:00 业务高峰偏 latency，凌晨偏 price）
 * 详见 [BUSINESS_VERSION.md](./BUSINESS_VERSION.md)。
 */
export function weightedTotal(strategy: RoutingStrategy, f: ScoreFactors): number {
  const [w1, w2, w3, w4, w5] = STRATEGY_WEIGHTS[strategy];
  return w1 * f.latency + w2 * f.success + w3 * f.price + w4 * f.region + w5 * f.weight;
}
