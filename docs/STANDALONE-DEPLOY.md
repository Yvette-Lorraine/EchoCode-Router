# 自托管部署 — 自带 Key、自带数据库

> 本文件展示最简单的方式，用自己的 Key + 自己的数据库跑 EchoCode Router。

## 你能得到什么

- 一个 Node.js 进程，暴露 `/v1/chat/completions`
- 跨你的 OpenAI / DeepSeek / Anthropic Key 做路由
- 本地 SQLite / 内存 / 任意数据库

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
  -d '{"model":"fast","messages":[{"role":"user","content":"你好"}]}'
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

// 1) 实现 RouterStorage（读你数据库 / 文件 / 内存）
// 2) 实现 cascade executor
// 3) 绑定 HTTP server

// ... 代码同 examples/standalone-server.ts
```

```bash
node index.js
```

## 自托管 vs `echocode-router-pro`（商业版）

| 能力 | 自托管 OSS | Pro 商业版 |
|---|---|---|
| 顺位故障切换 | ✅ | ✅ |
| Key 池 / 401 熔断 | ✅ | ✅ |
| 健康探针 + 告警 | ✅ | ✅ |
| 限流 | ✅ | ✅ |
| 5 因子评分权重 | 通用基线 | **18 月校准**精确权重 |
| 策略库 | 7 种通用 | **30+ 业务策略** |
| 流式 cascade | ❌ | ✅ |
| Hedge mode | ❌ | ✅ |
| LLM-as-Router hook | ❌ | ✅ |
| Storage adapter | 自己实现 | OSS 4 种 + 即用 Prisma/Drizzle |
| 故障演练工具 | `x-echo-debug-fail` header | + 完整 chaos kit |
| 告警集成 | 基础 | 飞书/钉钉/Slack/PagerDuty |
| 商业支持 / SLA | ❌ | ✅ 99.9% · 7×24 |

**一句话：** 自跑 OSS 够用 → 想省心 / 要更好效果 / 要 SLA → 升级 `echocode-router-pro`。

📩 联系：**visioncore@yuanjinghexin.cn**
