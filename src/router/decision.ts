/**
 * RouteDecision 序列化 + 写入。
 *
 * 这是纯函数 + 一个 storage 回调（写入由调用方实现）。
 * 字段：仅元数据（model id / provider id / score / reason / fallbacks）。
 * 严格不写入：上游响应 body、API Key 明文。
 */

import type { RouteDecision } from "./types";
import { ROUTE_DECISION_SCHEMA_VERSION } from "./types";

export interface DecisionStore {
  /** 写 UsageEvent.routeDecision（attach 到 requestId 关联的 event 上） */
  writeRouteDecision(eventId: string, json: unknown): Promise<void>;
}

export function serializeRouteDecision(d: RouteDecision): any {
  return {
    schemaVersion: ROUTE_DECISION_SCHEMA_VERSION,
    requestedModel: d.requestedModel,
    alias: d.alias,
    strategy: d.strategy,
    cascadeMode: d.cascadeMode,
    maxAttempts: d.maxAttempts,
    orgRegion: d.orgRegion,
    candidates: d.candidates.map((c) => ({
      providerId: c.providerId,
      modelId: c.modelId,
      byokId: c.byokId ? maskByokId(c.byokId) : null,
      score: round4(c.score),
      rank: c.rank,
      latencyMs: c.latencyMs,
      successRate: round4(c.successRate),
      region: c.region,
      blocked: c.blocked,
      blockReason: c.blockReason,
    })),
    chosen: d.chosen
      ? {
          providerId: d.chosen.providerId,
          modelId: d.chosen.modelId,
          byokId: d.chosen.byokId ? maskByokId(d.chosen.byokId) : null,
          score: round4(d.chosen.score),
          rank: d.chosen.rank,
          latencyMs: d.chosen.latencyMs,
          successRate: round4(d.chosen.successRate),
          region: d.chosen.region,
        }
      : null,
    fallbackChain: d.fallbackChain,
    totalRouterMs: d.totalRouterMs,
    decisionReason: d.decisionReason,
  };
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

/** byokId 永远脱敏。返回 4…4 形式 */
export function maskByokId(id: string): string {
  if (id.length <= 8) return id;
  return id.slice(0, 4) + "…" + id.slice(-4);
}

export async function attachRouteDecision(
  store: DecisionStore,
  eventId: string,
  decision: RouteDecision
): Promise<void> {
  await store.writeRouteDecision(eventId, serializeRouteDecision(decision));
}
