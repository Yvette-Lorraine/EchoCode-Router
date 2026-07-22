# EchoCode Router — 商业版（Pro） vs 开源版

> 本文件描述**路由库本身**的两个版本。
> `echocode-router`（MIT，开源版）= 个人 / 学习的入门款。
> `echocode-router-pro`（商业版）= 生产环境 / 高级用户的强化版。

📩 商业版联系：**visioncore@yuanjinghexin.cn**

---

## 一、为什么同一产品线分两个版本？

`echocode-router`（MIT）已含**完整路由算法骨架**：

- 顺位故障切换（cascade）
- 加权 Key 池 + 401 立即熔断 + 5/5min cooldown
- 灰度发布（rolloutPercent + hash bucket）
- 5 因子评分 × 7 策略
- 60s 健康探针 + 告警评估
- 每租户限流
- Storage 抽象（接 Prisma / Drizzle / 内存）

但生产环境有更多"高级需求"：成本预算、用户级偏置、LLM-as-router 钩子、streaming cascade 等。这些不开源（维护成本高 + 商业护城河）。

所以我们分两条线：

| | 开源版 `echocode-router` | 商业版 `echocode-router-pro` |
|---|---|---|
| **License** | MIT | 商业（按订阅 / 一次性买断）|
| **npm package** | `npm install echocode-router` | `npm install echocode-router-pro`（私有 registry）|
| **GitHub** | [Yvette-Lorraine/EchoCode-Router](https://github.com/Yvette-Lorraine/EchoCode-Router)（public）| 私有仓库 / 私有 npm（仅授权用户访问）|
| **API 兼容性** | 100% 兼容 | 在 OSS 之上扩展 API（不破坏）|
| **升级路径** | — | 在 OSS 代码里 `import { ... } from "echocode-router-pro"` 即可|

---

## 二、详细差异

| 能力 | 开源版 `echocode-router` | 商业版 `echocode-router-pro` |
|---|---|---|
| **路由核心算法**（cascade / 5 因子 / Key 池 / 401 熔断 / 灰度） | ✅ 完整 | ✅ 完整 + 18 月校准的调优权重 |
| **5 因子评分权重** | 通用基线 | **18 月校准** 精确权重 + 自定义权重 API |
| **策略库** | 7 通用策略 | **30+ 业务策略**（见下）|
| **Per-tenant 偏置** | ❌ | ✅（"这个用户偏好 GPT 系" / "这个租户低延迟要求"）|
| **时段权重**（按时间段切换偏置）| ❌ | ✅（8:00-22:00 偏 latency，凌晨偏 price）|
| **成本预算** | ❌ | ✅ `COST_BUDGET_AWARE` 策略 |
| **请求类型分流** | ❌ | ✅ `REQUEST_CLASS`（按 prompt 前缀识别 code/chat/vision）|
| **流式 cascade**（流已开始后智能切换） | ❌（阶段 2 简化）| ✅ 完整实现 |
| **Hedge mode**（同一请求发两家，先回的赢）| ❌ | ✅ |
| **智能路由 v2**（LLM-as-Router 可选 hook）| ❌ | ✅（100% opt-in，可关）|
| **Per-tenant 限速** | 单一 in-memory token bucket | 多维：RPM / TPM / 月配额 / 单日预算 / 突发 |
| **Storage adapter 库** | 4 个 interface 文档 | OSS 的 4 个 + 商业版 Prisma / Drizzle / 内存即用 adapter |
| **Probes 高级模式** | HTTP GET `/v1/models` | OSS 的 + Token bucket / weighted success / correlation ID |
| **故障演练工具** | `x-echo-debug-fail` header | OSS 的 + 完整 chaos 套件（partial failures、network drops）|
| **监控 / 告警** | 基础 5min 持续监控 | OSS 的 + 飞书 / 钉钉 / Slack / PagerDuty webhook + 自动降级 |
| **性能基准** | 4-9ms p95 | OSS 同 + 实测规模化（10K qps）基准报告 |
| **SLA** | ❌ | 99.9% 月可用性 + 1h 客服响应 |
| **支持** | GitHub issues | GitHub issues + 私域群 + 7×24 紧急联系 |
| **法律** | MIT | 商业 License + 责任限制 |

---

## 三、商业版 30+ 业务策略库

开源版只含 7 个通用策略：`DIRECT / LATENCY / PRICE / QUALITY / AVAILABILITY / REGION / CASCADE`。

商业版**额外**：

| 策略 | 描述 | 适用场景 |
|---|---|---|
| `COST_BUDGET_AWARE` | 租户月预算耗尽 80% → 自动切最便宜 | 控制烧钱 |
| `REQUEST_CLASS` | 按 prompt 前缀识别 code/chat/vision → 分流到不同候选池 | Agent 框架 |
| `LOW_LATENCY_REQUIRED` | SLO ≤ 500ms，否则 5xx 直接 fallback | 实时聊天 |
| `BUDGET_TIER_GOLD` | 高级租户 → 高质量模型 + BYOK 池优先 | 客户分级 |
| `BUDGET_TIER_BRONZE` | 低级别 → 最便宜 | 客户分级 |
| `GEO_PREFERENCE` | 中国租户 → DeepSeek 优先；欧美 → OpenAI 优先 | 跨境业务 |
| `LATENCY_BUDGET` | 用户的 `x-latency-budget-ms` 头指定上限 | B2B API |
| `COST_FIRST_THEN_LATENCY` | 先比价、再比延迟 | 综合优化 |
| `WEIGHTED_RANDOM` | 启用 5+ 候选的等权随机化 | A/B 测试 |
| `FALLBACK_TO_PLATFORM` | 客户没 BYOK → 平台替你调（按平台账号计费）| 0 配置启动 |
| `GEO_FENCING_CN_ONLY` | 强制走国内供应商 | 中国合规 |
| `GEO_FENCING_GLOBAL` | 强制不走境内 | 跨境合规 |
| `STICKY_BYOK` | 同一用户 24h 内粘同一 Key（避免频繁切换）| 减小冷启动 |
| `WEIGHTED_BY_TENANT` | per-tenant 凭据池（高级用户多把 Key） | 大客户 |
| `HEDGE_MODE` | 同一请求发两家，先回赢 | 关键业务 SLA |
| `STREAMING_CASCADE` | 流已开始后智能切换 | 真流级高可用 |
| `LEARNING_LLM_ROUTER` | 用 LLM-as-Router 给 query 分类 | 高准确率场景 |
| `TOKEN_AWARE_SCORING` | 按 token 数预估 cost 加权 | 大上下文请求 |
| `...` 等 30+ | | |

具体策略内容 + 触发条件 + 调优数据**仅商业版提供**。

---

## 四、5 因子权重：通用基线 vs 商业调优

开源版（`src/router/strategies.ts`）的默认权重：

| Strategy | latency | success | price | region | weight |
|---|---|---|---|---|---|
| LATENCY | 0.4 | 0.2 | 0.2 | 0.1 | 0.1 |
| PRICE | 0.2 | 0.2 | 0.4 | 0.1 | 0.1 |
| QUALITY | 0.2 | 0.4 | 0.2 | 0.1 | 0.1 |
| AVAILABILITY | 0.1 | 0.4 | 0.1 | 0.2 | 0.2 |
| REGION | 0.1 | 0.1 | 0.1 | 0.5 | 0.2 |

**通用基线** — 没调优。直接用能跑，但效果"中等"。

**商业版**（`echocode-router-pro` 的 `pro/strategies.ts`）：

| Strategy | latency | success | price | region | weight | 评价 |
|---|---|---|---|---|---|---|
| LATENCY (调优 v1.2) | 0.55 | 0.2 | 0.1 | 0.1 | 0.05 | **18 月校准**，对延迟特别敏感 |
| PRICE (调优 v1.2) | 0.1 | 0.1 | 0.6 | 0.1 | 0.1 | 强 price 偏好 |
| QUALITY (调优 v1.2) | 0.2 | 0.5 | 0.1 | 0.1 | 0.1 | success 拉满 |
| AVAILABILITY (调优 v1.2) | 0.05 | 0.75 | 0.05 | 0.1 | 0.05 | success 单维度主导 |
| REGION (调优 v1.2) | 0.1 | 0.1 | 0.1 | 0.65 | 0.05 | 区域强偏好 |
| COST_BUDGET_AWARE (商业专属) | 0.05 | 0.1 | 0.7 | 0.1 | 0.05 | 价格超敏感 + budget gating |
| REQUEST_CLASS (商业专属) | 0.3 | 0.4 | 0.2 | 0.05 | 0.05 | 按 request type 动态 |

**对客户的影响**：用 OSS 跑 100K 次调用，10-30% 路由选择"没商业版准"（多花成本 / 偶发 5xx）。随调用量上升差异放大。

---

## 五、API 对比

### 开源版（你已经在用）

```ts
import {
  resolveRoute,
  runCascade,
  getAdapter,
  type RouterStorage,
  // 7 通用策略 + 基础 5 因子评分
} from "echocode-router";
```

### 商业版（同样的代码，扩展 import）

```ts
import {
  // OSS 全部 API（向后兼容）
  resolveRoute,
  runCascade,
  // 商业版扩展
  proStrategies,           // 30+ 策略
  tunedWeights,            // 18 月校准权重
  tenantBias,              // per-tenant 偏置
  hedgingExecutor,         // hedge mode
  streamingCascade,        // 流式 cascade
  llmRouterHook,           // 可选 LLM-as-Router
  // 一样
  type RouterStorage,
} from "echocode-router-pro";

// 启用商业版策略 — 一行切换
const strategy = proStrategies.find(s => s.id === "COST_BUDGET_AWARE")!;
const { ranked, decision } = await resolveRoute("org_abc", model, {
  // ... 注入商业版权重
  weights: tunedWeights.PRICE,
  bias: tenantBias("org_abc", "gold"),
}, storage);
```

**100% 向后兼容** — OSS 用户的代码**完全不动**，商业版是"加 import"。

---

## 六、商业版定价

| 调用量 / 月 | 价格 | 包含 |
|---|---|---|
| < 100K | **免费**（OSS + 商业权重包）| 商业版 5 因子调优权重 + 路由策略库 |
| 100K - 1M | **¥ 1,500 / 月** | 上面 + 高级策略 + Storage adapter + 客服 |
| 1M - 10M | **¥ 12,000 / 月** | + 私有部署 / 私有 npm / 1v1 集成 |
| 10M+ | **定制** | 报价 |

含税专票 / 对公转账 / 月结。

---

## 七、自跑 OSS vs 商业版 — 怎么选

| 你的场景 | 推荐 |
|---|---|
| 学习 / 个人副业 / 月 < 100K 调用 | **用 OSS**（免费，够用） |
| 中小 SaaS / 月 100K - 1M | **OSS + 商业权重包**（一次性 ¥ ~5K，含 5 因子调优）|
| 中型 SaaS / 月 1M-10M | **商业版订阅** |
| 大型 / 合规要求 / 月 10M+ | **商业版 + 私有部署** |

---

## 八、联系商业版

📩 **visioncore@yuanjinghexin.cn**

- 7 天免费试用
- 30 分钟 demo 视频
- 1v1 集成指导
- 定制策略开发

---

> **echocode-router**（MIT）— 路由算法骨架，个人 / 自跑够用。
> **echocode-router-pro**（商业）— 调优权重 + 30+ 策略 + 运营 + SLA，生产推荐。
