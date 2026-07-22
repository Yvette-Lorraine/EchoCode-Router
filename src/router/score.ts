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

export function weightedTotal(strategy: RoutingStrategy, f: ScoreFactors): number {
  const [w1, w2, w3, w4, w5] = STRATEGY_WEIGHTS[strategy];
  return w1 * f.latency + w2 * f.success + w3 * f.price + w4 * f.region + w5 * f.weight;
}
