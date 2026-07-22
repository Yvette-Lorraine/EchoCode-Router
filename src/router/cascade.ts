/**
 * 路由级 cascade 编排：在 ranked 候选序列上按顺序试，遇到 transient/balance 错误就切下一候选。
 * - NON_TRANSIENT 错误（401/403/404/400/422 等）立即返回，不重试
 * - BALANCE 错误视为 transient + 切换（不同 Key / 不同供应商可能可用）
 * - 失败的尝试计入 fallbackChain
 */

import type { RankedCandidate } from "./types";
import { classifyUpstreamError, ErrorClass, shouldImmediateInvalidate } from "./errors";
import { pickOneWeighted } from "./key-pool";

export interface CascadeAttempt {
  rank: number;
  providerId: string;
  modelId: string;
  byokId: string | null;
  errorClass: ErrorClass | null;
  status?: number;
  bodyText?: string;
  durationMs: number;
  /** 成功的响应数据；调用方按 streaming / non-streaming 自行决定 */
  response?: unknown;
}

export interface CascadeResult {
  ok: boolean;
  attempts: CascadeAttempt[];
  /** 失败原因：分类 + 上游 status + body */
  finalError?: { errorClass: ErrorClass; status?: number; body?: string; message?: string };
  chosen: { providerId: string; modelId: string; byokId: string | null } | null;
}

/** 调用方提供的执行器：在某个 provider+byok 上做具体上游调用，捕获错误并返回 status/body */
export type AttemptExecutor = (providerId: string, modelId: string, byokId: string | null) => Promise<AttemptOutcome>;

export interface AttemptOutcome {
  ok: boolean;
  status?: number;
  bodyText?: string;
  error?: unknown;
  /** 成功时由调用方填充（流式 / 非流式） */
  data?: unknown;
}

/** Key 副作用回调 — cascade 不会自己操作 DB，由调用方注入 */
export interface CascadeKeyStore {
  markSuccess(byokId: string): Promise<void>;
  markFailure(byokId: string, status?: number): Promise<void>;
  markInvalid(byokId: string): Promise<void>;
}

export async function runCascade(
  ranked: RankedCandidate[],
  execute: AttemptExecutor,
  opts: {
    maxAttempts?: number;
    exclude?: (cand: RankedCandidate) => boolean;
    streamStarted?: () => boolean;
    keyStore?: CascadeKeyStore;
  } = {}
): Promise<CascadeResult> {
  const maxAttempts = opts.maxAttempts ?? Math.min(3, ranked.length * 3);
  const excludeOuter = opts.exclude ?? (() => false);
  const result: CascadeResult = {
    ok: false,
    attempts: [],
    chosen: null,
  };

  // 只对 unblocked 候选做尝试；blocked 整体跳过
  let attemptsLeft = maxAttempts;
  for (let i = 0; i < ranked.length && attemptsLeft > 0; i++) {
    const cand = ranked[i];
    if (cand.blocked || excludeOuter(cand)) continue;
    if (!cand.byokPool.length) {
      result.attempts.push({
        rank: i + 1,
        providerId: cand.providerId,
        modelId: cand.modelId,
        byokId: null,
        errorClass: ErrorClass.BALANCE, // 无凭据 → 当 transient 处理，让 cascade 顺位尝试下一候选
        durationMs: 0,
        bodyText: "no-byok-in-pool",
      });
      continue;
    }

    // 同 provider 的 byok 池逐个尝试
    const seen = new Set<string>();
    while (attemptsLeft > 0) {
      // 流已开始则不再切（同流内）
      if (opts.streamStarted && opts.streamStarted()) break;
      const picked = pickOneWeighted(
        cand.byokPool.map((k) => ({ id: k.id, weight: k.weight })),
        seen
      );
      if (!picked) break;
      seen.add(picked.id);
      attemptsLeft--;
      const t0 = Date.now();
      let outcome: AttemptOutcome;
      try {
        outcome = await execute(cand.providerId, cand.modelId, picked.id);
      } catch (e) {
        outcome = { ok: false, error: e };
      }
      const dur = Date.now() - t0;
      const cls = outcome.ok
        ? null
        : classifyUpstreamError({
            status: outcome.status,
            bodyText: outcome.bodyText,
            error: outcome.error,
          });

      if (outcome.ok) {
        if (opts.keyStore) await opts.keyStore.markSuccess(picked.id).catch(() => null);
        result.attempts.push({
          rank: i + 1,
          providerId: cand.providerId,
          modelId: cand.modelId,
          byokId: picked.id,
          errorClass: null,
          durationMs: dur,
          response: outcome.data,
        });
        result.ok = true;
        result.chosen = { providerId: cand.providerId, modelId: cand.modelId, byokId: picked.id };
        return result;
      }

      // 失败
      if (opts.keyStore) await opts.keyStore.markFailure(picked.id, outcome.status).catch(() => null);
      result.attempts.push({
        rank: i + 1,
        providerId: cand.providerId,
        modelId: cand.modelId,
        byokId: picked.id,
        errorClass: cls,
        status: outcome.status,
        bodyText: outcome.bodyText,
        durationMs: dur,
      });
      if (cls === ErrorClass.NON_TRANSIENT) {
        result.finalError = {
          errorClass: cls,
          status: outcome.status,
          body: outcome.bodyText,
          message: (outcome.error as Error)?.message,
        };
        return result;
      }
      // transient / balance → 试同 provider 下个 Key 或下一 provider
    }
  }

  result.finalError = result.attempts.length
    ? {
        errorClass: result.attempts[result.attempts.length - 1].errorClass || ErrorClass.TRANSIENT,
        status: result.attempts[result.attempts.length - 1].status,
        body: result.attempts[result.attempts.length - 1].bodyText,
      }
    : { errorClass: ErrorClass.TRANSIENT, message: "no-candidates" };
  return result;
}
