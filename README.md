# EchoCode Router

> Smart AI gateway router — cascading failover, weighted key pool, gradual rollout.
> 0 backend dependencies. Drop into Next.js, Express, Hono, Fastify, Bun, Deno.

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)]()

## What is this?

**EchoCode Router** is the routing core of [Echo Code](https://echo-code.dev) —
an AI API gateway for model resellers and aggregators. It decides:

> _For this incoming `/v1/chat/completions` request, which upstream model / provider / BYOK
> should I use, and what should I do if it fails?_

**Highlights:**

- **Cascading failover** — `transient` / `balance` errors → next candidate; `non-transient` → stop.
- **Weighted key pool** — same provider, multiple BYOKs, weighted random rotation.
- **401 immediate invalidation** — bad credentials? Mark key dead, skip on next call.
- **5-of-5min cooldown** — per-key failure budget, automatic recovery.
- **Gradual rollout** — `rolloutPercent` + `hash(orgId+alias) % 100`.
- **Health probes** — every 60s; consecutive-failure threshold; health score.
- **5-factor scoring** — `latency × success × price × region × weight` per strategy.
- **Per-org rate limit** — in-memory token bucket.
- **Audit + explain** — every decision JSON-serialized; `routeDecision.totalRouterMs`.
- **Zero coupling** — you implement 4 storage interfaces (Prisma, Drizzle, Mongo, in-memory, anything).

## Why?

Most AI gateway routers are either:

- **Catalogs** (OpenRouter) — one API key, many models, but no real "decide for me".
- **LLM-as-router** (NotDiamond, Martian) — train a small model to classify requests; adds 100–500ms latency, low explainability.
- **Recommendation** (HF Inference Endpoints) — suggest, not dispatch.

EchoCode Router is **rule-based + cascading**, designed for **BYOK scenarios** (users bring their own OpenAI/DeepSeek/Anthropic keys) where:

- Explainability matters more than marginal accuracy
- Latency is non-negotiable (P95 target: <30ms)
- Multiple keys per provider are normal (rate-limit workarounds)
- Vendor-side decisions should be visible & reversible (Admin UI)

**This package is the rule + cascade engine.** The marketing site, billing, and admin UI live separately at
[echo-code.dev](https://echo-code.dev) (commercial SaaS). This package is the open-source routing core.

## Install

```bash
npm install echocode-router
# or
pnpm add echocode-router
```

**Requirements:** Node.js ≥ 20.

## Usage

```ts
import {
  resolveRoute,
  runCascade,
  getAdapter,
  type RouterStorage,
} from "echocode-router";

// 1. Implement RouterStorage（how you load providers / policies / byok / health）
const storage: RouterStorage = {
  async loadPolicyByAlias(alias) { /* your DB */ },
  async loadActiveModels() { /* your DB */ },
  async loadProviders() { /* your DB */ },
  async loadCandidatesByPolicy(policyId) { /* your DB */ },
  async loadByokPool(orgId) { /* your DB */ },
  async loadLatestHealthByProvider() { /* your DB */ },
  async loadPriceBook() { /* your DB */ },
  async loadProviderById(providerId) { /* your DB */ },
};

// 2. Score + rank candidates
const { ranked, decision } = await resolveRoute(
  "org_abc",                  // tenant id
  "fast",                      // model name or alias
  { allowMockFallback: true },
  storage
);

// 3. Run cascade (try ranked, fall through on transient/balance errors)
const cascade = await runCascade(ranked, async (providerId, modelId, byokId) => {
  const adapter = getAdapter(providerId); // openai-compatible HTTP client
  try {
    const out = await adapter.completeChat({ model: modelId, messages: [...] }, {
      apiKey: "<decrypted-byok>",
      orgId: "org_abc",
      keyId: byokId,
    });
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, status: e.status, bodyText: e.message, error: e };
  }
});

if (!cascade.ok) {
  // all candidates failed; cascade.attempts has the full attempt chain
  return new Response(JSON.stringify({ error: "ALL_ATTEMPTS_FAILED" }), { status: 502 });
}
return new Response(JSON.stringify(cascade.attempts.at(-1).response));
```

That's the entire integration. The router does:

- Resolve alias → policy → candidates
- Score each candidate by `latency / success / price / region / weight`
- Sort by score, fall through cascading
- Pick a BYOK from the candidate's pool (weighted random)
- On `transient` (`5xx`, `429`, timeout) or `balance` (402) → next candidate
- On `non-transient` (`4xx` other than 402/429) → stop
- Mark failed keys for cooldown, mark `401` keys dead immediately
- Persist `routeDecision` to your storage (your `DecisionStore`)
- Emit a health snapshot via `probeOne()` every 60s

## Architecture

```
User request (POST /v1/chat/completions)
    │
    ├─ Auth + rate limit
    │
    ├─ resolveRoute(orgId, model, ctx, storage)        ← this package
    │     1. loadPolicyByAlias / loadActiveModels
    │     2. resolve rolloutPercent hash bucket
    │     3. score candidates (5 factors × 7 strategies)
    │     4. filter (DOWN provider / no BYOK → blocked)
    │     5. sort by score, snapshot as decision
    │     6. cache 50ms
    │
    ├─ runCascade(ranked, executor)                     ← this package
    │     for each candidate:
    │       for each byok in pool (weighted random):
    │         try executor()
    │         ├─ transient/balance → mark cooldown, next byok
    │         ├─ non-transient → stop
    │         └─ ok → return
    │
    └─ Persist decision + usage event
```

**Decision snapshot** (returned in every call):

```json
{
  "schemaVersion": 1,
  "requestedModel": "fast",
  "alias": "fast",
  "strategy": "PRICE",
  "cascadeMode": "SEQUENTIAL_FAILOVER",
  "maxAttempts": 3,
  "candidates": [
    { "rank": 1, "providerId": "openai",   "score": 0.82, "byokIdMasked": "byok…0001" },
    { "rank": 2, "providerId": "deepseek", "score": 0.78, "byokIdMasked": null }
  ],
  "chosen":   { "providerId": "openai", "score": 0.82, "byokIdMasked": "byok…0001" },
  "fallbackChain": [],
  "totalRouterMs": 4,
  "decisionReason": "best-score"
}
```

Every call writes a `routeDecision` JSON row. Every fail writes a `fallbackChain` entry.
Admins query via the `Explain` API or `AuditLog` table. None of this is the gateway layer's problem.

## What's NOT in this package

Out of scope on purpose — these belong to the **commercial product** at
[echo-code.dev](https://echo-code.dev):

- Marketing site / pricing pages
- Web console (per-tenant dashboard)
- Admin UI for editing routes / BYOK pools
- Payment / invoicing / Stripe / 微信 / 支付宝
- MFA / SSO / RBAC enforcement at the auth layer
- WAF / DDoS / Bot mitigation
- ICP / SOC 2 / ISO 27001 compliance docs

In other words: this package is the **routing brain**. The product is the **body**.

## How it differs from competitors

| | EchoCode Router | OpenRouter | NotDiamond | Martian |
|---|---|---|---|---|
| Decision model | rule + score | rule only | LLM-as-router | LLM-as-router |
| Routing latency | ~5ms | n/a | 100–500ms | 100–500ms |
| Explainability | full `routeDecision` per call | catalog metadata | black box | black box |
| Cascading failover | ✅ yes | ❌ | partial | partial |
| BYOK weighted pool | ✅ yes | n/a (they host) | n/a | n/a |
| Gradual rollout | ✅ `rolloutPercent` hash | ❌ | ❌ | ❌ |
| Auto health probe | ✅ every 60s | ❌ | ❌ | partial |
| Self-hostable | ✅ 0 backend deps | ❌ closed | ❌ | ❌ |
| License | MIT | proprietary | proprietary | proprietary |

The technical differentiator is **cascading with BYOK pool + explainability**. If you need "route this query to the best model based on what it says", look at LLM-as-router. If you need "dispatch this user's request across their own keys with policy + observability", this is for you.

## Examples

`examples/standalone-server.ts` — a 100-line Node HTTP server using the router.
Run:

```bash
pnpm i
pnpm example
# in another terminal:
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast","messages":[{"role":"user","content":"hi"}]}'
```

## Storage interfaces (you implement these)

```ts
export interface RouterStorage {
  loadPolicyByAlias(alias: string): Promise<RoutePolicyRow | null>;
  loadActiveModels(): Promise<ModelRow[]>;
  loadProviders(): Promise<ProviderRow[]>;
  loadCandidatesByPolicy(policyId: string): Promise<RouteCandidateRow[]>;
  loadByokPool(orgId: string): Promise<ByokRow[]>;
  loadLatestHealthByProvider(): Promise<HealthRow[]>;
  loadPriceBook(): Promise<PriceBookRow[]>;
  loadProviderById(providerId: string): Promise<ProviderRow | null>;
}
```

Plus 3 smaller interfaces: `KeyStore` (markSuccess/Failure/Invalidate), `DecisionStore`
(writeRouteDecision), `HealthStorage` (loadActiveProviders/loadLatestHealth/loadRecentHealth/saveHealth).

Implement with whatever you have. Examples for Prisma, Drizzle, and in-memory live in [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md).

## Configuration

| Env | Default | Description |
|---|---|---|
| `ECHO_PROBE_INTERVAL_MS` | `60000` | Health probe interval |
| `ECHO_PROBE_TIMEOUT_MS` | `3000` | Per-probe HTTP timeout |
| `ECHO_PROBE_KEY_{PROVIDER}` | – | Optional probe API key (overrides BYOK) |
| `ECHO_RATE_LIMIT_PER_MIN` | `600` | Per-tenant rate limit |
| `ECHO_ADMIN_BYPASS_MFA` | `0` | Dev bypass for admin auth |

## Performance

- Routing decision: **4–9ms p95** (no LLM in the loop)
- Cascade with N candidates: `O(N × M)` where M = byok pool size
- Memory: `<10MB` for routing layer
- Health probe: `60s` interval, 3s per provider timeout, parallel

## License

[MIT](./LICENSE) © 2026 Echo Code

## Related

- **Echo Code** (commercial SaaS that this powers) — [echo-code.dev](https://echo-code.dev)
- **Issues & discussion** — open a GitHub issue
- **Security issues** — oss-security@echo-code.dev

## Contributing

PRs welcome for:

- New strategies (e.g. COST_BUDGET_AWARE, REQUEST_CLASS)
- New providers (add to `src/providers/`)
- New storage adapters (write `docs/INTEGRATIONS.md` example)
- Bug fixes in `src/router/cascade.ts` or `score.ts`

Please don't add a hard dependency on a specific DB / framework — keep this package
`npm install`–able with zero deps beyond `node:crypto` and `globalThis`.
