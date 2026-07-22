# CHANGELOG

All notable changes to EchoCode Router are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial open-source release of `echocode-router`（MIT）。核心路由算法提取自商业项目。"
- **Cascading failover** with `transient` / `non-transient` / `balance` error classification.
- **Weighted key pool** — same provider, multiple BYOKs, weighted random rotation.
- **401 immediate invalidation** — bad credentials skip on next call.
- **5-of-5min cooldown** — per-key failure budget, automatic recovery.
- **Gradual rollout** — `rolloutPercent` + `hash(orgId+alias) % 100`.
- **5-factor scoring** — `latency × success × price × region × weight` per strategy (7 strategies).
- **Per-org rate limit** — in-memory token bucket.
- **Audit + explain** — every decision JSON-serialized; `routeDecision.totalRouterMs`.
- **Health probes** — every 60s; consecutive-failure threshold; health score.
- **Per-user Explain API** rate limit (30 req/min).
- **Mock provider adapter** for offline dev.
- **OpenAI-compatible adapter** for any `/v1/chat/completions`-style upstream.
- **Standalone example** (Node HTTP, 100 lines, no framework).
- **Full integration guide** for Prisma + similar DBs.

### Architecture
- **0 backend dependencies.** All storage is injected via 4 small interfaces
  (`RouterStorage`, `KeyStore`, `DecisionStore`, `HealthStorage`).
- **Standalone**. Works in Node ≥ 20 / Bun / Deno.
- No coupling to any specific ORM, framework, or database.

[Unreleased]: https://github.com/echo-code/EchoCode-Router
