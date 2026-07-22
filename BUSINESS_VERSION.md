# EchoCode Router 商业版 vs 开源版

> 本文件描述**商业版**的差异化能力。
> 开源版（`Yvette-Lorraine/EchoCode-Router`，MIT License）已包含完整的**路由算法骨架**（cascade / Key 池 / 健康探针 / 灰度 / 限流）。
> 商业版在**生产调优**、**运营工具**、**企业级 SLA** 层面提供额外能力。

📩 商业版联系：**visioncore@yuanjinghexin.cn**

---

## 一、为什么会有商业版？

`router-core` 已能跑通"AI 网关路由"的**核心机制**。但从「能跑」到「跑得好」，需要：

1. **真实生产流量校准的权重**（18+ 月积累）
2. **按业务场景定制的策略库**
3. **运营级可观测 / 告警 / 控制台**
4. **合规 / 审计 / 客户支持**

这些**不通用**（每家公司流量模型不同），所以我们把它们放在**商业版**持续维护。

---

## 二、详细差异对照

| 能力 | 开源版（router-core） | 商业版（Echo Code SaaS） |
|------|----------------------|-------------------------|
| **License** | MIT | 商业订阅（按调用量阶梯） |
| **路由核心算法**（cascade / 5 因子评分 / Key 池 / 401 熔断 / 灰度）| ✅ 完整 | ✅ 完整（同算法）|
| **5 因子评分权重** | ⚠️ 通用基线 | ✅ 18 月校准的精确权重 |
| **策略库** | 7 种通用策略 | **30+ 业务策略**（见下）|
| **Per-tenant 偏置** | ❌ | ✅（"这个用户偏好 GPT 系" / "这个租户低延迟要求"）|
| **时段权重** | ❌ | ✅（8:00-22:00 偏 latency；凌晨偏 price）|
| **成本预算** | ❌ | ✅ `COST_BUDGET_AWARE` 策略 |
| **请求类型分流** | ❌ | ✅ `REQUEST_CLASS`（按 prompt 前缀识别 code / chat / vision）|
| **Per-tenant 限速** | 单一 in-memory token bucket | 多维：RPM / TPM / 月配额 / 单日预算 / 突发 |
| **管理控制台** | ❌（需自己写） | ✅ Web UI：租户 / 路由 / Key 池 / 告警 / 用量 |
| **多租户 / 自助注册** | ❌ | ✅ |
| **支付 / 发票 / 对公转账** | ❌ | ✅ Stripe / 微信 / 支付宝 / 含税专票 |
| **SSO / MFA / RBAC** | ❌（自己接） | ✅ 完整 |
| **状态页 / 事故响应** | ❌ | ✅ status.echo-code.dev + 值班 |
| **WAF / DDoS / Bot 防御** | ❌（自己接 cloudflare） | ✅ 内置 + 限速 / IP 白名单 |
| **ICP / SOC 2 / ISO 27001** | ❌ | ✅ 已完成 |
| **客服 / SLA 99.9%** | ❌ | ✅ 工单 + 私域群 + 1h 响应 |
| **Phone / 视频 / Realtime** | ❌ | ✅ |
| **智能路由 v2 (LLM-as-Router 可选 hook)** | ❌ | ✅ 高级用户可启用 |

---

## 三、30+ 业务策略库

开源版只含 7 个通用策略：`DIRECT / LATENCY / PRICE / QUALITY / AVAILABILITY / REGION / CASCADE`。

商业版**额外**：

