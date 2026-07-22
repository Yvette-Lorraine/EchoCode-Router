# EchoCode Router

> 给**个人开发者**用的 AI 网关路由库。零成本、零依赖、零配置。
> 帮你在 OpenAI / DeepSeek / Anthropic 之间自由切换，自动避开 429 限速，自己电脑 1 分钟跑起来。

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-339933.svg)]()

---

## 你是否遇到这些场景？

- 🔁 写代码到一半要切 GPT-4o-mini → DeepSeek → Claude 反复改 `baseURL`，烦
- 💸 单独 OpenAI Key 老是 429 限速，自己手动开多 Key 轮询太累
- 🪦 写完想部署到云上，OpenAI 余额一不小心用超，不知道怎么破
- 🛡️ 担心把 API Key 明文存到代码里或者日志里
- 🧪 想自己 router 调度但又不想训练一个 LLM-as-router 浪费 GPU

如果点头 1 次以上，**这个项目就是为你写的**。

## 这个项目帮你做什么？

**EchoCode Router** 是一个 AI 网关路由层 — 你写一份 `curl` / 任意 OpenAI 客户端代码，**不动业务逻辑**，它帮你：

| 痛点 | EchoCode Router 怎么解 |
|---|---|
| 切换供应商要改 5 行代码 | 写一个别名（如 `fast`），背后挂 3 家供应商，自动选最优 |
| OpenAI Key 经常 429 | 多 Key 加权轮询 + 401 立即熔断 + 5min cooldown |
| 想做灰度发布 | 一个 `rolloutPercent=10` 就能让 10% 用户走新路由 |
| 出问题不知到哪 | 每次请求的 `routeDecision` 完整快照，告诉你怎么走的 |
| 部署到云被锁厂商 | MIT 开源，自己电脑 / VPS 都能跑，0 业务依赖 |
| 想训练 LLM-as-router | 不需要，纯规则评分，5ms 路由延迟 |

### 一句话

> **一个 Node 进程，开箱即用的 AI 网关，支持多 Key 池 + 顺位故障切换 + 灰度发布。** MIT 开源，零业务依赖。

---

## 🚀 3 分钟教程

### Step 1：装包

```bash
mkdir my-ai-gateway && cd my-ai-gateway
npm init -y
npm install echocode-router
```

> 需要 Node.js 20 或更高版本。

### Step 2：写一个 server（10 行）

新建 `gateway.js`：

```js
import { createServer } from "node:http";
import { resolveRoute, runCascade, getAdapter } from "echocode-router";
import { inMemoryStorage, demoData } from "echocode-router/example";

const storage = inMemoryStorage(demoData);

const server = createServer(async (req, res) => {
  if (req.url !== "/v1/chat/completions") return res.end("404");
  const body = JSON.parse(await new Promise((r) => req.on("data", r)));
  const { ranked } = await resolveRoute("me", body.model, {}, storage);
  const cascade = await runCascade(ranked, async (p, m, k) => {
    try {
      return { ok: true, data: await getAdapter(p).completeChat({ ...body, model: m }, { apiKey: "demo" }) };
    } catch (e) {
      return { ok: false, status: e.status, bodyText: e.message };
    }
  });
  res.writeHead(cascade.ok ? 200 : 502, { "content-type": "application/json" });
  res.end(JSON.stringify(cascade.ok ? cascade.attempts.at(-1).response : { error: "all_attempts_failed" }));
});

server.listen(8787, () => console.log("Gateway at http://localhost:8787"));
```

### Step 3：跑起来

```bash
node gateway.js
# → Gateway at http://localhost:8787
```

另开一个终端：

```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fast",
    "messages": [{"role":"user","content":"hi"}]
  }'
```

🎉 你刚跑了一个智能路由的 AI 网关。

### Step 4（可选）：挂上你的真实 Key

编辑 `demoData` 把它换成你的 Key 池：

```js
byok: [
  { id: "byok-1", orgId: "me", providerId: "openai", weight: 1, isHealthy: true, cooldownUntil: null },
  { id: "byok-2", orgId: "me", providerId: "openai", weight: 1, isHealthy: true, cooldownUntil: null },
  { id: "byok-3", orgId: "me", providerId: "deepseek", weight: 0.8, isHealthy: true, cooldownUntil: null },
],
```

