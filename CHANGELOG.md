# 更新日志

## [0.1.0] - 2026-07-22

### 新增

- **顺位故障切换**（transient/balance/non-transient 分类）
- **加权 Key 池** — 同供应商多 BYOK 加权随机轮询
- **401 立即熔断** — 凭据失效标记 + 自动跳过
- **5/5min cooldown** — 单 Key 失败预算 + 自动恢复
- **灰度发布** — `rolloutPercent` + `hash(orgId+alias) % 100`
- **5 因子评分 × 7 策略**（PRICE / LATENCY / QUALITY / ...）
- **每租户限流** — 进程内 token bucket
- **审计 + 决策可解释** — 每次请求 `routeDecision` JSON 快照
- **健康探针** — 每 60s + 连失阈值 + 健康评分
- **Explain API** — `/api/v1/route/explain` 查询请求决策
- **Standalone 示例** — 100 行 Node HTTP server
- **完整接入文档** — Prisma / Drizzle / 内存版示例

### 架构

- **0 业务依赖** — 所有存储通过 `RouterStorage` / `KeyStore` / `DecisionStore` / `HealthStorage` 4 接口注入
- **独立** — Node ≥ 22 / Bun / Deno
- 不绑特定 ORM、框架、数据库
- MIT License — 个人版开源；商业版见 [`echocode-router-pro`](https://github.com/EchoCode-Router-Pro)
