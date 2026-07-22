# 自托管部署 — 用自己的 Key、自己的 DB

> 本文件展示最简单的自跑 EchoCode Router 方案。
> 需要更稳定 / 更多策略 / 商业支持 → 看 [`echocode-router-pro`](https://github.com/Yvette-Lorraine/EchoCode-Router/blob/main/BUSINESS_VERSION.md)。

## 你能得到什么

- 一个单进程 Node.js 暴露 `/v1/chat/completions`
- 跨你的 OpenAI / DeepSeek / Anthropic Key 做路由
- 本地 SQLite / 内存 / 任意外存
- 开箱即用的示例（100 行 Node HTTP）

## docker-compose（推荐）

```yaml
# docker-compose.yml
services:
  router:
    image: node:22-alpine
    working_dir: /app
    volumes:
      - ./router-core:/app
      - ./data:/app/data
    ports:
      - "8787:8787"
    environment:
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    command: sh -c "npm ci && npm run build && node examples/standalone-server.js"
    restart: unless-stopped
```

```bash
mkdir router-deploy && cd router-deploy
cp ../router-core/examples/standalone-server.ts .
cp ../router-core/examples/data.ts .
# 把你的真实 Key 放进 .env
docker compose up
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast","messages":[{"role":"user","content":"hi"}]}'
```

## 从 npm 跑

```bash
mkdir my-router && cd my-router
npm init -y
npm install echocode-router
```

`index.js`:

```js
import { createServer } from "node:http";
import { resolveRoute, runCascade, getAdapter } from "echocode-router";

// 1) 实现 RouterStorage（读你 DB / 文件 / 内存）
// 2) 实现 cascade executor
// 3) 绑定 HTTP server

// ... 同 examples/standalone-server.ts
```

```bash
node index.js
```

## 自托管 vs `echocode-router-pro`（商业版）

| 能力 | 自托管 OSS | `echocode-router-pro` 商业版 |
|---|---|---|
| Cascading failover | ✅ | ✅ |
| Key pool / 401 invalidation | ✅ | ✅ |
| Health probe + alerts | ✅ | ✅ |
| Rate limit | ✅ | ✅ |
| 5 因子评分权重 | 通用基线 | **18 月校准**精确权重 |
| 策略库 | 7 种通用 | **30+ 业务策略** |
| 流式 cascade | ❌ | ✅ |
| Hedge mode | ❌ | ✅ |
| LLM-as-Router hook | ❌ | ✅ |
| Storage adapter | 自己实现 | OSS 4 种 + 商业版 Prisma/Drizzle 即用 |
| 故障演练工具 | `x-echo-debug-fail` header | OSS 同 + 完整 chaos kit |
| 告警集成 | 基础 | 飞书/钉钉/Slack/PagerDuty |
| 商业支持 / SLA | ❌ | ✅ 99.9% · 7×24 · 1h 响应 |

**一句话：** 自跑 OSS 够用 → 想省心 / 想要更好路由效果 / 想要 SLA → 升级 `echocode-router-pro`。

## 什么时候升级

- 月 < 100K 调用 → **OSS（免费）**
- 月 100K - 1M → **oss + 调优权重包**（一次性）
- 月 1M-10M → **`echocode-router-pro` 订阅版**
- 月 10M+ → **商业版 + 私有部署**

📩 联系：**visioncore@yuanjinghexin.cn**

> [BUSINESS_VERSION.md](./BUSINESS_VERSION.md) 含完整对比、权重表、定价。