> 加 Key 后会**自动加权轮询**。某把 Key 失败超过 5 次 / 5min → 自动 cooldown 5min。
> 401 立刻熔断这把 Key，下次请求直接跳过。

---

## 🛠️ 真实使用场景

### 场景 1：本地写代码时切换模型

不用改代码，URL 改一次：

```js
// 写代码时
const url = "http://localhost:8787/v1/chat/completions";
const model = "fast";  // → 自动选最便宜的

// 调试时
const model = "smart"; // → 自动选 GPT-4o
```

### 场景 2：发到生产，担心被锁

```js
// 公司多 Key 池：把 byok 加满 + 灰度 10%
{
  "alias": "fast",
  "rolloutPercent": 10,  // 10% 用户先试用
  "providers": ["openai", "deepseek", "claude"]
}
```

10% 没问题 → 50 → 100。

### 场景 3：不想给 OpenAI 充太多钱

```js
// 默认走 DeepSeek（中文便宜）
const model = "fast";  // 配置 fast 策略 = PRICE → 选 deepseek-chat
```

### 场景 4：所有 Key 都 429 了

没事。**自动切下一家**：

```text
13:04:21  GET /v1/chat/completions  model=fast
  → openai/gpt-4o-mini  429 rate limit
  → openai/gpt-4o-mini  429 rate limit
  → deepseek/deepseek-chat  200 OK ✓
```

你看 /admin 日志能看到完整 fallback chain。

---

## ⚙️ API 速查

```ts
// 评分 + 排序
const { ranked, decision } = await resolveRoute(
  "my-tenant",         // 你的租户 id
  "fast",              // 模型名 或 别名（routePolicy.alias）
  { allowMockFallback: true },
  storage              // 你实现的 RouterStorage
);

// 顺位重试
const result = await runCascade(ranked, async (providerId, modelId, byokId) => {
  try {
    const out = await getAdapter(providerId).completeChat({ model: modelId, messages }, {
      apiKey: "<byok>", orgId: "my-tenant", keyId: byokId,
    });
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, status: e.status, bodyText: e.message };
  }
});
```

**4 个 storage interface 你实现**（Prisma / Drizzle / 内存 / 任何 DB 都能接）：

```ts
{
  loadPolicyByAlias(alias), loadActiveModels(), loadProviders(),
  loadCandidatesByPolicy(policyId), loadByokPool(orgId),
  loadLatestHealthByProvider(), loadPriceBook(), loadProviderById(id)
}
```

完整 storage 适配模板见 [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md)。

---

## 🩺 健康监控

每 60 秒自动跑探针：

```text
[router-probe] openai  status=HEALTHY   p95=320ms   success=99%
[router-probe] deepseek status=DEGRADED  p95=480ms   success=88%  ← 自动降级
[router-probe] anthropic status=HEALTHY  p95=520ms  success=96%
```

任一供应商连续 3 次失败 → 路由自动剔除，下次请求跳过它。

---

## ⚙️ 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `ECHO_PROBE_INTERVAL_MS` | `60000` | 健康探针间隔 |
| `ECHO_PROBE_TIMEOUT_MS` | `3000` | 单次探针超时 |
| `ECHO_PROBE_KEY_{PROVIDER}` | – | 探针专用 Key（覆盖 BYOK） |
| `ECHO_RATE_LIMIT_PER_MIN` | `600` | 每租户限流 |
| `ECHO_ADMIN_BYPASS_MFA` | `0` | dev 环境跳过 admin MFA |

---

## 📚 实战教程

| 教程 | 内容 |
|---|---|
| [examples/standalone-server.ts](./examples/standalone-server.ts) | 100 行 Node HTTP server（10 分钟跑起来） |
| [docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md) | 接 Prisma / Drizzle / 内存等存储 |
| [docs/STANDALONE-DEPLOY.md](./docs/STANDALONE-DEPLOY.md) | Docker Compose 自托管 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本历史 |