| 策略 | 描述 | 适用场景 |
|---|---|---|
| `COST_BUDGET_AWARE` | 租户月预算耗尽 80% → 自动切最便宜的候选 | 控制烧钱 |
| `REQUEST_CLASS` | 按 prompt 前缀识别 code/chat/vision → 分流到不同候选池 | Agent 框架 |
| `LOW_LATENCY_REQUIRED` | SLO ≤ 500ms，否则 5xx 直接 fallback | 实时聊天 |
| `BUDGET_TIER_GOLD` | 高级别租户 → 高质量模型 + BYOK 池优先 | 客户分级 |
| `BUDGET_TIER_BRONZE` | 低级别 → 最便宜 | 客户分级 |
| `GEO_PREFERENCE` | 中国租户 → DeepSeek 优先；欧美 → OpenAI 优先 | 跨境业务 |
| `LATENCY_BUDGET` | 用户在请求头带 `x-latency-budget-ms`，路由必须满足 | B2B API |
| `COST_FIRST_THEN_LATENCY` | 复合策略：先比价、再比延迟 | 综合优化 |
| `WEIGHTED_RANDOM` | 启用 5+ 候选的等权随机化（不评 score） | A/B 测试 |
| `FALLBACK_TO_PLATFORM` | 客户没 BYOK 时，平台替你调（按平台账号计费）| 0 配置启动 |
| `GEO_FENCING_CN_ONLY` | 强制走国内供应商（合规） | 中国境内业务 |
| `GEO_FENCING_GLOBAL` | 强制不走境内 | 跨境合规 |
| `STICKY_BYOK` | 同一用户 24h 内粘同一把 Key（避免频繁切换）| 减小冷启动 |
| `WEIGHTED_BY_TENANT` | per-tenant 凭据池（高级用户多把 Key） | 大客户 |
| `HEDGE_MODE` | 同一请求发两家供应商，取先回的 | 关键业务 SLA |
| `...` 等 30+ | | |

具体策略内容 + 触发条件 + 调优数据**仅商业版提供**（看 [echo-code.dev](https://echo-code.dev)）。

---

## 四、5 因子权重：通用基线 vs 商业调优

开源版 (`src/router/strategies.ts`) 的默认权重：

| Strategy | latency | success | price | region | weight | 评价 |
|---|---|---|---|---|---|---|
| LATENCY | 0.4 | 0.2 | 0.2 | 0.1 | 0.1 | **通用**，未调优 |
| PRICE | 0.2 | 0.2 | 0.4 | 0.1 | 0.1 | **通用**，未调优 |
| QUALITY | 0.2 | 0.4 | 0.2 | 0.1 | 0.1 | **通用**，未调优 |
| AVAILABILITY | 0.1 | 0.4 | 0.1 | 0.2 | 0.2 | **通用**，未调优 |
| REGION | 0.1 | 0.1 | 0.1 | 0.5 | 0.2 | **通用**，未调优 |

**商业版**权重（节选）：

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

## 五、商业版运营模块

| 模块 | 描述 |
|---|---|
| **Admin UI** | Web 控制台：租户管理 / 路由编辑 / Key 池 / 告警配置 / 用量查询 / 发票 |
| **状态页** | status.echo-code.dev（订阅）|
| **Webhook** | 路由决策、告警、计费事件 实时推送到你的 webhook |
| **私有镜像** | 可选择 router-core 跑在你自己的 VPC / 边缘节点 |
| **白手套集成** | 我们工程师协助接入 + 调优（一次 1-2 周） |
| **故障演练** | 季度一次"上游全熔断"演练 + 报告 |

---

## 六、商业版 SLA

| SLA | 数值 |
|---|---|
| 月可用性 | 99.9% |
| 月路由成功率 | ≥ 99.5% |
| 路由附加延迟 p95 | < 30ms |
| 客服响应 | 工作日 1 小时（紧急 30 min） |
| 退款 | 月度 SLA 未达 → 自动按比例退款 |

---

## 七、商业版价格（参考）

| 调用量 / 月 | 价格 | 含 |
|---|---|---|
| < 100K | 免费 (OSS + 商业权重包) | 商业版 5 因子调优权重 + 路由策略库 |
| 100K - 1M | ¥ 1,500 / 月 | 上面 + 控制台 + 告警 + 客服 |
| 1M - 10M | ¥ 12,000 / 月 | + 私有部署 + 私有镜像 + 白手套 |
| 10M+ | 定制 | 报价 |

含税专票 / 对公转账 / 月结。

---

## 八、自跑 OSS vs 商业版 — 怎么选

| 你的场景 | 推荐 |
|---|---|
| 学习 / 个人副业 / 月 < 100K 调用 | **用 OSS**（免费，够用） |
| 中小 SaaS / 月 100K - 1M | **OSS + 商业权重包**（一次性买权重数据）|
| 中型 SaaS / 月 1M-10M | **商业版**（含控制台）|
| 大型 / 合规要求 / 月 10M+ | **商业版 + 私有部署** |

---

## 九、联系

📩 **visioncore@yuanjinghexin.cn**

- 7 天免费试用商业版
- 30 分钟 demo 视频
- 1v1 集成指导
- 定制化路由策略开发

---

> **EchoCode Router** 路由算法 — MIT 开源。
> 路由权重 / 策略 / 运营 — 商业版维护。
