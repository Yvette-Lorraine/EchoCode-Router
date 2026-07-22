import type { RoutingStrategy } from "./types";

/**
 * 各 strategy 对应五个因子的权重：latency / success / price / region / weight。
 * DIRECT 在评分函数里特判（直接返回 priority 排序），其它按本表计算。
 */
export const STRATEGY_WEIGHTS: Record<
  RoutingStrategy,
  [latency: number, success: number, price: number, region: number, weight: number]
> = {
  DIRECT: [0, 0, 0, 0, 0], // 不参与评分
  LATENCY: [0.55, 0.2, 0.1, 0.1, 0.05],
  PRICE: [0.1, 0.1, 0.6, 0.1, 0.1],
  QUALITY: [0.2, 0.5, 0.1, 0.1, 0.1],
  AVAILABILITY: [0.05, 0.75, 0.05, 0.1, 0.05],
  REGION: [0.1, 0.1, 0.1, 0.65, 0.05],
  CASCADE: [0.2, 0.2, 0.2, 0.2, 0.2],
};