---

## 🤔 常见问题

**Q: 我能自己电脑跑吗？**
A: 可以。`node gateway.js` 一行。`examples/standalone-server.ts` 是完整 100 行 demo。

**Q: 我能把 key 明文存吗？**
A: 不要。所有 `routeDecision` / 日志自动把 byokId 截成 `byok…xxxx` 形式；不存上游响应 body。

**Q: 它会变慢吗？**
A: 路由决策 4–9ms p95（无 LLM 推理）。整个 OpenAI 兼容请求加 5ms。

**Q: 跟 OpenRouter / NotDiamond 区别？**
A: OpenRouter 是目录 + vendor 托管；NotDiamond 训练 LLM-as-router 慢 100ms+。本项目是**纯规则 + 顺位 cascade**，专门给个人开发者自跑。

**Q: 支持流式吗？**
A: 支持。0.2 完整 streaming cascade。

**Q: License？**
A: MIT — 自由用、改造、商用。

---

## 💼 OSS vs 商业版

| 用途 | 推荐 |
|---|---|
| 写代码 / 学习 / 自部署 / 月 < 100K 请求 | **用这个开源版**（`echocode-router`，MIT，够用） |
| 中小 SaaS / 月 100K - 1M | **OSS + `echocode-router-pro` 调优权重包**（一次性买权重数据）|
| 中型 SaaS / 月 1M-10M | **`echocode-router-pro` 订阅版**（含高级策略 + 客服）|
| 大型 / 合规要求 / 月 10M+ | **`echocode-router-pro` 私有部署版** |

> **如果你是个人 / 小团队开发者，这个项目就够用了。**
> **如果你的业务对稳定性、合规、规模化有要求，可以升级到 `echocode-router-pro` 商业版**：

### OSS 与商业版差异

本开源版 (`echocode-router`, MIT) 含**完整路由算法骨架**（cascade / Key 池 / 健康探针 / 灰度 / 限流），开箱即用。

**未含**的"18 月校准"商业能力，详见 **[BUSINESS_VERSION.md](./BUSINESS_VERSION.md)**：

- 5 因子评分的**精确调优权重**（开源版用通用基线）
- **30+ 业务策略库**（`COST_BUDGET_AWARE` / `REQUEST_CLASS` / 时段权重 / per-tenant 偏置…）
- 完整流式 cascade / Hedge mode / 可选 LLM-as-Router hook
- 飞书/钉钉/Slack/PagerDuty 告警 + 自动降级
- 性能基准报告 + 7×24 商业支持 + 99.9% SLA

> 自跑 OSS 够用 → 想省心 / 想要更好路由效果 / 想要 SLA → 升级 `echocode-router-pro`。
> 100% 向后兼容：升级只需要改 import path，不动业务代码。

📩 联系：**visioncore@yuanjinghexin.cn**

---

## 🛠️ 故障排除

| 现象 | 排查 |
|---|---|
| `Error: UNKNOWN_MODEL` | 检查 model 名是否在 `loadActiveModels` 或 `RoutePolicy.alias` 列表里 |
| 全 502 / 大量 NO_AVAILABLE_CANDIDATE | 检查 BYOK 池：账号余额、`isHealthy=true`、无 cooldown |
| Provider 健康度变 `DOWN` | 等 60s 看 probe 是否恢复；或 `curl https://<provider>/v1/models` 验明 |
| 输出没切换 | 检查 `routeDecision.fallbackChain`；如非空表示已切 |

---

## 🤝 贡献

欢迎 PR：
- 新策略 / 新 Provider / 新 Storage Adapter
- bug fix
- 文档改进

请**不要引入对特定 DB / 框架的硬依赖**。保持 `npm install` 即用，零硬依赖。

---

## 📜 许可证

[MIT](./LICENSE) © 2026 EchoCode Router

> 本项目是 `echocode-router`（MIT 开源版）。商业版 `echocode-router-pro` 提供：调优权重、30+ 高级策略、流式 cascade、LLM-as-Router hook、告警集成、客服与 SLA。
> 个人 / 自部署 / 学习用 — 用这个版本就够。
