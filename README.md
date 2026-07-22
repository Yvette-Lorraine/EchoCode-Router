# EchoCode Router

> 智能 AI 网关路由层 — 顺位故障切换 · Key 池加权 · 灰度发布。
> 零业务依赖。可嵌入 Next.js、Express、Hono、Fastify、Bun、Deno。

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)]()

## 这是什么？

**EchoCode Router** 是 [Echo Code](https://echo-code.dev)（模型中转站商业 SaaS）的开源路由核心。专门为模型中转商 / 聚合器设计。它决定的是：

> _这一条进来的 `/v1/chat/completions` 请求，应该走哪家上游模型 / 哪个供应商 / 哪把 BYOK（用户自带 Key），失败时怎么切换？_

**核心能力：**

- **顺位故障切换（cascade）** — `transient` / `balance` 错误 → 切下一候选；`non-transient` → 立即停止。
- **加权 Key 池** — 同一供应商下多把 BYOK，加权随机轮询。
- **401 立即熔断** — 凭据失效？标记 Key 死亡，下一次请求自动跳过。
- **5/5min cooldown** — 单 Key 失败预算 + 自动恢复。
- **灰度发布** — `rolloutPercent` + `hash(orgId+alias) % 100` 桶。
- **健康探针** — 每 60 秒；连续失败阈值；健康评分。
- **5 因子评分** — `latency × success × price × region × weight`，7 种策略。
- **每租户限流** — 进程内 token bucket。
- **审计 + 决策可解释** — 每次请求 JSON 序列化 `routeDecision`；含 `totalRouterMs`。
- **零耦合** — 你实现 4 个 storage 接口即可（Prisma / Drizzle / Mongo / 内存都行）。

## 为什么需要这个？

市面上的 AI 网关路由基本是这三种范式：

- **目录型（OpenRouter）** — 一把 Key 访问多家，但没有真正"替我选"。
- **LLM-as-Router（NotDiamond、Martian）** — 训练/微调一个小模型给每个 query 分类；额外 100–500ms 延迟，可解释性差。
- **路由推荐（Hugging Face Inference Endpoints 早期）** — 推荐，不调度。

**EchoCode Router 是第四种：纯规则评分 + 顺位 cascade**，专为 **BYOK 场景**（用户自带 OpenAI / DeepSeek / Anthropic Key）设计。这种场景里：

- 可解释性 > 边际准确率
- 延迟不可妥协（P95 目标 < 30ms）
- 一个供应商下多 Key 很正常（绕速率限制）
- 路由决策必须可见、可回滚（运营需求）

**这个包是规则 + cascade 引擎。** 营销站、计费、Admin UI 在 [echo-code.dev](https://echo-code.dev) 商业版独立维护。

## 安装

```bash
npm install echocode-router
# or
pnpm add echocode-router
```

**要求**：Node.js ≥ 20。

## 用法

```ts
import {
  resolveRoute,
  runCascade,
  getAdapter,
  type RouterStorage,
} from "echocode-router";

// 1. 实现 RouterStorage（告诉路由器怎么从你的 DB 读数据）
const storage: RouterStorage = {
  async loadPolicyByAlias(alias) { /* 你的 DB */ },
  async loadActiveModels() { /* 你的 DB */ },
  async loadProviders() { /* 你的 DB */ },
  async loadCandidatesByPolicy(policyId) { /* 你的 DB */ },
  async loadByokPool(orgId) { /* 你的 DB */ },
  async loadLatestHealthByProvider() { /* 你的 DB */ },
  async loadPriceBook() { /* 你的 DB */ },
  async loadProviderById(providerId) { /* 你的 DB */ },
};

// 2. 评分 + 排序
const { ranked, decision } = await resolveRoute(
  "org_abc",                  // 租户 id
  "fast",                      // 模型名 或 别名
  { allowMockFallback: true },
  storage
);

// 3. 顺位重试（cascade 编排）
const cascade = await runCascade(ranked, async (providerId, modelId, byokId) => {
  const adapter = getAdapter(providerId); // OpenAI 兼容 HTTP 客户端
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
  // 所有候选都失败；cascade.attempts 含完整尝试链
  return new Response(JSON.stringify({ error: "ALL_ATTEMPTS_FAILED" }), { status: 502 });
}
return new Response(JSON.stringify(cascade.attempts.at(-1).response));
```

这就是完整集成。路由器负责：

- 解析 alias → 策略 → 候选池
- 按 `latency / success / price / region / weight` 给每个候选打分
- 按 score 排序，cascade 顺位重试
- 从候选的 BYOK 池里加权随机选一把 Key
- 遇到 `transient`（5xx/429/超时）或 `balance`（402）→ 切下一候选
- 遇到 `non-transient`（4xx 但非 402/429）→ 立即停止
- 失败 Key 标 cooldown，401 Key 立即标记失效
- 把 `routeDecision` 写入你的 `DecisionStore`
- 每 60s 跑 `probeOne()` 写一条 health 快照

## 架构

```
用户请求 (POST /v1/chat/completions)
    │
    ├─ 鉴权 + 限流
    │
    ├─ resolveRoute(orgId, model, ctx, storage)        ← 本包
    │     1. loadPolicyByAlias / loadActiveModels
    │     2. 灰度 hash 桶判断
    │     3. 候选打分（5 因子 × 7 策略）
    │     4. 过滤（DOW 供应商 / 无 BYOK → blocked）
    │     5. 按 score 排序，生成决策快照
    │     6. 50ms 缓存
    │
    ├─ runCascade(ranked, executor)                     ← 本包
    │     for each candidate:
    │       for each byok in pool (加权随机):
    │         try executor()
    │         ├─ transient/balance → 标 cooldown，下一 byok
    │         ├─ non-transient → 停止
    │         └─ ok → return
    │
    └─ 落库 decision + usage event
```

**决策快照**（每次调用都返回）：

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

每次调用写一条 `routeDecision` JSON；每次失败写一条 `fallbackChain`。
管理员通过 `Explain` API 或 `AuditLog` 表查询。网关层不用管这些。

## 什么不在本包？

故意排除 — 属于 [echo-code.dev](https://echo-code.dev) 商业版：

- 营销站 / pricing 页面
- Web 控制台（多租户 dashboard）
- Admin UI（编辑路由 / BYOK 池）
- 支付 / 发票 / Stripe / 微信 / 支付宝
- MFA / SSO / RBAC 强制
- WAF / DDoS / Bot 防御
- ICP / SOC 2 / ISO 27001 合规文档

**一句话：本包是路由大脑；商业版是身体。**

## 与主流的差异

| | EchoCode Router | OpenRouter | NotDiamond | Martian |
|---|---|---|---|---|
| 决策模型 | 规则 + 评分 | 仅规则 | LLM-as-router | LLM-as-router |
| 路由延迟 | ~5ms | n/a | 100–500ms | 100–500ms |
| 可解释性 | 完整 `routeDecision` | 目录元数据 | 黑盒 | 黑盒 |
| 顺位故障切换 | ✅ 支持 | ❌ | 部分 | 部分 |
| BYOK 加权池 | ✅ 支持 | n/a（他们托管） | n/a | n/a |
| 灰度发布 | ✅ `rolloutPercent` hash | ❌ | ❌ | ❌ |
| 自动健康探针 | ✅ 每 60s | ❌ | ❌ | 部分 |
| 可自托管 | ✅ 0 业务依赖 | ❌ 闭源 | ❌ | ❌ |
| License | MIT | 专有 | 专有 | 专有 |

**技术差异点：cascade + BYOK 池 + 可解释性。** 如果你需要"按 query 内容选模型"，看 LLM-as-router。如果你需要"按用户 Key + 策略 + 可观测地调度请求"，这就是你需要的。

## 示例

`examples/standalone-server.ts` — 一个 100 行的 Node HTTP server。

```bash
pnpm i
pnpm example
# 另一终端:
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast","messages":[{"role":"user","content":"hi"}]}'
```

## Storage 接口（你实现这些）

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

还有 3 个更小的接口：`KeyStore`（markSuccess/Failure/Invalidate）、`DecisionStore`
（writeRouteDecision）、`HealthStorage`（loadActiveProviders/loadLatestHealth/loadRecentHealth/saveHealth）。

Prisma / Drizzle / 内存实现示例见 [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md)。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `ECHO_PROBE_INTERVAL_MS` | `60000` | 健康探针间隔 |
| `ECHO_PROBE_TIMEOUT_MS` | `3000` | 单次探针 HTTP 超时 |
| `ECHO_PROBE_KEY_{PROVIDER}` | – | 探针专用 API Key（覆盖 BYOK） |
| `ECHO_RATE_LIMIT_PER_MIN` | `600` | 每租户限流 |
| `ECHO_ADMIN_BYPASS_MFA` | `0` | 开发环境跳过 admin MFA |

## 性能

- 路由决策：**4–9ms p95**（无 LLM 推理）
- N 个候选的 cascade：时间复杂度 `O(N × M)`，M = byok 池大小
- 内存：路由层 < 10MB
- 健康探针：60s 周期，每供应商 3s 超时，并行

## 许可证

[MIT](./LICENSE) © 2026 Echo Code

## 相关链接

- **Echo Code**（本包驱动的商业 SaaS）— [echo-code.dev](https://echo-code.dev)
- **Issues 与讨论** — 提 GitHub issue
- **安全问题** — visioncore@yuanjinghexin.cn

## 贡献

欢迎 PR：

- 新策略（如 `COST_BUDGET_AWARE` / `REQUEST_CLASS`）
- 新 Provider Adapter（在 `src/providers/` 加）
- 新 Storage Adapter（写 `docs/INTEGRATIONS.md` 示例）
- `src/router/cascade.ts` 或 `score.ts` 的 bug fix

**请不要引入对特定 DB / 框架的硬依赖。** 保持本包 `npm install` 即可用，除 `node:crypto` 和 `globalThis` 外零依赖。
