import { describe, it, expect } from "vitest";
import { computeScoreFactors, weightedTotal } from "../router/score";
import { STRATEGY_WEIGHTS } from "../router/strategies";
import { pickOneWeighted } from "../router/key-pool";
import { classifyUpstreamError, ErrorClass } from "../router/errors";
import { maskByokId } from "../router/decision";
import { hashBucket100 } from "../core/resolve";
import { getCachedRoute, setCachedRoute } from "../router/cache";
import { consume } from "../router/rate-limit";

describe("score", () => {
  it("maps raw inputs to 0..1", () => {
    const f = computeScoreFactors({ latencyMs: 100, successRate: 1, priceUsd: 0, regionMatch: true, weight: 1 });
    expect(f.latency).toBeCloseTo(1 - 100 / 5000, 3);
    expect(f.success).toBe(1);
    expect(f.price).toBeCloseTo(1, 3);
    expect(f.region).toBe(1);
    expect(f.weight).toBe(1);
  });
  it("clamps latency 0 when above baseline", () => {
    const f = computeScoreFactors({ latencyMs: 6000, successRate: 1, priceUsd: 0, regionMatch: true, weight: 1 });
    expect(f.latency).toBe(0);
  });
  it("region 0.35 when mismatch", () => {
    const f = computeScoreFactors({ latencyMs: 100, successRate: 1, priceUsd: 0, regionMatch: false, weight: 1 });
    expect(f.region).toBe(0.35);
  });
});

describe("strategies", () => {
  it("DIRECT returns 0 regardless of factors", () => {
    expect(weightedTotal("DIRECT", { latency: 1, success: 1, price: 1, region: 1, weight: 1 })).toBe(0);
  });
  it("LATENCY weights latency highest", () => {
    expect(STRATEGY_WEIGHTS.LATENCY[0]).toBeGreaterThan(STRATEGY_WEIGHTS.LATENCY[2]);
  });
  it("PRICE picks cheaper when latencies are equal", () => {
    const a = weightedTotal("PRICE", { latency: 1, success: 1, price: 1, region: 1, weight: 1 });
    const b = weightedTotal("PRICE", { latency: 1, success: 1, price: 0.2, region: 1, weight: 1 });
    expect(a).toBeGreaterThan(b);
  });
});

describe("key-pool", () => {
  it("returns null on empty", () => expect(pickOneWeighted([])).toBeNull());
  it("returns null when all excluded", () => {
    expect(pickOneWeighted([{ id: "a", weight: 1 }], new Set(["a"]))).toBeNull();
  });
  it("skips weight<=0", () => {
    const r = pickOneWeighted([
      { id: "a", weight: 0 },
      { id: "b", weight: 1 },
    ]);
    expect(r?.id).toBe("b");
  });
  it("distributes roughly proportional to weights", () => {
    const pool = [
      { id: "a", weight: 7 },
      { id: "b", weight: 3 },
    ];
    let a = 0, n = 2000;
    for (let i = 0; i < n; i++) {
      const r = pickOneWeighted(pool);
      if (r?.id === "a") a++;
    }
    const pA = a / n;
    expect(pA).toBeGreaterThan(0.65);
    expect(pA).toBeLessThan(0.75);
  });
});

describe("errors", () => {
  it("401/403 → TRANSIENT", () => {
    expect(classifyUpstreamError({ status: 401 })).toBe(ErrorClass.TRANSIENT);
    expect(classifyUpstreamError({ status: 403 })).toBe(ErrorClass.TRANSIENT);
  });
  it("404/400/422 → NON_TRANSIENT", () => {
    expect(classifyUpstreamError({ status: 404 })).toBe(ErrorClass.NON_TRANSIENT);
    expect(classifyUpstreamError({ status: 400 })).toBe(ErrorClass.NON_TRANSIENT);
    expect(classifyUpstreamError({ status: 422 })).toBe(ErrorClass.NON_TRANSIENT);
  });
  it("402 → BALANCE", () => {
    expect(classifyUpstreamError({ status: 402 })).toBe(ErrorClass.BALANCE);
  });
  it("5xx/429/503/408/1xx → TRANSIENT", () => {
    for (const s of [500, 502, 503, 429, 408, 100]) {
      expect(classifyUpstreamError({ status: s })).toBe(ErrorClass.TRANSIENT);
    }
  });
  it("bodyText fallback", () => {
    expect(classifyUpstreamError({ bodyText: "Connection ECONNRESET" })).toBe(ErrorClass.TRANSIENT);
    expect(classifyUpstreamError({ bodyText: "insufficient quota" })).toBe(ErrorClass.BALANCE);
    expect(classifyUpstreamError({ bodyText: "model not found" })).toBe(ErrorClass.NON_TRANSIENT);
  });
  it("defaults to TRANSIENT for unknown", () => {
    expect(classifyUpstreamError({})).toBe(ErrorClass.TRANSIENT);
  });
});

describe("decision masking", () => {
  it("masks byokId", () => {
    expect(maskByokId("byok-abcdef0001")).toBe("byok…0001");
    expect(maskByokId("byok")).toBe("byok");
  });
});

describe("cache", () => {
  it("sets and gets within TTL", () => {
    setCachedRoute("o", "m", {}, { v: 1 });
    expect(getCachedRoute("o", "m", {})).toEqual({ v: 1 });
  });
  it("returns null after TTL", async () => {
    setCachedRoute("o2", "m", {}, { v: 2 });
    await new Promise((r) => setTimeout(r, 80));
    expect(getCachedRoute("o2", "m", {})).toBeNull();
  });
});

describe("rate-limit", () => {
  it("rejects after limit consumed", () => {
    const orgId = "org-" + Math.random();
    expect(consume(orgId, { limitPerMin: 2 }).allowed).toBe(true);
    expect(consume(orgId, { limitPerMin: 2 }).allowed).toBe(true);
    expect(consume(orgId, { limitPerMin: 2 }).allowed).toBe(false);
  });
  it("buckets isolated per orgId", () => {
    const a = "a-" + Math.random();
    const b = "b-" + Math.random();
    consume(a, { limitPerMin: 1 });
    expect(consume(b, { limitPerMin: 1 }).allowed).toBe(true);
  });
});

describe("resolve: hash bucket", () => {
  it("is deterministic per (orgId, alias)", () => {
    expect(hashBucket100("org-1:fast")).toBe(hashBucket100("org-1:fast"));
    expect(hashBucket100("org-1:fast")).not.toBe(hashBucket100("org-2:fast"));
  });
  it("stays in 0..99", () => {
    for (let i = 0; i < 100; i++) {
      const v = hashBucket100("o" + i + ":a");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(99);
    }
  });
});
