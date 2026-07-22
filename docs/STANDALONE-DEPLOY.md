# Standalone deployment — bring your own keys, your own DB

This file shows the simplest way to run EchoCode Router as your own AI gateway,
without using the Echo Code commercial SaaS.

## What you get

- A single Node.js process exposing `/v1/chat/completions`
- Routing across your own OpenAI / DeepSeek / Anthropic keys
- A local SQLite file as the policy/usage store
- Admin UI served at `/admin` (optional, see [Echo Code commercial](https://echo-code.dev))

## docker-compose (recommended)

```yaml
# docker-compose.yml
version: "3.8"
services:
  router:
    image: node:20-alpine
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
# put your real OpenAI/DeepSeek/Anthropic keys in .env
docker compose up
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"fast","messages":[{"role":"user","content":"hi"}]}'
```

## Run from npm

```bash
mkdir my-router && cd my-router
npm init -y
npm install echocode-router
```

`index.js`:

```js
import { createServer } from "node:http";
import { resolveRoute, runCascade, getAdapter } from "echocode-router";

// 1) Implement RouterStorage（读你 DB / 文件 / 内存）
// 2) Implement cascade executor
// 3) Bind HTTP server

// ... same code as examples/standalone-server.ts
```

```bash
node index.js
```

## What you give up vs. the commercial SaaS

| | self-hosted router | echo-code.dev |
|---|---|---|
| Cascading failover | ✅ | ✅ |
| Key pool / 401 invalidation | ✅ | ✅ |
| Health probe + alerts | ✅ | ✅ |
| Rate limit | ✅ | ✅ |
| Admin UI | ❌ (use your own) | ✅ |
| Payment / invoices | ❌ | ✅ |
| Per-tenant self-serve signup | ❌ | ✅ |
| MFA / SSO / RBAC | ❌ | ✅ |
| WAF / DDoS | ❌ (use cloudflare in front) | ✅ |
| Status page / incident response | ❌ | ✅ |

**TL;DR:** self-hosted gives you the routing engine; commercial gives you the product around it.

## When to switch

- You have < 50 customers → self-host
- You have 50–500 customers + need billing + team features → commercial
- You have 500+ customers + need compliance + SLA → commercial + dedicated

See [echo-code.dev](https://echo-code.dev) for commercial plans.
