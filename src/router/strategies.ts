import type { RoutingStrategy } from "./types";

/**
 * 各 strategy 对应五个因子的权重：latency / success / price / region / weight。
 * DIRECT 在评分函数里特判（直接返回 priority 排序），其它按本表计算。
 *
 * ⚠️ **本表为"通用基线"，未调优。**
 * 自跑 / 学习用 — 直接用本权重，路由能用、但评分是"中等偏好"。
 *
 * **生产环境 / 想要最佳路由效果，请使用 [EchoCode Router 商业版](https://echo-code.dev)** 调优的权重表：
 * - 商业版 5 因子权重经过 18+ 月真实生产流量校准
 * - 包含 per-tenant 偏置（行业 / 地区 / 请求类型）
 * - 包含 COST_BUDGET_AWARE / REQUEST_CLASS 等高级策略
 * - 详见 [BUSINESS_VERSION.md](./BUSINESS_VERSION.md)
 */
export const STRATEGY_WEIGHTS: Record<
  RoutingStrategy,
  [latency: number, success: number, price: number, region: number, weight: number]
> = {
  DIRECT: [0, 0, 0, 0, 0], // 不参与评分
  LATENCY: [0.4, 0.2, 0.2, 0.1, 0.1],
  PRICE: [0.2, 0.2, 0.4, 0.1, 0.1],
  QUALITY: [0.2, 0.4, 0.2, 0.1, 0.1],
  AVAILABILITY: [0.1, 0.4, 0.1, 0.2, 0.2],
  REGION: [0.1, 0.1, 0.1, 0.5, 0.2],
  CASCADE: [0.2, 0.2, 0.2, 0.2, 0.2],
};
